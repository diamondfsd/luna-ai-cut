//! Faithful port of OpenCV's `cv::findHomography(src, dst, RANSAC)`.
//!
//! Sources (4.x branch, symbols named as in OpenCV):
//! - `modules/calib3d/src/fundam.cpp` — `HomographyEstimatorCallback`
//!   (`runKernel` normalized DLT, `computeError`, `checkSubset`),
//!   `HomographyRefineCallback` (LM residuals/Jacobian), `findHomography`
//!   driver.
//! - `modules/calib3d/src/ptsetreg.cpp` — `RANSACPointSetRegistrator::run`,
//!   `getSubset`, `findInliers`, `RANSACUpdateNumIters`.
//! - `modules/calib3d/src/precomp.hpp` — `haveCollinearPoints`,
//!   `compressElems`.
//! - `modules/core/src/levmarq.cpp` — `LMSolverImpl::run`.
//! - `modules/core/src/lapack.cpp` — `JacobiImpl_` (symmetric eigensolver),
//!   `SVBkSbImpl_` (thresholded eigen back-substitution used by
//!   `solve(..., DECOMP_EIG)` and `invert(..., DECOMP_EIG)`).
//!
//! Defaults baked in, matching `cv::findHomography(src, dst, RANSAC)`:
//! reprojection threshold 3.0, confidence 0.995, maxIters 2000, LM refine
//! 10 iterations, RANSAC RNG seeded with `(uint64)-1`.
//!
//! # Parity notes / deviations
//!
//! - **Eigensolver.** The plan suggested `nalgebra::SymmetricEigen` for the
//!   smallest eigenvector of the 9x9 `LtL`. Instead, OpenCV's cyclic Jacobi
//!   routine (`JacobiImpl_`) is ported verbatim, for two reasons:
//!   (1) the reference `cv2` wheel (4.14.0, macOS arm64) is built with
//!   `Eigen: NO`, so `cv::eigen` runs exactly this Jacobi code — porting it
//!   reproduces the eigenvector to the last ulp instead of "up to
//!   eigensolver differences", which is what makes bit-equal inlier masks
//!   achievable (`docs/pipeline.md` §3 makes the same recommendation);
//!   (2) the LM refinement *requires* OpenCV's `DECOMP_EIG` thresholded
//!   pseudo-solve anyway: the homography residual is invariant to scaling of
//!   the 9-vector, so `J` has an exact null direction and `A = JᵀJ` is
//!   singular whenever the damping `lambda` hits 0 — a plain LU/Cholesky
//!   solve would blow up where OpenCV's eigen back-substitution quietly
//!   zeroes the null component.
//! - **FMA contraction.** The `cv2` wheel is compiled by clang with
//!   `-ffp-contract=on`, so some C++ float/double expressions may be fused
//!   into FMAs; rustc does not contract. This leaves last-ulp differences in
//!   accumulated quantities (`LtL`, reprojection errors). It can only flip an
//!   inlier decision if a point's squared f32 error sits within ~1 ulp of
//!   exactly 9.0 — not observed on any fixture.
//! - **Reduction order.** `cv::norm`/`Mat::dot` may use SIMD reductions with
//!   a different summation order (last-ulp differences). We mirror OpenCV's
//!   scalar `CV_ENABLE_UNROLLED` 4-way pattern; this only matters at exact
//!   floating-point ties in LM accept/reject branches.

// Index-based loops are kept deliberately: the code mirrors the OpenCV C++
// line by line so it can be diffed against the source, and the exact
// iteration/accumulation order is load-bearing for numerical parity.
#![allow(clippy::needless_range_loop)]
#![allow(clippy::type_complexity)]

use crate::rng::CvRng;

/// Result of [`find_homography`]: row-major 3x3 `H` mapping `src` -> `dst`
/// (normalized so `h[2][2] == 1` whenever `|h22| > FLT_EPSILON`, exactly as
/// OpenCV returns it) and the per-point inlier mask.
#[derive(Debug, Clone)]
pub struct HomographyResult {
    pub h: [[f64; 3]; 3],
    pub inliers: Vec<bool>,
}

const MODEL_POINTS: usize = 4;
const RANSAC_REPROJ_THRESHOLD: f64 = 3.0; // calib3d.hpp default
const CONFIDENCE: f64 = 0.995; // calib3d.hpp default
const MAX_ITERS: i32 = 2000; // calib3d.hpp default
const GET_SUBSET_MAX_ATTEMPTS: usize = 10000; // ptsetreg.cpp run()
const LM_REFINE_MAX_ITERS: i32 = 10; // fundam.cpp findHomography
/// `FLT_EPSILON` widened to f64 — used by `scaleFor` and as LMSolver's
/// default `epsx`/`epsf` (levmarq.cpp passes `FLT_EPSILON` as double).
const FLT_EPSILON_F64: f64 = f32::EPSILON as f64;

/// Port of `cv::findHomography(_points1, _points2, RANSAC, 3.0, _mask,
/// 2000, 0.995)` for CV_32FC2 input (the matcher feeds centered `Point2f`).
///
/// Returns `None` where OpenCV returns an empty matrix (fewer than 4
/// points, degenerate kernel on exactly 4 points, or RANSAC failure).
pub fn find_homography(src: &[[f32; 2]], dst: &[[f32; 2]]) -> Option<HomographyResult> {
    let npoints = src.len();
    if npoints != dst.len() || npoints < MODEL_POINTS {
        return None;
    }

    // fundam.cpp: `if( method == 0 || npoints == 4 )` — with exactly 4
    // points RANSAC is skipped, the kernel runs directly and the mask is
    // all-ones regardless of the reprojection error.
    if npoints == MODEL_POINTS {
        let h = run_kernel(src, dst)?;
        return Some(HomographyResult {
            h: to_3x3(&h),
            inliers: vec![true; npoints],
        });
    }

    let (mut h, mut mask) = ransac_run(src, dst)?;

    // fundam.cpp post-polish (`result && npoints > 4`): compress the points
    // to the RANSAC inliers, re-run the DLT kernel on all of them, refine
    // with 10 LM iterations, renormalize so h22 == 1, then recompute the
    // inlier mask over ALL original points against the refined H.
    let mut src_in = Vec::with_capacity(npoints);
    let mut dst_in = Vec::with_capacity(npoints);
    for i in 0..npoints {
        if mask[i] {
            src_in.push(src[i]);
            dst_in.push(dst[i]);
        }
    }
    if !src_in.is_empty() {
        // OpenCV ignores runKernel's return value here: on (unlikely)
        // failure H stays the RANSAC best model and LM still runs.
        if let Some(hk) = run_kernel(&src_in, &dst_in) {
            h = hk;
        }
        lm_refine(&src_in, &dst_in, &mut h, LM_REFINE_MAX_ITERS);
        let scale = scale_for(h[8]);
        for e in h.iter_mut() {
            *e *= scale;
        }

        // `maskptr[i] = errors_ptr[i] <= thr_sqr` — f32 compare, f32 errors.
        let thr_sqr = (RANSAC_REPROJ_THRESHOLD * RANSAC_REPROJ_THRESHOLD) as f32;
        let mut err = vec![0.0f32; npoints];
        compute_error(src, dst, &h, &mut err);
        for i in 0..npoints {
            mask[i] = err[i] <= thr_sqr;
        }
    }

    Some(HomographyResult {
        h: to_3x3(&h),
        inliers: mask,
    })
}

fn to_3x3(h: &[f64; 9]) -> [[f64; 3]; 3] {
    [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]]]
}

/// `scaleFor(double)` from fundam.cpp — note the threshold is FLT_EPSILON
/// even for the double overload.
fn scale_for(x: f64) -> f64 {
    if x.abs() > FLT_EPSILON_F64 {
        1.0 / x
    } else {
        1.0
    }
}

// ---------------------------------------------------------------------------
// HomographyEstimatorCallback (fundam.cpp)
// ---------------------------------------------------------------------------

/// `HomographyEstimatorCallback::runKernel` — DLT with OpenCV's L1-style
/// normalization (shift by centroid, per-axis scale `count / Σ|x - cx|`).
/// `m1` = source points (`M`), `m2` = destination points (`m`).
/// Returns the 3x3 model, row-major, scaled by `scaleFor(H[2][2])`.
fn run_kernel(m1: &[[f32; 2]], m2: &[[f32; 2]]) -> Option<[f64; 9]> {
    let count = m1.len();
    let cf = count as f64;

    // Centroids: cm for dst (m), cM for src (M). Point2f is widened to
    // double on accumulation.
    let (mut cm_x, mut cm_y, mut c_m_x, mut c_m_y) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    for i in 0..count {
        cm_x += m2[i][0] as f64;
        cm_y += m2[i][1] as f64;
        c_m_x += m1[i][0] as f64;
        c_m_y += m1[i][1] as f64;
    }
    cm_x /= cf;
    cm_y /= cf;
    c_m_x /= cf;
    c_m_y /= cf;

    let (mut sm_x, mut sm_y, mut s_m_x, mut s_m_y) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    for i in 0..count {
        sm_x += (m2[i][0] as f64 - cm_x).abs();
        sm_y += (m2[i][1] as f64 - cm_y).abs();
        s_m_x += (m1[i][0] as f64 - c_m_x).abs();
        s_m_y += (m1[i][1] as f64 - c_m_y).abs();
    }

    if sm_x.abs() < f64::EPSILON
        || sm_y.abs() < f64::EPSILON
        || s_m_x.abs() < f64::EPSILON
        || s_m_y.abs() < f64::EPSILON
    {
        return None;
    }
    let sm_x = cf / sm_x;
    let sm_y = cf / sm_y;
    let s_m_x = cf / s_m_x;
    let s_m_y = cf / s_m_y;

    let inv_hnorm = [1.0 / sm_x, 0.0, cm_x, 0.0, 1.0 / sm_y, cm_y, 0.0, 0.0, 1.0];
    let hnorm2 = [
        s_m_x,
        0.0,
        -c_m_x * s_m_x,
        0.0,
        s_m_y,
        -c_m_y * s_m_y,
        0.0,
        0.0,
        1.0,
    ];

    let mut ltl = [0.0f64; 81];
    for i in 0..count {
        let x = (m2[i][0] as f64 - cm_x) * sm_x;
        let y = (m2[i][1] as f64 - cm_y) * sm_y;
        let bx = (m1[i][0] as f64 - c_m_x) * s_m_x;
        let by = (m1[i][1] as f64 - c_m_y) * s_m_y;
        let lx = [bx, by, 1.0, 0.0, 0.0, 0.0, -x * bx, -x * by, -x];
        let ly = [0.0, 0.0, 0.0, bx, by, 1.0, -y * bx, -y * by, -y];
        for j in 0..9 {
            for k in j..9 {
                ltl[j * 9 + k] += lx[j] * lx[k] + ly[j] * ly[k];
            }
        }
    }
    // completeSymm(_LtL): mirror the filled upper triangle.
    for j in 0..9 {
        for k in 0..j {
            ltl[j * 9 + k] = ltl[k * 9 + j];
        }
    }

    let mut w = [0.0f64; 9];
    let mut v = [0.0f64; 81];
    jacobi_eigen(&mut ltl, 9, &mut w, &mut v);

    // Eigenvalues are sorted descending; row 8 of V is the eigenvector of
    // the smallest eigenvalue (`_H0` maps onto `V[8]`).
    let mut h0 = [0.0f64; 9];
    h0.copy_from_slice(&v[72..81]);

    let htemp = mat3_mul(&inv_hnorm, &h0);
    let h = mat3_mul(&htemp, &hnorm2);
    let scale = scale_for(h[8]);
    Some(core::array::from_fn(|i| h[i] * scale))
}

/// Row-major 3x3 multiply, sequential inner accumulation like cv::gemm.
fn mat3_mul(a: &[f64; 9], b: &[f64; 9]) -> [f64; 9] {
    let mut c = [0.0f64; 9];
    for i in 0..3 {
        for j in 0..3 {
            let mut s = 0.0;
            for k in 0..3 {
                s += a[i * 3 + k] * b[k * 3 + j];
            }
            c[i * 3 + j] = s;
        }
    }
    c
}

/// `HomographyEstimatorCallback::computeError` — squared L2 reprojection
/// error, computed ENTIRELY in f32 on an f32-cast H (this is what makes
/// the inlier threshold comparisons reproducible).
fn compute_error(m1: &[[f32; 2]], m2: &[[f32; 2]], model: &[f64; 9], err: &mut [f32]) {
    let hf: [f32; 9] = core::array::from_fn(|i| model[i] as f32);
    for i in 0..m1.len() {
        let mx = m1[i][0];
        let my = m1[i][1];
        // No zero guard, exactly like OpenCV: a vanishing denominator gives
        // inf/nan, which then fails `err <= thr` and marks an outlier.
        let ww = 1.0f32 / (hf[6] * mx + hf[7] * my + hf[8]);
        let dx = (hf[0] * mx + hf[1] * my + hf[2]) * ww - m2[i][0];
        let dy = (hf[3] * mx + hf[4] * my + hf[5]) * ww - m2[i][1];
        err[i] = dx * dx + dy * dy;
    }
}

/// `haveCollinearPoints` (calib3d precomp.hpp). NOTE the OpenCV quirk: only
/// the LAST point (`i = count-1`) is tested against lines through pairs of
/// the earlier points — three collinear points among the first `count-1`
/// are NOT rejected here. Ported as-is.
fn have_collinear_points(pts: &[[f32; 2]], count: usize) -> bool {
    let i = count - 1;
    for j in 0..i {
        // C++: `double dx1 = ptr[j].x - ptr[i].x` — float subtraction, THEN
        // widening. Keep that order.
        let dx1 = (pts[j][0] - pts[i][0]) as f64;
        let dy1 = (pts[j][1] - pts[i][1]) as f64;
        for k in 0..j {
            let dx2 = (pts[k][0] - pts[i][0]) as f64;
            let dy2 = (pts[k][1] - pts[i][1]) as f64;
            if (dx2 * dy1 - dy2 * dx1).abs()
                <= FLT_EPSILON_F64 * (dx1.abs() + dy1.abs() + dx2.abs() + dy2.abs())
            {
                return true;
            }
        }
    }
    false
}

/// 3x3 determinant, cofactor expansion exactly as `cv::Matx_DetOp<double,3>`.
fn det3(a: &[[f64; 3]; 3]) -> f64 {
    a[0][0] * (a[1][1] * a[2][2] - a[2][1] * a[1][2])
        - a[0][1] * (a[1][0] * a[2][2] - a[2][0] * a[1][2])
        + a[0][2] * (a[1][0] * a[2][1] - a[2][0] * a[1][1])
}

/// `HomographyEstimatorCallback::checkSubset` for `count == 4`:
/// collinearity test on both sets plus the Marquez-Neila chirality
/// constraint (all four triangle determinant products must have one sign).
fn check_subset(ms1: &[[f32; 2]; 4], ms2: &[[f32; 2]; 4]) -> bool {
    if have_collinear_points(ms1, 4) || have_collinear_points(ms2, 4) {
        return false;
    }

    const TT: [[usize; 3]; 4] = [[0, 1, 2], [1, 2, 3], [0, 2, 3], [0, 1, 3]];
    let mut negative = 0;
    for t in &TT {
        let a = [
            [ms1[t[0]][0] as f64, ms1[t[0]][1] as f64, 1.0],
            [ms1[t[1]][0] as f64, ms1[t[1]][1] as f64, 1.0],
            [ms1[t[2]][0] as f64, ms1[t[2]][1] as f64, 1.0],
        ];
        let b = [
            [ms2[t[0]][0] as f64, ms2[t[0]][1] as f64, 1.0],
            [ms2[t[1]][0] as f64, ms2[t[1]][1] as f64, 1.0],
            [ms2[t[2]][0] as f64, ms2[t[2]][1] as f64, 1.0],
        ];
        if det3(&a) * det3(&b) < 0.0 {
            negative += 1;
        }
    }
    !(negative != 0 && negative != 4)
}

// ---------------------------------------------------------------------------
// RANSACPointSetRegistrator (ptsetreg.cpp)
// ---------------------------------------------------------------------------

/// `RANSACPointSetRegistrator::getSubset` — draw 4 distinct indices with
/// duplicate rejection (each rejection consumes another `rng.uniform`
/// draw, which is why the RNG port must be call-for-call identical), then
/// validate with `checkSubset`; up to `max_attempts` tries.
fn get_subset(
    m1: &[[f32; 2]],
    m2: &[[f32; 2]],
    rng: &mut CvRng,
    max_attempts: usize,
) -> Option<([[f32; 2]; 4], [[f32; 2]; 4])> {
    let count = m1.len() as i32;
    let mut idx = [0usize; MODEL_POINTS];
    let mut ms1 = [[0.0f32; 2]; MODEL_POINTS];
    let mut ms2 = [[0.0f32; 2]; MODEL_POINTS];

    for _ in 0..max_attempts {
        for i in 0..MODEL_POINTS {
            let mut idx_i = rng.uniform_int(0, count) as usize;
            while idx[..i].contains(&idx_i) {
                idx_i = rng.uniform_int(0, count) as usize;
            }
            idx[i] = idx_i;
            ms1[i] = m1[idx_i];
            ms2[i] = m2[idx_i];
        }
        if check_subset(&ms1, &ms2) {
            return Some((ms1, ms2));
        }
    }
    None
}

/// `RANSACPointSetRegistrator::findInliers` — f32 squared errors compared
/// against `(float)(thresh*thresh)`.
fn find_inliers(
    m1: &[[f32; 2]],
    m2: &[[f32; 2]],
    model: &[f64; 9],
    thresh: f64,
    err: &mut [f32],
    mask: &mut [bool],
) -> usize {
    compute_error(m1, m2, model, err);
    let t = (thresh * thresh) as f32;
    let mut nz = 0usize;
    for i in 0..err.len() {
        let f = err[i] <= t;
        mask[i] = f;
        nz += f as usize;
    }
    nz
}

/// `cv::RANSACUpdateNumIters` — adaptive iteration bound
/// `log(1-p) / log(1-(1-ep)^modelPoints)`, with OpenCV's exact clamping and
/// `cvRound` (round-half-to-even via lrint).
fn ransac_update_num_iters(p: f64, ep: f64, model_points: i32, max_iters: i32) -> i32 {
    let p = p.clamp(0.0, 1.0);
    let ep = ep.clamp(0.0, 1.0);

    // avoid inf's & nan's
    let num = (1.0 - p).max(f64::MIN_POSITIVE); // DBL_MIN
    let denom = 1.0 - (1.0 - ep).powf(model_points as f64);
    if denom < f64::MIN_POSITIVE {
        return 0;
    }

    let num = num.ln();
    let denom = denom.ln();

    if denom >= 0.0 || -num >= max_iters as f64 * (-denom) {
        max_iters
    } else {
        (num / denom).round_ties_even() as i32
    }
}

/// `RANSACPointSetRegistrator::run` with `modelPoints=4, threshold=3.0,
/// confidence=0.995, maxIters=2000`. Only entered for `count > 4` (the
/// driver short-circuits `count == 4`). Returns the best model and mask.
fn ransac_run(m1: &[[f32; 2]], m2: &[[f32; 2]]) -> Option<([f64; 9], Vec<bool>)> {
    let count = m1.len();
    let mut niters = MAX_ITERS.max(1);
    let mut max_good_count = 0usize;

    // The fixed seed that makes OpenCV's RANSAC deterministic.
    let mut rng = CvRng::new(u64::MAX);

    let mut best_mask = vec![false; count];
    let mut mask = vec![false; count];
    let mut best_model = [0.0f64; 9];
    let mut err = vec![0.0f32; count];

    let mut iter = 0i32;
    while iter < niters {
        let subset = get_subset(m1, m2, &mut rng, GET_SUBSET_MAX_ATTEMPTS);
        let (ms1, ms2) = match subset {
            Some(s) => s,
            None => {
                if iter == 0 {
                    return None;
                }
                break;
            }
        };

        // `nmodels <= 0` -> `continue` (which still advances `iter`).
        if let Some(model) = run_kernel(&ms1, &ms2) {
            let good_count =
                find_inliers(m1, m2, &model, RANSAC_REPROJ_THRESHOLD, &mut err, &mut mask);
            if good_count > max_good_count.max(MODEL_POINTS - 1) {
                std::mem::swap(&mut mask, &mut best_mask);
                best_model = model;
                max_good_count = good_count;
                niters = ransac_update_num_iters(
                    CONFIDENCE,
                    (count - good_count) as f64 / count as f64,
                    MODEL_POINTS as i32,
                    niters,
                );
            }
        }
        iter += 1;
    }

    if max_good_count > 0 {
        Some((best_model, best_mask))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// LMSolverImpl (levmarq.cpp) + HomographyRefineCallback (fundam.cpp)
// ---------------------------------------------------------------------------

/// `HomographyRefineCallback::compute` — double-precision residuals
/// (`2*count` of them) and, when requested, the 2Nx9 Jacobian. The Jacobian
/// buffer is zero-filled on every call (OpenCV does `_Jac.setTo(0.)`).
fn refine_compute(
    src: &[[f32; 2]],
    dst: &[[f32; 2]],
    h: &[f64; 9],
    err: &mut [f64],
    mut jac: Option<&mut [f64]>,
) {
    if let Some(j) = jac.as_deref_mut() {
        for e in j.iter_mut() {
            *e = 0.0;
        }
    }
    for i in 0..src.len() {
        let mx = src[i][0] as f64;
        let my = src[i][1] as f64;
        let mut ww = h[6] * mx + h[7] * my + h[8];
        ww = if ww.abs() > f64::EPSILON {
            1.0 / ww
        } else {
            0.0
        };
        let xi = (h[0] * mx + h[1] * my + h[2]) * ww;
        let yi = (h[3] * mx + h[4] * my + h[5]) * ww;
        err[i * 2] = xi - dst[i][0] as f64;
        err[i * 2 + 1] = yi - dst[i][1] as f64;

        if let Some(j) = jac.as_deref_mut() {
            let row = i * 18;
            j[row] = mx * ww;
            j[row + 1] = my * ww;
            j[row + 2] = ww;
            j[row + 6] = -mx * ww * xi;
            j[row + 7] = -my * ww * xi;
            j[row + 8] = -ww * xi;
            j[row + 12] = mx * ww;
            j[row + 13] = my * ww;
            j[row + 14] = ww;
            j[row + 15] = -mx * ww * yi;
            j[row + 16] = -my * ww * yi;
            j[row + 17] = -ww * yi;
        }
    }
}

/// `norm(x, NORM_L2SQR)` with OpenCV's scalar `CV_ENABLE_UNROLLED` 4-way
/// grouping (`normL2Sqr` in base.hpp) so the summation order matches.
fn norm_l2sqr(a: &[f64]) -> f64 {
    let n = a.len();
    let mut s = 0.0f64;
    let mut i = 0usize;
    while i + 4 <= n {
        let (v0, v1, v2, v3) = (a[i], a[i + 1], a[i + 2], a[i + 3]);
        s += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;
        i += 4;
    }
    while i < n {
        let v = a[i];
        s += v * v;
        i += 1;
    }
    s
}

fn norm_inf(a: &[f64]) -> f64 {
    let mut m = 0.0f64;
    for &v in a {
        m = m.max(v.abs());
    }
    m
}

/// `Mat::dot` — 4-way unrolled accumulation like OpenCV's `dotProd_`.
fn dot(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len();
    let mut s = 0.0f64;
    let mut i = 0usize;
    while i + 4 <= n {
        s += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3];
        i += 4;
    }
    while i < n {
        s += a[i] * b[i];
        i += 1;
    }
    s
}

/// `mulTransposed(J, A, true)`: `A = JᵀJ` (9x9), upper triangle computed
/// then mirrored (A is exactly symmetric, as OpenCV produces).
fn mul_transposed(j: &[f64], rows: usize, a: &mut [f64; 81]) {
    for c1 in 0..9 {
        for c2 in c1..9 {
            let mut s = 0.0f64;
            for k in 0..rows {
                s += j[k * 9 + c1] * j[k * 9 + c2];
            }
            a[c1 * 9 + c2] = s;
            a[c2 * 9 + c1] = s;
        }
    }
}

/// `gemm(J, r, 1, noArray(), 0, v, GEMM_1_T)`: `v = Jᵀ r`.
fn jt_mul_vec(j: &[f64], rows: usize, r: &[f64], v: &mut [f64; 9]) {
    for c in 0..9 {
        let mut s = 0.0f64;
        for k in 0..rows {
            s += j[k * 9 + c] * r[k];
        }
        v[c] = s;
    }
}

/// `LMSolverImpl::run` (levmarq.cpp), specialized to the 9-parameter
/// homography callback. Faithful quirks preserved:
/// - the damping diagonal `D = diag(A)` is captured ONCE from the initial
///   `A = JᵀJ` and never refreshed, even after accepted steps;
/// - lambda schedule: `R > 0.75` halves lambda and snaps it to 0 below
///   `lc`; `R < 0.25` multiplies by `nu = clamp((Sd-S)/(d·v) + 2, 2, 10)`,
///   and when lambda was 0 it is restarted at `1/max|diag(pinv(A))|` (with
///   `nu` halved), which also becomes the new `lc`;
/// - termination: `iter >= maxIters` or `||d||_inf < FLT_EPSILON` or
///   `||r||_inf < FLT_EPSILON`, checked after the (possibly rejected) step;
/// - linear solves use eigendecomposition with OpenCV's DECOMP_EIG
///   thresholding, which tolerates the exactly-singular `A` (`J·h = 0`
///   because the residual is scale-invariant in h).
fn lm_refine(src: &[[f32; 2]], dst: &[[f32; 2]], param: &mut [f64; 9], max_iters: i32) {
    let nresid = 2 * src.len();

    let mut x = *param;
    let mut xd = [0.0f64; 9];
    let mut r = vec![0.0f64; nresid];
    let mut rd = vec![0.0f64; nresid];
    let mut jac = vec![0.0f64; nresid * 9];

    refine_compute(src, dst, &x, &mut r, Some(&mut jac));
    let mut s_cur = norm_l2sqr(&r);

    let mut a = [0.0f64; 81];
    let mut v = [0.0f64; 9];
    mul_transposed(&jac, nresid, &mut a);
    jt_mul_vec(&jac, nresid, &r, &mut v);

    // `Mat D = A.diag().clone();` — fixed for the whole run.
    let d_diag: [f64; 9] = core::array::from_fn(|i| a[i * 9 + i]);

    const R_LO: f64 = 0.25;
    const R_HI: f64 = 0.75;
    let mut lambda = 1.0f64;
    let mut lc = 0.75f64;
    let mut iter = 0i32;

    let mut ap = [0.0f64; 81];
    let mut d = [0.0f64; 9];

    loop {
        ap.copy_from_slice(&a);
        for i in 0..9 {
            ap[i * 9 + i] += lambda * d_diag[i];
        }
        eig_solve(&ap, &v, &mut d);
        for i in 0..9 {
            xd[i] = x[i] - d[i];
        }

        refine_compute(src, dst, &xd, &mut rd, None);
        let sd = norm_l2sqr(&rd);

        // gemm(A, d, -1, v, 2, temp_d); dS = d.dot(temp_d)
        let mut temp_d = [0.0f64; 9];
        for i in 0..9 {
            let s = dot(&a[i * 9..i * 9 + 9], &d);
            temp_d[i] = -s + 2.0 * v[i];
        }
        let ds = dot(&d, &temp_d);
        let ratio = (s_cur - sd) / (if ds.abs() > f64::EPSILON { ds } else { 1.0 });

        if ratio > R_HI {
            lambda *= 0.5;
            if lambda < lc {
                lambda = 0.0;
            }
        } else if ratio < R_LO {
            let t = dot(&d, &v);
            let mut nu = (sd - s_cur) / (if t.abs() > f64::EPSILON { t } else { 1.0 }) + 2.0;
            nu = nu.clamp(2.0, 10.0);
            if lambda == 0.0 {
                let maxval = eig_pinv_diag_max(&a);
                lambda = 1.0 / maxval;
                lc = lambda;
                nu *= 0.5;
            }
            lambda *= nu;
        }

        if sd < s_cur {
            s_cur = sd;
            std::mem::swap(&mut x, &mut xd);
            refine_compute(src, dst, &x, &mut r, Some(&mut jac));
            mul_transposed(&jac, nresid, &mut a);
            jt_mul_vec(&jac, nresid, &r, &mut v);
        }

        iter += 1;
        let proceed =
            iter < max_iters && norm_inf(&d) >= FLT_EPSILON_F64 && norm_inf(&r) >= FLT_EPSILON_F64;
        if !proceed {
            break;
        }
    }

    *param = x;
}

// ---------------------------------------------------------------------------
// OpenCV linear algebra: JacobiImpl_ / SVBkSbImpl_ (lapack.cpp)
// ---------------------------------------------------------------------------

#[inline]
fn rot(buf: &mut [f64], i0: usize, i1: usize, c: f64, s: f64) {
    let a0 = buf[i0];
    let b0 = buf[i1];
    buf[i0] = a0 * c - b0 * s;
    buf[i1] = a0 * s + b0 * c;
}

/// Verbatim port of `JacobiImpl_<double>` (lapack.cpp): cyclic Jacobi with
/// per-row max-pivot bookkeeping. `a` (row-major n*n) is destroyed;
/// eigenvalues land in `w` sorted DESCENDING; eigenvectors are the ROWS of
/// `v`. The reference cv2 build (Eigen: NO) runs exactly this routine for
/// `cv::eigen`, `solve(DECOMP_EIG)` and `invert(DECOMP_EIG)`.
fn jacobi_eigen(a: &mut [f64], n: usize, w: &mut [f64], v: &mut [f64]) {
    let eps = f64::EPSILON;

    for i in 0..n {
        for j in 0..n {
            v[i * n + j] = 0.0;
        }
        v[i * n + i] = 1.0;
    }

    let max_iters = n * n * 30;
    let mut ind_r = vec![0usize; n];
    let mut ind_c = vec![0usize; n];

    for k in 0..n {
        w[k] = a[(n + 1) * k];
        if k < n - 1 {
            let mut m = k + 1;
            let mut mv = a[n * k + m].abs();
            for i in (k + 2)..n {
                let val = a[n * k + i].abs();
                if mv < val {
                    mv = val;
                    m = i;
                }
            }
            ind_r[k] = m;
        }
        if k > 0 {
            let mut m = 0;
            let mut mv = a[k].abs();
            for i in 1..k {
                let val = a[n * i + k].abs();
                if mv < val {
                    mv = val;
                    m = i;
                }
            }
            ind_c[k] = m;
        }
    }

    if n > 1 {
        for _iters in 0..max_iters {
            // find index (k,l) of pivot p
            let mut k = 0usize;
            let mut mv = a[ind_r[0]].abs();
            for i in 1..(n - 1) {
                let val = a[n * i + ind_r[i]].abs();
                if mv < val {
                    mv = val;
                    k = i;
                }
            }
            let mut l = ind_r[k];
            for i in 1..n {
                let val = a[n * ind_c[i] + i].abs();
                if mv < val {
                    mv = val;
                    k = ind_c[i];
                    l = i;
                }
            }

            let p = a[n * k + l];
            if p.abs() <= eps {
                break;
            }
            let y = (w[l] - w[k]) * 0.5;
            let mut t = y.abs() + p.hypot(y);
            let s_denom = p.hypot(t);
            let c = t / s_denom;
            let mut s = p / s_denom;
            t = (p / t) * p;
            if y < 0.0 {
                s = -s;
                t = -t;
            }
            a[n * k + l] = 0.0;

            w[k] -= t;
            w[l] += t;

            // rotate rows and columns k and l
            for i in 0..k {
                rot(a, n * i + k, n * i + l, c, s);
            }
            for i in (k + 1)..l {
                rot(a, n * k + i, n * i + l, c, s);
            }
            for i in (l + 1)..n {
                rot(a, n * k + i, n * l + i, c, s);
            }
            // rotate eigenvectors
            for i in 0..n {
                rot(v, n * k + i, n * l + i, c, s);
            }

            for j in 0..2 {
                let idx = if j == 0 { k } else { l };
                if idx < n - 1 {
                    let mut m = idx + 1;
                    let mut mv2 = a[n * idx + m].abs();
                    for i in (idx + 2)..n {
                        let val = a[n * idx + i].abs();
                        if mv2 < val {
                            mv2 = val;
                            m = i;
                        }
                    }
                    ind_r[idx] = m;
                }
                if idx > 0 {
                    let mut m = 0;
                    let mut mv2 = a[idx].abs();
                    for i in 1..idx {
                        let val = a[n * i + idx].abs();
                        if mv2 < val {
                            mv2 = val;
                            m = i;
                        }
                    }
                    ind_c[idx] = m;
                }
            }
        }
    }

    // sort eigenvalues & eigenvectors (descending, selection sort with row
    // swaps — same tie behavior as OpenCV)
    for k in 0..(n - 1) {
        let mut m = k;
        for i in (k + 1)..n {
            if w[m] < w[i] {
                m = i;
            }
        }
        if k != m {
            w.swap(m, k);
            for i in 0..n {
                v.swap(n * m + i, n * k + i);
            }
        }
    }
}

/// `solve(Ap, v, d, DECOMP_EIG)` for a symmetric 9x9 system: Jacobi
/// eigendecomposition + `SVBkSbImpl_` back-substitution
/// (`x = Σ_i e_i (e_i·b)/w_i` over `|w_i| > 2*DBL_EPSILON*Σw`). The
/// thresholding is what handles the exactly-singular `A` when the LM
/// damping is zero.
fn eig_solve(a: &[f64; 81], b: &[f64; 9], x: &mut [f64; 9]) {
    let mut ac = *a;
    let mut w = [0.0f64; 9];
    let mut v = [0.0f64; 81];
    jacobi_eigen(&mut ac, 9, &mut w, &mut v);

    for e in x.iter_mut() {
        *e = 0.0;
    }

    let mut threshold = 0.0f64;
    for i in 0..9 {
        threshold += w[i];
    }
    threshold *= f64::EPSILON * 2.0;

    for i in 0..9 {
        let wi = w[i];
        if wi.abs() <= threshold {
            continue;
        }
        let wi = 1.0 / wi;
        let mut s = 0.0f64;
        for j in 0..9 {
            s += v[i * 9 + j] * b[j];
        }
        s *= wi;
        for j in 0..9 {
            x[j] += s * v[i * 9 + j];
        }
    }
}

/// `invert(A, Ap, DECOMP_EIG)` followed by LMSolver's
/// `maxval = max(DBL_EPSILON, max_i |Ap(i,i)|)`. Only the diagonal of the
/// pseudo-inverse is needed: `Ap(j,j) = Σ_i e_i[j]·(e_i[j]/w_i)` over
/// `|w_i| > 2*DBL_EPSILON*Σw` (multiplication order as in `SVBkSbImpl_`).
fn eig_pinv_diag_max(a: &[f64; 81]) -> f64 {
    let mut ac = *a;
    let mut w = [0.0f64; 9];
    let mut v = [0.0f64; 81];
    jacobi_eigen(&mut ac, 9, &mut w, &mut v);

    let mut threshold = 0.0f64;
    for i in 0..9 {
        threshold += w[i];
    }
    threshold *= f64::EPSILON * 2.0;

    let mut maxval = f64::EPSILON;
    for j in 0..9 {
        let mut dj = 0.0f64;
        for i in 0..9 {
            let wi = w[i];
            if wi.abs() <= threshold {
                continue;
            }
            dj += v[i * 9 + j] * (v[i * 9 + j] * (1.0 / wi));
        }
        maxval = maxval.max(dj.abs());
    }
    maxval
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply_h(h: &[f64; 9], p: [f32; 2]) -> [f64; 2] {
        let (x, y) = (p[0] as f64, p[1] as f64);
        let w = h[6] * x + h[7] * y + h[8];
        [
            (h[0] * x + h[1] * y + h[2]) / w,
            (h[3] * x + h[4] * y + h[5]) / w,
        ]
    }

    #[test]
    fn jacobi_eigen_diagonalizes() {
        // Symmetric 4x4 with known structure; verify A v_i = w_i v_i and
        // descending order.
        let a0 = [
            4.0, 1.0, 0.5, 0.25, 1.0, 3.0, 0.75, 0.5, 0.5, 0.75, 2.0, 1.0, 0.25, 0.5, 1.0, 1.0,
        ];
        let mut a = a0;
        let mut w = [0.0f64; 4];
        let mut v = [0.0f64; 16];
        jacobi_eigen(&mut a, 4, &mut w, &mut v);
        for i in 0..3 {
            assert!(w[i] >= w[i + 1], "eigenvalues not descending: {:?}", w);
        }
        for i in 0..4 {
            for r in 0..4 {
                let mut av = 0.0;
                for c in 0..4 {
                    av += a0[r * 4 + c] * v[i * 4 + c];
                }
                assert!(
                    (av - w[i] * v[i * 4 + r]).abs() < 1e-12,
                    "A v != w v for eigenpair {i}"
                );
            }
        }
    }

    #[test]
    fn ransac_update_num_iters_matches_reference() {
        // Reference values from a C build of the verbatim OpenCV routine.
        assert_eq!(ransac_update_num_iters(0.995, 0.0, 4, 2000), 0);
        assert_eq!(ransac_update_num_iters(0.995, 0.1, 4, 2000), 5);
        assert_eq!(ransac_update_num_iters(0.995, 0.3, 4, 2000), 19);
        assert_eq!(ransac_update_num_iters(0.995, 0.5, 4, 2000), 82);
        assert_eq!(ransac_update_num_iters(0.995, 0.8, 4, 2000), 2000);
        assert_eq!(ransac_update_num_iters(0.995, 1.0, 4, 2000), 2000);
        assert_eq!(ransac_update_num_iters(0.995, 26.0 / 30.0, 4, 2000), 2000);
    }

    #[test]
    fn collinear_points_rejected() {
        // Last point exactly on the line through two earlier points.
        let pts = [[0.0f32, 0.0], [10.0, 0.0], [5.0, 5.0], [20.0, 0.0]];
        assert!(have_collinear_points(&pts, 4));
        // OpenCV quirk: collinearity among the FIRST three only is not
        // detected (only the last point is tested).
        let pts2 = [[0.0f32, 0.0], [10.0, 0.0], [20.0, 0.0], [5.0, 5.0]];
        assert!(!have_collinear_points(&pts2, 4));
    }

    #[test]
    fn four_point_exact() {
        let h_true = [1.1, 0.02, 5.0, -0.01, 0.95, -3.0, 1e-4, -5e-5, 1.0];
        let src = [[0.0f32, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
        let dst: Vec<[f32; 2]> = src
            .iter()
            .map(|&p| {
                let q = apply_h(&h_true, p);
                [q[0] as f32, q[1] as f32]
            })
            .collect();
        let res = find_homography(&src, &dst).expect("4-point homography");
        assert_eq!(res.inliers, vec![true; 4]);
        assert!((res.h[2][2] - 1.0).abs() < 1e-12);
        for r in 0..3 {
            for c in 0..3 {
                assert!(
                    (res.h[r][c] - h_true[r * 3 + c]).abs() < 1e-6,
                    "H mismatch at ({r},{c}): {} vs {}",
                    res.h[r][c],
                    h_true[r * 3 + c]
                );
            }
        }
    }

    #[test]
    fn ransac_rejects_outliers() {
        let h_true = [0.9, -0.05, 20.0, 0.04, 1.05, -10.0, 2e-5, 1e-5, 1.0];
        // Deterministic pseudo-random points (no external RNG needed).
        let mut pts = Vec::new();
        let mut s = 1u64;
        let mut next = || {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((s >> 33) as f64 / (1u64 << 31) as f64) * 400.0
        };
        for _ in 0..40 {
            pts.push([next() as f32, (next() * 0.75) as f32]);
        }
        let mut dst: Vec<[f32; 2]> = pts
            .iter()
            .map(|&p| {
                let q = apply_h(&h_true, p);
                [q[0] as f32, q[1] as f32]
            })
            .collect();
        // 8 gross outliers.
        for i in 0..8 {
            dst[i * 5] = [(next() + 500.0) as f32, (next() + 400.0) as f32];
        }
        let res = find_homography(&pts, &dst).expect("RANSAC homography");
        for i in 0..8 {
            assert!(!res.inliers[i * 5], "outlier {} marked inlier", i * 5);
        }
        let ninl = res.inliers.iter().filter(|&&b| b).count();
        assert!(ninl >= 30, "too few inliers: {ninl}");
        for r in 0..3 {
            for c in 0..3 {
                assert!(
                    (res.h[r][c] - h_true[r * 3 + c]).abs() < 1e-4,
                    "H mismatch at ({r},{c})"
                );
            }
        }
    }
}
