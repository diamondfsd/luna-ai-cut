//! Bundle adjustment — port of `cv::detail::BundleAdjusterRay` driven by the
//! legacy Levenberg–Marquardt solver (`cv::LevMarq`, calibration.cpp:570-780,
//! the C++ re-implementation of `CvLevMarq` from compat_ptsetreg.cpp).
//!
//! Sources (OpenCV 4.14.0, the oracle build):
//! * driver + Ray cost:  stitching/src/motion_estimators.cpp:222-321, 507-643
//! * LevMarq:            calib3d/src/calibration.cpp:570-780
//! * Rodrigues:          calib3d/src/calibration_base.cpp:121-368
//! * JacobiSVD/solve:    core/src/lapack.cpp (JacobiSVDImpl_, SVBkSb, solve)
//! * gemm kernels:       core/src/matmul.simd.hpp (GEMMSingleMul,
//!   simdGEMM_kj, simdDotProduct, and gemmImpl's block dispatch)
//! * norm kernels:       core/src/norm.simd.hpp (NormL2_SIMD/NormDiffL2_SIMD)
//!
//! # Bit-parity notes (see tests/bundle_parity.rs)
//!
//! The numeric kernels in [`cvnum`] reproduce the oracle wheel's arithmetic
//! *as compiled*: opencv-python 4.14.0 on arm64 is built by clang with the
//! default `-ffp-contract=on`, so every `x*y + z` written as one C++
//! expression becomes a fused multiply-add (LHS-multiply fused first when
//! both add operands are products — verified against cv2), and the universal
//! intrinsics (`v_muladd`/`v_fma`, 128-bit NEON) are true FMAs. We emulate
//! the NEON lane structure of the norm/gemm kernels scalar-wise, including
//! clang's auto-unrolled scalar tail of `NormL2_SIMD` (groups of 4 plain
//! mul+add, then FMA remainder — decoded from the wheel's disassembly).
//!
//! One genuinely irreducible deviation: that wheel is built WITH_LAPACK
//! (Apple Accelerate). OpenCV delegates `gemm` to `cblas_dgemm` when the
//! left operand has >= 100 rows and the LM solve's SVD to `dgesdd` when the
//! system has >= 25 rows (core/src/hal_internal.cpp thresholds), so on real
//! problem sizes the oracle's JtJ/JtErr/solve go through closed-source
//! Accelerate kernels whose summation order cannot be reproduced portably.
//! This port implements OpenCV's own (non-LAPACK) kernels — identical to an
//! OpenCV build without LAPACK — which tracks the Accelerate results to a
//! few ulps per operation; the LM iteration is self-correcting, so the final
//! cameras agree with the oracle far below the parity tolerances.

// Index-based loops deliberately mirror the C++ kernels line by line so the
// numerics stay auditable against the OpenCV sources.
#![allow(clippy::needless_range_loop)]

use crate::camera::CameraParams;
use crate::estimation::{find_max_spanning_tree, FeatureSet, MatchGraph};

/// Stitcher PANORAMA-mode confidence threshold (stitcher.cpp:512), baked in.
pub const CONF_THRESH: f64 = 1.0;

const NUM_PARAMS_PER_CAM: usize = 4;
const NUM_ERRS_PER_MEASUREMENT: usize = 3;

/// Parameter count above which `LevMarq::step` leaves OpenCV's `DECOMP_SVD`
/// for an LDL^T solve (see [`LevMarq::step`]). 160 params = 40 cameras; the
/// BA oracle-parity dumps top out at 26 cameras (104 params), so they stay
/// on the reference path and stay bit-exact.
const LDLT_MIN_PARAMS: usize = 160;

/// Relative ridge added to the damped diagonal on the LDL^T path only, to
/// lift the ray cost's 3 gauge directions out of rounding noise.
const GAUGE_RIDGE_REL: f64 = 1e-9;

/// Parameter-change threshold LM stops at, above [`LDLT_MIN_PARAMS`].
///
/// OpenCV's criterion is `DBL_EPSILON`, which a large problem never reaches:
/// traced on a 137-shot set the relative parameter change plateaus near
/// 1.2e-5 decaying like 1/n, so LM always runs the full `max_count` of
/// 1000. Those iterations are not doing work — 25 to 200 cuts the error
/// 41%, while 400 to 1000 buys 1.1% for 60% of the runtime.
///
/// 5e-5 lands near iteration 410 on that curve: ~2.4x less bundle
/// adjustment for ~1.1% more residual. Small problems keep OpenCV's exact
/// criterion, so every parity dataset is unaffected.
const PRACTICAL_PARAM_EPS: f64 = 5e-5;

/// Verbatim ports of the OpenCV numeric kernels the bundle adjuster runs on.
/// Public so the parity tests can validate each primitive against cv2
/// fixtures; not part of the crate's stable API.
pub mod cvnum {
    pub type Mat3 = [[f64; 3]; 3];
    pub type Mat3f = [[f32; 3]; 3];

    /// `x*y + z` contracted to a fused multiply-add, as clang emits for a
    /// single C++ expression with `-ffp-contract=on` on arm64.
    #[inline(always)]
    fn fma(x: f64, y: f64, z: f64) -> f64 {
        x.mul_add(y, z)
    }

    #[inline(always)]
    fn fmaf(x: f32, y: f32, z: f32) -> f32 {
        x.mul_add(y, z)
    }

    // -----------------------------------------------------------------
    // norm kernels (norm.simd.hpp, CV_64F, 128-bit NEON lanes)
    // -----------------------------------------------------------------

    /// `NormL2_SIMD<double, double>`: stride-8 main loop with four 2-lane
    /// FMA accumulators, combined `((r00+r01)+r10)+r11` lane-wise then
    /// `lane0+lane1`. The scalar tail is clang's compiled form (decoded from
    /// the wheel's `normL2_64f` disassembly): groups of 4 as plain mul+add
    /// in element order, then per-element FMA for the `tail % 4` remainder.
    pub fn norm_l2_sqr(x: &[f64]) -> f64 {
        let n = x.len();
        let mut l = [0.0f64; 8];
        let mut j = 0;
        while j + 8 <= n {
            for t in 0..8 {
                l[t] = fma(x[j + t], x[j + t], l[t]);
            }
            j += 8;
        }
        let lane0 = ((l[0] + l[2]) + l[4]) + l[6];
        let lane1 = ((l[1] + l[3]) + l[5]) + l[7];
        let mut s = lane0 + lane1;
        let t = n - j;
        if t >= 4 {
            let u = t & !3;
            for g in (j..j + u).step_by(4) {
                let p0 = x[g] * x[g];
                let p1 = x[g + 1] * x[g + 1];
                let p2 = x[g + 2] * x[g + 2];
                let p3 = x[g + 3] * x[g + 3];
                s += p0;
                s += p1;
                s += p2;
                s += p3;
            }
            j += u;
        }
        while j < n {
            s = fma(x[j], x[j], s);
            j += 1;
        }
        s
    }

    /// `cv::norm(x, NORM_L2)` for a continuous CV_64F array.
    pub fn norm_l2(x: &[f64]) -> f64 {
        norm_l2_sqr(x).sqrt()
    }

    /// `NormDiffL2_SIMD<double, double>` — same structure over `|a - b|`.
    pub fn norm_diff_l2_sqr(a: &[f64], b: &[f64]) -> f64 {
        let n = a.len();
        let mut l = [0.0f64; 8];
        let mut j = 0;
        while j + 8 <= n {
            for t in 0..8 {
                let v = (a[j + t] - b[j + t]).abs();
                l[t] = fma(v, v, l[t]);
            }
            j += 8;
        }
        let lane0 = ((l[0] + l[2]) + l[4]) + l[6];
        let lane1 = ((l[1] + l[3]) + l[5]) + l[7];
        let mut s = lane0 + lane1;
        let t = n - j;
        if t >= 4 {
            let u = t & !3;
            for g in (j..j + u).step_by(4) {
                let v0 = a[g] - b[g];
                let v1 = a[g + 1] - b[g + 1];
                let v2 = a[g + 2] - b[g + 2];
                let v3 = a[g + 3] - b[g + 3];
                let p0 = v0 * v0;
                let p1 = v1 * v1;
                let p2 = v2 * v2;
                let p3 = v3 * v3;
                s += p0;
                s += p1;
                s += p2;
                s += p3;
            }
            j += u;
        }
        while j < n {
            let v = a[j] - b[j];
            s = fma(v, v, s);
            j += 1;
        }
        s
    }

    /// `cv::norm(a, b, NORM_L2 | NORM_RELATIVE)` =
    /// `norm(a - b) / (norm(b) + DBL_EPSILON)` (norm.dispatch.cpp:580).
    pub fn norm_rel_l2(a: &[f64], b: &[f64]) -> f64 {
        norm_diff_l2_sqr(a, b).sqrt() / (norm_l2(b) + f64::EPSILON)
    }

    // -----------------------------------------------------------------
    // gemm kernels (matmul.simd.hpp) for the JtJ / JtErr products
    // -----------------------------------------------------------------

    /// k-outer/j-inner FMA accumulation of one output row of `Jᵀ·J`
    /// (`simdGEMM_kj` / `simdBlockMul_kj`: every column is a `v_muladd`
    /// lane; the odd trailing column is the scalar `s += a*b`, contracted).
    fn kj_row(a_col: &[f64], j: &[f64], rows: usize, cols: usize, out: &mut [f64]) {
        let mut s = vec![0.0f64; cols];
        let even = cols & !1;
        for (k, &a) in a_col.iter().enumerate().take(rows) {
            let b = &j[k * cols..k * cols + cols];
            for (sj, &bj) in s[..even].iter_mut().zip(&b[..even]) {
                *sj = fma(a, bj, *sj);
            }
            if even < cols {
                s[cols - 1] = fma(a, b[cols - 1], s[cols - 1]);
            }
        }
        out[..cols].copy_from_slice(&s); // d = s_buf * alpha, alpha = 1
    }

    /// GEMMSingleMul's scalar "4-column j-outer" branch (taken when the kj
    /// SIMD path is skipped: fewer than 4 columns or fewer than 64 rows).
    fn fourcol_row(a_col: &[f64], j: &[f64], rows: usize, cols: usize, out: &mut [f64]) {
        let mut c = 0;
        while c + 4 <= cols {
            let (mut s0, mut s1, mut s2, mut s3) = (0.0, 0.0, 0.0, 0.0);
            for (k, &a) in a_col.iter().enumerate().take(rows) {
                let b = &j[k * cols + c..k * cols + c + 4];
                s0 = fma(a, b[0], s0);
                s1 = fma(a, b[1], s1);
                s2 = fma(a, b[2], s2);
                s3 = fma(a, b[3], s3);
            }
            out[c] = s0;
            out[c + 1] = s1;
            out[c + 2] = s2;
            out[c + 3] = s3;
            c += 4;
        }
        while c < cols {
            let mut s0 = 0.0;
            for (k, &a) in a_col.iter().enumerate().take(rows) {
                s0 = fma(a, j[k * cols + c], s0);
            }
            out[c] = s0;
            c += 1;
        }
    }

    /// gemmImpl's single-vs-blocked dispatch for `Jᵀ·J` (d = cols x cols,
    /// len = rows). The blocked path chunks k but accumulates through the
    /// work buffer with the same per-element FMA stream as the kj path, so
    /// both resolve to `kj_row`; only the small single-path case falls back
    /// to the scalar 4-column branch.
    pub fn gemm_jtj(j: &[f64], rows: usize, cols: usize, out: &mut [f64]) {
        debug_assert_eq!(j.len(), rows * cols);
        debug_assert_eq!(out.len(), cols * cols);
        let single = (cols <= 64 && rows <= 10000) || rows <= 10 || (cols <= 128 && rows <= 128);
        let kj = !single || (cols >= 4 && rows >= 64);
        // Output row `i` depends only on `j`, so the rows fan out. Each row
        // still runs the identical scalar FMA stream, which keeps the result
        // bit-for-bit equal to the serial form (and to the no-`parallel`
        // build) — same guarantee the `par` helpers carry elsewhere.
        // `a_col` is scratch, so it is allocated per WORKER, not per row:
        // `rows` is 3x the inlier count, and one allocation of that per
        // output row (548 of them on a 137-shot set, every LM iteration)
        // starves the browser's shared wasm allocator.
        crate::par::for_each_chunk_mut_init(
            out,
            cols,
            || vec![0.0f64; rows],
            |a_col, i, out_row| {
                for (k, a) in a_col.iter_mut().enumerate() {
                    *a = j[k * cols + i];
                }
                if kj {
                    kj_row(a_col, j, rows, cols, out_row);
                } else {
                    fourcol_row(a_col, j, rows, cols, out_row);
                }
            },
        );
    }

    /// `simdDotProduct` for doubles: stride-8 loop into four 2-lane FMA
    /// accumulators combined `(vs0+vs1)+(vs2+vs3)`, stride-2 remainder into
    /// the first accumulator, `lane0+lane1` reduce, then the caller's scalar
    /// tail (at most one element, contracted FMA).
    fn dot_simd(a: &[f64], b: &[f64], n: usize) -> f64 {
        let mut l = [0.0f64; 8];
        let mut k = 0;
        while k + 8 <= n {
            for t in 0..8 {
                l[t] = fma(a[k + t], b[k + t], l[t]);
            }
            k += 8;
        }
        let mut lane0 = (l[0] + l[2]) + (l[4] + l[6]);
        let mut lane1 = (l[1] + l[3]) + (l[5] + l[7]);
        while k + 2 <= n {
            lane0 = fma(a[k], b[k], lane0);
            lane1 = fma(a[k + 1], b[k + 1], lane1);
            k += 2;
        }
        let mut s = lane0 + lane1;
        while k < n {
            s = fma(a[k], b[k], s);
            k += 1;
        }
        s
    }

    /// `Jᵀ·err` (gemm with GEMM_1_T and a column-vector right operand): the
    /// dispatch turns it into per-row dot products; rows > 10000 goes to the
    /// blocked path which accumulates chunk dot-products sequentially.
    pub fn gemm_jterr(j: &[f64], rows: usize, cols: usize, e: &[f64], out: &mut [f64]) {
        debug_assert_eq!(j.len(), rows * cols);
        debug_assert_eq!(e.len(), rows);
        debug_assert_eq!(out.len(), cols);
        let mut a_col = vec![0.0f64; rows];
        if rows <= 10000 {
            for i in 0..cols {
                for (k, a) in a_col.iter_mut().enumerate() {
                    *a = j[k * cols + i];
                }
                out[i] = dot_simd(&a_col, e, rows); // s0 * alpha, alpha = 1
            }
        } else {
            // gemmImpl blocked path: block_lin_size = 128, block_size = 128².
            let block_size = 128usize * 128;
            let mut dm0 = 128usize.min(cols);
            let dk0 = (block_size / dm0).min(block_size).min(rows);
            if dk0 * dm0 > block_size {
                dm0 = block_size / dk0;
            }
            let mut chunks = Vec::new();
            let mut k = 0;
            while k < rows {
                let mut dk = dk0;
                if k + dk >= rows || 8 * (k + dk) + dk > 8 * rows {
                    dk = rows - k;
                }
                chunks.push((k, dk));
                k += dk;
            }
            let mut i0 = 0;
            while i0 < cols {
                let mut di = dm0;
                if i0 + di >= cols || 8 * (i0 + di) + di > 8 * cols {
                    di = cols - i0;
                }
                for i in i0..i0 + di {
                    let mut acc = 0.0f64;
                    for &(k0, dk) in &chunks {
                        for (k, a) in a_col.iter_mut().enumerate().take(dk) {
                            *a = j[(k0 + k) * cols + i];
                        }
                        // GEMMBlockMul 2T branch: s0 = (acc) + chunk dot.
                        acc += dot_simd(&a_col[..dk], &e[k0..k0 + dk], dk);
                    }
                    out[i] = acc; // GEMMStore: alpha*d_buf, alpha = 1
                }
                i0 += di;
            }
        }
    }

    // -----------------------------------------------------------------
    // small 3x3 kernels
    // -----------------------------------------------------------------

    /// gemmImpl's `flags == 0 && len == 3` small path for CV_64F:
    /// `t = a0*b0 + a1*b1 + a2*b2` contracted per clang's LHS-first rule to
    /// `fma(a2, b2, fma(a0, b0, a1*b1))`, stored as `t*alpha + 0*beta`.
    pub fn gemm3x3_f64(a: &Mat3, b: &Mat3) -> Mat3 {
        let mut d = [[0.0f64; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let t = fma(a[i][2], b[2][j], fma(a[i][0], b[0][j], a[i][1] * b[1][j]));
                d[i][j] = t * 1.0 + 0.0;
            }
        }
        d
    }

    /// Same small path for CV_32F (float accumulation, then the
    /// `(float)(t0*alpha + c*beta)` store goes through double).
    pub fn gemm3x3_f32(a: &Mat3f, b: &Mat3f) -> Mat3f {
        let mut d = [[0.0f32; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let t = fmaf(a[i][2], b[2][j], fmaf(a[i][0], b[0][j], a[i][1] * b[1][j]));
                d[i][j] = (t as f64 * 1.0 + 0.0) as f32;
            }
        }
        d
    }

    /// `Matx33d` operator* (matx.inl.hpp): `s += a(i,k)*b(k,j)` — a serial
    /// FMA chain in k order (this differs from the gemm small path!). Used
    /// by Rodrigues' `R = U*Vt`.
    fn matx_mul3x3(a: &Mat3, b: &Mat3) -> Mat3 {
        let mut d = [[0.0f64; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let mut s = 0.0;
                for k in 0..3 {
                    s = fma(a[i][k], b[k][j], s);
                }
                d[i][j] = s;
            }
        }
        d
    }

    /// `det3` macro (lapack.cpp:711) on CV_64F with clang contraction.
    fn det3_f64(m: &Mat3) -> f64 {
        let d0 = fma(m[1][1], m[2][2], -(m[1][2] * m[2][1]));
        let d1 = fma(m[1][0], m[2][2], -(m[1][2] * m[2][0]));
        let d2 = fma(m[1][0], m[2][1], -(m[1][1] * m[2][0]));
        fma(m[0][2], d2, fma(m[0][0], d0, -(m[0][1] * d1)))
    }

    /// `cv::determinant` on a 3x3 CV_32F matrix — `det3` with each product
    /// promoted to double.
    pub fn det3x3_f32(m: &Mat3f) -> f64 {
        let e = |r: usize, c: usize| m[r][c] as f64;
        let d0 = fma(e(1, 1), e(2, 2), -(e(1, 2) * e(2, 1)));
        let d1 = fma(e(1, 0), e(2, 2), -(e(1, 2) * e(2, 0)));
        let d2 = fma(e(1, 0), e(2, 1), -(e(1, 1) * e(2, 0)));
        fma(e(0, 2), d2, fma(e(0, 0), d0, -(e(0, 1) * d1)))
    }

    /// `cv::invert(_, DECOMP_LU)` 3x3 CV_64F special case (lapack.cpp:944):
    /// adjugate over the reciprocal determinant. Returns zeros when singular
    /// (matching `dst = Scalar(0)`).
    pub fn invert3x3_lu_f64(m: &Mat3) -> Mat3 {
        let det = det3_f64(m);
        if det == 0.0 {
            return [[0.0; 3]; 3];
        }
        let d = 1.0 / det;
        let t = |a: f64, b: f64, c: f64, e: f64| fma(a, b, -(c * e)) * d;
        [
            [
                t(m[1][1], m[2][2], m[1][2], m[2][1]),
                t(m[0][2], m[2][1], m[0][1], m[2][2]),
                t(m[0][1], m[1][2], m[0][2], m[1][1]),
            ],
            [
                t(m[1][2], m[2][0], m[1][0], m[2][2]),
                t(m[0][0], m[2][2], m[0][2], m[2][0]),
                t(m[0][2], m[1][0], m[0][0], m[1][2]),
            ],
            [
                t(m[1][0], m[2][1], m[1][1], m[2][0]),
                t(m[0][1], m[2][0], m[0][0], m[2][1]),
                t(m[0][0], m[1][1], m[0][1], m[1][0]),
            ],
        ]
    }

    /// 3x3 CV_32F `invert` (lapack.cpp:917): double intermediates
    /// (`(double)Sf(i,j)*Sf(k,l)` promotions), float stores.
    pub fn invert3x3_lu_f32(m: &Mat3f) -> Mat3f {
        let det = det3x3_f32(m);
        if det == 0.0 {
            return [[0.0; 3]; 3];
        }
        let d = 1.0 / det;
        let e = |r: usize, c: usize| m[r][c] as f64;
        let t = |a: f64, b: f64, c: f64, f: f64| (fma(a, b, -(c * f)) * d) as f32;
        [
            [
                t(e(1, 1), e(2, 2), e(1, 2), e(2, 1)),
                t(e(0, 2), e(2, 1), e(0, 1), e(2, 2)),
                t(e(0, 1), e(1, 2), e(0, 2), e(1, 1)),
            ],
            [
                t(e(1, 2), e(2, 0), e(1, 0), e(2, 2)),
                t(e(0, 0), e(2, 2), e(0, 2), e(2, 0)),
                t(e(0, 2), e(1, 0), e(0, 0), e(1, 2)),
            ],
            [
                t(e(1, 0), e(2, 1), e(1, 1), e(2, 0)),
                t(e(0, 1), e(2, 0), e(0, 0), e(2, 1)),
                t(e(0, 0), e(1, 1), e(0, 1), e(1, 0)),
            ],
        ]
    }

    // -----------------------------------------------------------------
    // JacobiSVD (lapack.cpp:363-538) + SVBkSb + solve(DECOMP_SVD)
    // -----------------------------------------------------------------

    /// lapack.cpp's private `hypot` template (NOT std::hypot).
    fn hypot_cv(a: f64, b: f64) -> f64 {
        let a = a.abs();
        let b = b.abs();
        if a > b {
            let b = b / a;
            a * fma(b, b, 1.0).sqrt()
        } else if b > 0.0 {
            let a = a / b;
            b * fma(a, a, 1.0).sqrt()
        } else {
            0.0
        }
    }

    /// `cv::RNG` (LCG) used by JacobiSVD's degenerate-singular-vector
    /// regeneration (essentially never taken on real BA systems).
    struct CvRng(u64);
    impl CvRng {
        fn next(&mut self) -> u32 {
            self.0 = (self.0 & 0xffff_ffff)
                .wrapping_mul(4_164_903_690)
                .wrapping_add(self.0 >> 32);
            self.0 as u32
        }
    }

    /// `JacobiSVDImpl_<double>` (eps = DBL_EPSILON*10, minval = DBL_MIN).
    /// `at` is n rows of length m (the transposed input, row-major); on
    /// return its first n1 rows are the left singular vectors. `vt` (n x n)
    /// receives the right singular vectors as rows. `w` gets the singular
    /// values (descending).
    fn jacobi_svd_f64(
        at: &mut [f64],
        m: usize,
        n: usize,
        w_out: &mut [f64],
        mut vt: Option<&mut [f64]>,
        n1: usize,
    ) {
        let eps = f64::EPSILON * 10.0;
        let minval = f64::MIN_POSITIVE;
        let max_iter = m.max(30);
        let mut w = vec![0.0f64; n];

        for i in 0..n {
            let mut sd = 0.0f64;
            for k in 0..m {
                let t = at[i * m + k];
                sd = fma(t, t, sd);
            }
            w[i] = sd;
            if let Some(v) = vt.as_deref_mut() {
                for k in 0..n {
                    v[i * n + k] = 0.0;
                }
                v[i * n + i] = 1.0;
            }
        }

        for _iter in 0..max_iter {
            let mut changed = false;
            for i in 0..n.saturating_sub(1) {
                for j in i + 1..n {
                    let mut a = w[i];
                    let mut b = w[j];
                    let mut p = 0.0f64;
                    for k in 0..m {
                        p = fma(at[i * m + k], at[j * m + k], p);
                    }
                    if p.abs() <= eps * (a * b).sqrt() {
                        continue;
                    }
                    p *= 2.0;
                    let beta = a - b;
                    let gamma = hypot_cv(p, beta);
                    let (c, s);
                    if beta < 0.0 {
                        let delta = (gamma - beta) * 0.5;
                        s = (delta / gamma).sqrt();
                        c = p / (gamma * s * 2.0);
                    } else {
                        c = ((gamma + beta) / (gamma * 2.0)).sqrt();
                        s = p / (gamma * c * 2.0);
                    }
                    a = 0.0;
                    b = 0.0;
                    // The rotation loop as compiled: clang auto-vectorizes
                    // it for m >= 8 (8 elements per block), keeping the a/b
                    // reductions serial in element order but with the
                    // squares as SEPARATE multiplies (t*t rounded, then
                    // added) — only the scalar remainder contracts
                    // `a += t0*t0` to an FMA. Decoded from the wheel's
                    // JacobiSVDImpl_<double> disassembly.
                    let vec_m = if m >= 8 { m & !7 } else { 0 };
                    for k in 0..m {
                        let a0 = at[i * m + k];
                        let b0 = at[j * m + k];
                        let t0 = fma(c, a0, s * b0);
                        let t1 = fma(-s, a0, c * b0);
                        at[i * m + k] = t0;
                        at[j * m + k] = t1;
                        if k < vec_m {
                            a += t0 * t0;
                            b += t1 * t1;
                        } else {
                            a = fma(t0, t0, a);
                            b = fma(t1, t1, b);
                        }
                    }
                    w[i] = a;
                    w[j] = b;
                    changed = true;
                    if let Some(v) = vt.as_deref_mut() {
                        // VBLAS<double>::givens (SIMD) + scalar tail — both
                        // reduce to fma(c, x, s*y) per element.
                        for k in 0..n {
                            let v0 = v[i * n + k];
                            let v1 = v[j * n + k];
                            v[i * n + k] = fma(c, v0, s * v1);
                            v[j * n + k] = fma(-s, v0, c * v1);
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }

        for i in 0..n {
            let mut sd = 0.0f64;
            for k in 0..m {
                let t = at[i * m + k];
                sd = fma(t, t, sd);
            }
            w[i] = sd.sqrt();
        }

        for i in 0..n.saturating_sub(1) {
            let mut j = i;
            for k in i + 1..n {
                if w[j] < w[k] {
                    j = k;
                }
            }
            if i != j {
                w.swap(i, j);
                if let Some(v) = vt.as_deref_mut() {
                    for k in 0..m {
                        at.swap(i * m + k, j * m + k);
                    }
                    for k in 0..n {
                        v.swap(i * n + k, j * n + k);
                    }
                }
            }
        }

        w_out[..n].copy_from_slice(&w[..n]);
        if vt.is_none() {
            return;
        }

        let mut rng = CvRng(0x12345678);
        for i in 0..n1 {
            let mut sd = if i < n { w[i] } else { 0.0 };
            let mut ii = 0;
            while ii < 100 && sd <= minval {
                // Degenerate singular value: random unit vector orthogonal
                // to the previous left singular vectors.
                let val0 = 1.0 / m as f64;
                for k in 0..m {
                    let val = if (rng.next() & 256) != 0 { val0 } else { -val0 };
                    at[i * m + k] = val;
                }
                for _ in 0..2 {
                    for j in 0..i {
                        sd = 0.0;
                        for k in 0..m {
                            sd = fma(at[i * m + k], at[j * m + k], sd);
                        }
                        let mut asum = 0.0f64;
                        for k in 0..m {
                            let t = fma(-sd, at[j * m + k], at[i * m + k]);
                            at[i * m + k] = t;
                            asum += t.abs();
                        }
                        let asum = if asum > eps * 100.0 { 1.0 / asum } else { 0.0 };
                        for k in 0..m {
                            at[i * m + k] *= asum;
                        }
                    }
                }
                sd = 0.0;
                for k in 0..m {
                    let t = at[i * m + k];
                    sd = fma(t, t, sd);
                }
                sd = sd.sqrt();
                ii += 1;
            }
            let s = if sd > minval { 1.0 / sd } else { 0.0 };
            for k in 0..m {
                at[i * m + k] *= s;
            }
        }
    }

    /// `JacobiSVDImpl_<float>` (eps = FLT_EPSILON*2, minval = FLT_MIN):
    /// rotations in f32, dot products / norms accumulated in f64 — exactly
    /// the template's mixed precision. Only exercised on 3x3 inputs here.
    fn jacobi_svd_f32(
        at: &mut [f32],
        m: usize,
        n: usize,
        w_out: &mut [f32],
        mut vt: Option<&mut [f32]>,
        n1: usize,
    ) {
        let eps = (f32::EPSILON * 2.0) as f64;
        let minval = f32::MIN_POSITIVE as f64;
        let max_iter = m.max(30);
        let mut w = vec![0.0f64; n];

        for i in 0..n {
            let mut sd = 0.0f64;
            for k in 0..m {
                let t = at[i * m + k] as f64;
                sd = fma(t, t, sd);
            }
            w[i] = sd;
            if let Some(v) = vt.as_deref_mut() {
                for k in 0..n {
                    v[i * n + k] = 0.0;
                }
                v[i * n + i] = 1.0;
            }
        }

        for _iter in 0..max_iter {
            let mut changed = false;
            for i in 0..n.saturating_sub(1) {
                for j in i + 1..n {
                    let mut a = w[i];
                    let mut b = w[j];
                    let mut p = 0.0f64;
                    for k in 0..m {
                        p = fma(at[i * m + k] as f64, at[j * m + k] as f64, p);
                    }
                    if p.abs() <= eps * (a * b).sqrt() {
                        continue;
                    }
                    p *= 2.0;
                    let beta = a - b;
                    let gamma = hypot_cv(p, beta);
                    let (c, s): (f32, f32);
                    if beta < 0.0 {
                        let delta = (gamma - beta) * 0.5;
                        s = (delta / gamma).sqrt() as f32;
                        c = (p / (gamma * s as f64 * 2.0)) as f32;
                    } else {
                        c = ((gamma + beta) / (gamma * 2.0)).sqrt() as f32;
                        s = (p / (gamma * c as f64 * 2.0)) as f32;
                    }
                    a = 0.0;
                    b = 0.0;
                    for k in 0..m {
                        let a0 = at[i * m + k];
                        let b0 = at[j * m + k];
                        let t0 = fmaf(c, a0, s * b0);
                        let t1 = fmaf(-s, a0, c * b0);
                        at[i * m + k] = t0;
                        at[j * m + k] = t1;
                        a = fma(t0 as f64, t0 as f64, a);
                        b = fma(t1 as f64, t1 as f64, b);
                    }
                    w[i] = a;
                    w[j] = b;
                    changed = true;
                    if let Some(v) = vt.as_deref_mut() {
                        // VBLAS<float>::givens bails out for n < 4 lanes, so
                        // 3x3 uses the scalar (contracted) rotation.
                        for k in 0..n {
                            let v0 = v[i * n + k];
                            let v1 = v[j * n + k];
                            v[i * n + k] = fmaf(c, v0, s * v1);
                            v[j * n + k] = fmaf(-s, v0, c * v1);
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }

        for i in 0..n {
            let mut sd = 0.0f64;
            for k in 0..m {
                let t = at[i * m + k] as f64;
                sd = fma(t, t, sd);
            }
            w[i] = sd.sqrt();
        }

        for i in 0..n.saturating_sub(1) {
            let mut j = i;
            for k in i + 1..n {
                if w[j] < w[k] {
                    j = k;
                }
            }
            if i != j {
                w.swap(i, j);
                if let Some(v) = vt.as_deref_mut() {
                    for k in 0..m {
                        at.swap(i * m + k, j * m + k);
                    }
                    for k in 0..n {
                        v.swap(i * n + k, j * n + k);
                    }
                }
            }
        }

        for i in 0..n {
            w_out[i] = w[i] as f32;
        }
        if vt.is_none() {
            return;
        }

        let mut rng = CvRng(0x12345678);
        for i in 0..n1 {
            let mut sd = if i < n { w[i] } else { 0.0 };
            let mut ii = 0;
            while ii < 100 && sd <= minval {
                let val0 = (1.0 / m as f64) as f32;
                for k in 0..m {
                    let val = if (rng.next() & 256) != 0 { val0 } else { -val0 };
                    at[i * m + k] = val;
                }
                for _ in 0..2 {
                    for j in 0..i {
                        sd = 0.0;
                        for k in 0..m {
                            sd = fma(at[i * m + k] as f64, at[j * m + k] as f64, sd);
                        }
                        let mut asum = 0.0f32;
                        for k in 0..m {
                            let t = fma(-sd, at[j * m + k] as f64, at[i * m + k] as f64) as f32;
                            at[i * m + k] = t;
                            asum += t.abs();
                        }
                        let asum = if asum as f64 > eps * 100.0 {
                            1.0 / asum
                        } else {
                            0.0
                        };
                        for k in 0..m {
                            at[i * m + k] *= asum;
                        }
                    }
                }
                sd = 0.0;
                for k in 0..m {
                    let t = at[i * m + k] as f64;
                    sd = fma(t, t, sd);
                }
                sd = sd.sqrt();
                ii += 1;
            }
            let s = if sd > minval { (1.0 / sd) as f32 } else { 0.0 };
            for k in 0..m {
                at[i * m + k] *= s;
            }
        }
    }

    /// `SVD::compute(R32, w, u, vt, SVD::FULL_UV)` on a 3x3 CV_32F matrix
    /// (`_SVDcompute`, lapack.cpp:1405): At = Rᵀ, JacobiSVD, U = Atᵀ.
    pub fn svd3x3_f32_full(r: &Mat3f) -> ([f32; 3], Mat3f, Mat3f) {
        let mut at = [0.0f32; 9];
        for i in 0..3 {
            for k in 0..3 {
                at[i * 3 + k] = r[k][i];
            }
        }
        let mut w = [0.0f32; 3];
        let mut vt = [0.0f32; 9];
        jacobi_svd_f32(&mut at, 3, 3, &mut w, Some(&mut vt), 3);
        let mut u = [[0.0f32; 3]; 3];
        let mut vtm = [[0.0f32; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                u[i][j] = at[j * 3 + i];
                vtm[i][j] = vt[i * 3 + j];
            }
        }
        (w, u, vtm)
    }

    /// 3x3 CV_64F `SVD::compute` (flags 0; square, so short == full).
    fn svd3x3_f64(r: &Mat3) -> (Mat3, Mat3) {
        let mut at = [0.0f64; 9];
        for i in 0..3 {
            for k in 0..3 {
                at[i * 3 + k] = r[k][i];
            }
        }
        let mut w = [0.0f64; 3];
        let mut vt = [0.0f64; 9];
        jacobi_svd_f64(&mut at, 3, 3, &mut w, Some(&mut vt), 3);
        let mut u = [[0.0f64; 3]; 3];
        let mut vtm = [[0.0f64; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                u[i][j] = at[j * 3 + i];
                vtm[i][j] = vt[i * 3 + j];
            }
        }
        (u, vtm)
    }

    /// `SVBkSbImpl_<double>` with nb == 1 (lapack.cpp:643): the DECOMP_SVD
    /// back-substitution `x = V·diag(1/wᵢ)·Uᵀ·b` with the summed-singular-
    /// value truncation threshold `Σw · DBL_EPSILON·2`.
    fn svbksb(
        m: usize,
        n: usize,
        w: &[f64],
        u_rows: &[f64],
        v_rows: &[f64],
        b: &[f64],
        x: &mut [f64],
    ) {
        let nm = m.min(n);
        let mut threshold = 0.0f64;
        for &wi in w.iter().take(nm) {
            threshold += wi;
        }
        threshold *= f64::EPSILON * 2.0;

        for xi in x.iter_mut().take(n) {
            *xi = 0.0;
        }
        for i in 0..nm {
            let wi = w[i];
            if wi.abs() <= threshold {
                continue;
            }
            let wi = 1.0 / wi;
            let mut s = 0.0f64;
            for jm in 0..m {
                s = fma(u_rows[i * m + jm], b[jm], s);
            }
            s *= wi;
            for jn in 0..n {
                x[jn] = fma(s, v_rows[i * n + jn], x[jn]);
            }
        }
    }

    /// `cv::solve(a, b, x, DECOMP_SVD)` for a square CV_64F system
    /// (lapack.cpp:1284): a is transposed into working storage, JacobiSVD
    /// runs in place (rows become left singular vectors), then SVBkSb.
    ///
    /// NOTE: the oracle wheel delegates the SVD to Accelerate `dgesdd` for
    /// n >= 25 (hal_internal.cpp); this is the portable OpenCV kernel.
    pub fn solve_svd(a: &[f64], b: &[f64], x: &mut [f64], n: usize) {
        debug_assert_eq!(a.len(), n * n);
        let mut at = vec![0.0f64; n * n];
        for i in 0..n {
            for k in 0..n {
                at[i * n + k] = a[k * n + i];
            }
        }
        let mut w = vec![0.0f64; n];
        let mut vt = vec![0.0f64; n * n];
        jacobi_svd_f64(&mut at, n, n, &mut w, Some(&mut vt), n);
        svbksb(n, n, &w, &at, &vt, b, x);
    }

    /// Solve the symmetric system `a x = b` by LDL^T — Cholesky without
    /// square roots — as the large-system alternative to [`solve_svd`].
    ///
    /// This has no OpenCV counterpart: `DECOMP_SVD` above is a one-sided
    /// Jacobi SVD costing ~n^3 per sweep with the sweep cap itself growing
    /// as n, paid on every LM step. LDL^T is one O(n^3/3) factorisation.
    ///
    /// Returns false — leaving `x` untouched — when the matrix is not
    /// numerically definite, so the caller can fall back to the SVD
    /// pseudo-inverse.
    pub fn solve_ldlt(a: &[f64], b: &[f64], x: &mut [f64], n: usize) -> bool {
        debug_assert_eq!(a.len(), n * n);
        debug_assert_eq!(b.len(), n);
        debug_assert_eq!(x.len(), n);

        let mut max_diag = 0.0f64;
        for i in 0..n {
            max_diag = max_diag.max(a[i * n + i].abs());
        }
        if !max_diag.is_finite() || max_diag <= 0.0 {
            return false;
        }
        let tol = max_diag * f64::EPSILON * n as f64;

        // Unit lower-triangular L (strictly below the diagonal) and D.
        let mut l = vec![0.0f64; n * n];
        let mut d = vec![0.0f64; n];
        let mut ld = vec![0.0f64; n];

        for j in 0..n {
            let mut dj = a[j * n + j];
            for k in 0..j {
                let ljk = l[j * n + k];
                ld[k] = ljk * d[k];
                dj -= ljk * ld[k];
            }
            // NaN pivots (a degenerate JtJ) must fail into the SVD path too.
            if dj.is_nan() || dj <= tol {
                return false;
            }
            d[j] = dj;
            let inv = 1.0 / dj;
            for i in (j + 1)..n {
                let row = &mut l[i * n..i * n + j + 1];
                let mut acc = a[i * n + j];
                for (lik, ldk) in row[..j].iter().zip(&ld[..j]) {
                    acc -= lik * ldk;
                }
                row[j] = acc * inv;
            }
        }

        // L y = b, then D z = y (in place), then L^T x = z.
        let mut y = vec![0.0f64; n];
        for i in 0..n {
            let mut acc = b[i];
            for (k, lik) in l[i * n..i * n + i].iter().enumerate() {
                acc -= lik * y[k];
            }
            y[i] = acc;
        }
        for i in 0..n {
            y[i] /= d[i];
        }
        for i in (0..n).rev() {
            let mut acc = y[i];
            for k in (i + 1)..n {
                acc -= l[k * n + i] * x[k];
            }
            x[i] = acc;
        }
        true
    }

    // -----------------------------------------------------------------
    // Rodrigues (calibration_base.cpp:121-368)
    // -----------------------------------------------------------------

    /// `norm(Point3d)` — `sqrt(x*x + y*y + z*z)` with clang contraction.
    #[inline]
    fn norm_point3(x: f64, y: f64, z: f64) -> f64 {
        fma(z, z, fma(x, x, y * y)).sqrt()
    }

    /// `cv::Rodrigues` vector→matrix on CV_64F.
    pub fn rodrigues_v2m(rvec: &[f64; 3]) -> Mat3 {
        let theta = norm_point3(rvec[0], rvec[1], rvec[2]);
        if theta < f64::EPSILON {
            return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        }
        let c = theta.cos();
        let s = theta.sin();
        let c1 = 1.0 - c;
        let itheta = if theta != 0.0 { 1.0 / theta } else { 0.0 };
        let rx = rvec[0] * itheta;
        let ry = rvec[1] * itheta;
        let rz = rvec[2] * itheta;
        let rrt = [
            [rx * rx, rx * ry, rx * rz],
            [rx * ry, ry * ry, ry * rz],
            [rx * rz, ry * rz, rz * rz],
        ];
        let r_x = [[0.0, -rz, ry], [rz, 0.0, -rx], [-ry, rx, 0.0]];
        let eye = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        // R = c*I + c1*rrt + s*r_x — Matx elementwise ops are separate
        // statements, so no contraction here.
        let mut r = [[0.0f64; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                r[i][j] = (eye[i][j] * c + rrt[i][j] * c1) + r_x[i][j] * s;
            }
        }
        r
    }

    /// `cv::Rodrigues` matrix→vector on a CV_32F matrix: all computation in
    /// double (convert, checkRange, double 3x3 SVD orthonormalization,
    /// Matx U*Vt), only the final store casts to f32.
    pub fn rodrigues_m2v_f32(r32: &Mat3f) -> [f32; 3] {
        let mut r = [[0.0f64; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                r[i][j] = r32[i][j] as f64;
            }
        }
        // checkRange(R, true, 0, -100, 100): quiet [-100, 100) check
        // (NaN fails the check, matching the C++ comparisons).
        for row in &r {
            for &v in row {
                if !(-100.0..100.0).contains(&v) {
                    return [0.0; 3];
                }
            }
        }
        let (u, vt) = svd3x3_f64(&r);
        let r = matx_mul3x3(&u, &vt);

        let mut rx = r[2][1] - r[1][2];
        let mut ry = r[0][2] - r[2][0];
        let mut rz = r[1][0] - r[0][1];

        let s = (fma(rz, rz, fma(rx, rx, ry * ry)) * 0.25).sqrt();
        let mut c = (((r[0][0] + r[1][1]) + r[2][2]) - 1.0) * 0.5;
        c = c.clamp(-1.0, 1.0);
        let mut theta = c.acos();

        if s < 1e-5 {
            if c > 0.0 {
                rx = 0.0;
                ry = 0.0;
                rz = 0.0;
            } else {
                let t = (r[0][0] + 1.0) * 0.5;
                rx = t.max(0.0).sqrt();
                let t = (r[1][1] + 1.0) * 0.5;
                ry = t.max(0.0).sqrt() * if r[0][1] < 0.0 { -1.0 } else { 1.0 };
                let t = (r[2][2] + 1.0) * 0.5;
                rz = t.max(0.0).sqrt() * if r[0][2] < 0.0 { -1.0 } else { 1.0 };
                if rx.abs() < ry.abs()
                    && rx.abs() < rz.abs()
                    && ((r[1][2] > 0.0) != (ry * rz > 0.0))
                {
                    rz = -rz;
                }
                theta /= norm_point3(rx, ry, rz);
                rx *= theta;
                ry *= theta;
                rz *= theta;
            }
        } else {
            let mut vth = 1.0 / (2.0 * s);
            vth *= theta;
            rx *= vth;
            ry *= vth;
            rz *= vth;
        }
        [rx as f32, ry as f32, rz as f32]
    }

    /// The per-camera transform of `BundleAdjusterRay::setUpInitialCameraParams`
    /// (motion_estimators.cpp:507): float SVD orthonormalization of R,
    /// determinant sign fix, then the CV_32F Rodrigues.
    pub fn setup_rvec_f32(r: &Mat3f) -> [f32; 3] {
        let (_w, u, vt) = svd3x3_f32_full(r);
        let mut ortho = gemm3x3_f32(&u, &vt);
        if det3x3_f32(&ortho) < 0.0 {
            for row in ortho.iter_mut() {
                for v in row.iter_mut() {
                    *v *= -1.0;
                }
            }
        }
        rodrigues_m2v_f32(&ortho)
    }
}

// ---------------------------------------------------------------------
// LevMarq (calibration.cpp:570-780) — `update()` state machine
// ---------------------------------------------------------------------

#[derive(PartialEq)]
enum LmState {
    Started,
    CalcJ,
    CheckErr,
    Done,
}

struct LevMarq {
    nparams: usize,
    nerrs: usize,
    prev_param: Vec<f64>,
    param: Vec<f64>,
    j: Vec<f64>,   // nerrs x nparams, row-major
    err: Vec<f64>, // nerrs
    jtj: Vec<f64>,
    jterr: Vec<f64>,
    jtjn: Vec<f64>,
    jtjv: Vec<f64>,
    jtjw: Vec<f64>,
    prev_err_norm: f64,
    err_norm: f64,
    lambda_lg10: i32,
    max_count: usize,
    epsilon: f64,
    /// Parameters pinned at their initial value — used to fix the gauge.
    fixed: Vec<bool>,
    state: LmState,
    iters: usize,
}

/// What the caller must recompute after an `update()` call, mirroring which
/// of the C++ output Mats were assigned.
struct LmRequest {
    proceed: bool,
    want_jac: bool,
    want_err: bool,
}

impl LevMarq {
    /// `LevMarq::init` with the BundleAdjusterBase criteria
    /// `TermCriteria(COUNT + EPS, 1000, DBL_EPSILON)` (motion_estimators.hpp:163).
    fn new(nparams: usize, nerrs: usize) -> Self {
        Self {
            nparams,
            nerrs,
            prev_param: vec![0.0; nparams],
            param: vec![0.0; nparams],
            j: vec![0.0; nerrs * nparams],
            err: vec![0.0; nerrs],
            jtj: vec![0.0; nparams * nparams],
            jterr: vec![0.0; nparams],
            jtjn: vec![0.0; nparams * nparams],
            jtjv: vec![0.0; nparams],
            jtjw: vec![0.0; nparams],
            prev_err_norm: f64::MAX,
            err_norm: f64::MAX,
            lambda_lg10: -3,
            fixed: vec![false; nparams],
            max_count: 1000, // MIN(MAX(1000,1),1000)
            epsilon: if nparams > LDLT_MIN_PARAMS {
                PRACTICAL_PARAM_EPS
            } else {
                f64::EPSILON
            },
            state: LmState::Started,
            iters: 0,
        }
    }

    fn update(&mut self) -> LmRequest {
        match self.state {
            LmState::Done => LmRequest {
                proceed: false,
                want_jac: false,
                want_err: false,
            },
            LmState::Started => {
                self.j.fill(0.0);
                self.err.fill(0.0);
                self.state = LmState::CalcJ;
                LmRequest {
                    proceed: true,
                    want_jac: true,
                    want_err: true,
                }
            }
            LmState::CalcJ => {
                // Mat(J.t()*J).copyTo(JtJ); JtErr = J.t()*err — both gemm.
                cvnum::gemm_jtj(&self.j, self.nerrs, self.nparams, &mut self.jtj);
                cvnum::gemm_jterr(
                    &self.j,
                    self.nerrs,
                    self.nparams,
                    &self.err,
                    &mut self.jterr,
                );
                self.prev_param.copy_from_slice(&self.param);
                self.step();
                if self.iters == 0 {
                    self.prev_err_norm = cvnum::norm_l2(&self.err);
                }
                self.err.fill(0.0);
                self.state = LmState::CheckErr;
                LmRequest {
                    proceed: true,
                    want_jac: false,
                    want_err: true,
                }
            }
            LmState::CheckErr => {
                self.err_norm = cvnum::norm_l2(&self.err);
                if self.err_norm > self.prev_err_norm {
                    self.lambda_lg10 += 1;
                    if self.lambda_lg10 <= 16 {
                        self.step();
                        self.err.fill(0.0);
                        return LmRequest {
                            proceed: true,
                            want_jac: false,
                            want_err: true,
                        };
                    }
                }
                self.lambda_lg10 = (self.lambda_lg10 - 1).max(-16);
                self.iters += 1;
                #[cfg(not(target_arch = "wasm32"))]
                if std::env::var_os("PANOLOOM_LMTRACE").is_some() && self.iters.is_multiple_of(25) {
                    eprintln!(
                        "[lm] iter={} lambda=1e{} rel_change={:.3e} (needs < {:.3e}) err={:.6e}",
                        self.iters,
                        self.lambda_lg10,
                        cvnum::norm_rel_l2(&self.param, &self.prev_param),
                        self.epsilon,
                        self.err_norm
                    );
                }
                if self.iters >= self.max_count
                    || cvnum::norm_rel_l2(&self.param, &self.prev_param) < self.epsilon
                {
                    // C++ returns true here with the output Mats left empty,
                    // so the driver copies the params and breaks.
                    self.state = LmState::Done;
                    return LmRequest {
                        proceed: true,
                        want_jac: false,
                        want_err: false,
                    };
                }
                self.prev_err_norm = self.err_norm;
                self.j.fill(0.0);
                self.state = LmState::CalcJ;
                LmRequest {
                    proceed: true,
                    want_jac: true,
                    want_err: true,
                }
            }
        }
    }

    /// `LevMarq::step`: damp the normal equations diagonal by `1 + λ`
    /// (λ = 10^lambdaLg10) and solve. The mask is all-ones in the stitching
    /// pipeline, so `subMatrixWithIndices` is a plain copy and
    /// `completeSymm` is skipped (err is non-empty).
    ///
    /// OpenCV always solves with `DECOMP_SVD`, and below [`LDLT_MIN_PARAMS`]
    /// so do we, which keeps every oracle-parity dataset on the reference
    /// path bit-for-bit. Above it that solve IS the cost of alignment — on a
    /// 137-image set (548 params) it ran >20 min with ~100% of profile
    /// samples inside `jacobi_svd_f64` — so we take the LDL^T fast path.
    fn step(&mut self) {
        let lambda = (self.lambda_lg10 as f64 * std::f64::consts::LN_10).exp();
        self.jtjn.copy_from_slice(&self.jtj);
        self.jtjv.copy_from_slice(&self.jterr);
        for i in 0..self.nparams {
            self.jtjn[i * self.nparams + i] *= 1.0 + lambda;
        }
        // Gauge fixing: zero a pinned parameter's row, column and gradient,
        // leaving a unit diagonal. The system then decouples — the pinned
        // parameter takes a zero step and every other equation is exactly
        // the original one with that unknown removed. Cheaper than
        // extracting a submatrix and it works for either solver.
        if self.fixed.iter().any(|&f| f) {
            let mut scale = 0.0f64;
            for i in 0..self.nparams {
                scale = scale.max(self.jtjn[i * self.nparams + i].abs());
            }
            if scale <= 0.0 {
                scale = 1.0;
            }
            for i in 0..self.nparams {
                if !self.fixed[i] {
                    continue;
                }
                for k in 0..self.nparams {
                    self.jtjn[i * self.nparams + k] = 0.0;
                    self.jtjn[k * self.nparams + i] = 0.0;
                }
                self.jtjn[i * self.nparams + i] = scale;
                self.jtjv[i] = 0.0;
            }
        }
        let solved = self.nparams > LDLT_MIN_PARAMS && {
            // The ray cost is invariant to a global rotation, so JtJ is
            // rank-deficient by 3. DECOMP_SVD absorbs that in a
            // pseudo-inverse; LDL^T needs a definite system, so lift the
            // gauge directions clear of rounding noise with a relative
            // ridge. It stays far below LM's own damping until lambda
            // bottoms out — `1.0 + 1e-16` rounds to `1.0` in f64 — which is
            // precisely when the deficiency would otherwise surface.
            let mut max_diag = 0.0f64;
            for i in 0..self.nparams {
                max_diag = max_diag.max(self.jtjn[i * self.nparams + i].abs());
            }
            let ridge = max_diag * GAUGE_RIDGE_REL;
            for i in 0..self.nparams {
                self.jtjn[i * self.nparams + i] += ridge;
            }
            cvnum::solve_ldlt(&self.jtjn, &self.jtjv, &mut self.jtjw, self.nparams)
        };
        if !solved {
            cvnum::solve_svd(&self.jtjn, &self.jtjv, &mut self.jtjw, self.nparams);
        }
        for i in 0..self.nparams {
            self.param[i] = self.prev_param[i] - self.jtjw[i];
        }
    }
}

// ---------------------------------------------------------------------
// BundleAdjusterRay cost function (motion_estimators.cpp:549-643)
// ---------------------------------------------------------------------

/// Pre-extracted per-edge data: OpenCV re-reads `matches`/`inliers_mask`
/// every `calcError`; the filtered keypoint pairs are identical each time,
/// so hoisting them is pure data movement.
struct EdgeData {
    i: usize,
    j: usize,
    /// `img_size` of the two feature images (width, height).
    size1: (f64, f64),
    size2: (f64, f64),
    /// (p1.x, p1.y, p2.x, p2.y) for every inlier match, in match order.
    pairs: Vec<[f32; 4]>,
}

fn calc_error(edges: &[EdgeData], cam_params: &[f64], err: &mut [f64]) {
    let mut match_idx = 0usize;
    for e in edges {
        let f1 = cam_params[e.i * NUM_PARAMS_PER_CAM];
        let f2 = cam_params[e.j * NUM_PARAMS_PER_CAM];
        let r1 = cvnum::rodrigues_v2m(&[
            cam_params[e.i * NUM_PARAMS_PER_CAM + 1],
            cam_params[e.i * NUM_PARAMS_PER_CAM + 2],
            cam_params[e.i * NUM_PARAMS_PER_CAM + 3],
        ]);
        let r2 = cvnum::rodrigues_v2m(&[
            cam_params[e.j * NUM_PARAMS_PER_CAM + 1],
            cam_params[e.j * NUM_PARAMS_PER_CAM + 2],
            cam_params[e.j * NUM_PARAMS_PER_CAM + 3],
        ]);
        let k1 = [
            [f1, 0.0, e.size1.0 * 0.5],
            [0.0, f1, e.size1.1 * 0.5],
            [0.0, 0.0, 1.0],
        ];
        let k2 = [
            [f2, 0.0, e.size2.0 * 0.5],
            [0.0, f2, e.size2.1 * 0.5],
            [0.0, 0.0, 1.0],
        ];
        let h1 = cvnum::gemm3x3_f64(&r1, &cvnum::invert3x3_lu_f64(&k1));
        let h2 = cvnum::gemm3x3_f64(&r2, &cvnum::invert3x3_lu_f64(&k2));

        for p in &e.pairs {
            let (p1x, p1y, p2x, p2y) = (p[0] as f64, p[1] as f64, p[2] as f64, p[3] as f64);
            // x = H(0,0)*p.x + H(0,1)*p.y + H(0,2) — the inner two products
            // contract (LHS first), the trailing add stays plain.
            let mut x1 = h1[0][0].mul_add(p1x, h1[0][1] * p1y) + h1[0][2];
            let mut y1 = h1[1][0].mul_add(p1x, h1[1][1] * p1y) + h1[1][2];
            let mut z1 = h1[2][0].mul_add(p1x, h1[2][1] * p1y) + h1[2][2];
            let len = z1.mul_add(z1, x1.mul_add(x1, y1 * y1)).sqrt();
            x1 /= len;
            y1 /= len;
            z1 /= len;

            let mut x2 = h2[0][0].mul_add(p2x, h2[0][1] * p2y) + h2[0][2];
            let mut y2 = h2[1][0].mul_add(p2x, h2[1][1] * p2y) + h2[1][2];
            let mut z2 = h2[2][0].mul_add(p2x, h2[2][1] * p2y) + h2[2][2];
            let len = z2.mul_add(z2, x2.mul_add(x2, y2 * y2)).sqrt();
            x2 /= len;
            y2 /= len;
            z2 /= len;

            let mult = (f1 * f2).sqrt();
            err[3 * match_idx] = mult * (x1 - x2);
            err[3 * match_idx + 1] = mult * (y1 - y2);
            err[3 * match_idx + 2] = mult * (z1 - z2);
            match_idx += 1;
        }
    }
}

/// `BundleAdjusterRay::calcJacobian`: numeric central differences with step
/// 1e-3, full error re-evaluation per perturbed parameter (calcDeriv).
fn calc_jacobian(
    edges: &[EdgeData],
    cam_params: &mut [f64],
    jac: &mut [f64],
    err1: &mut [f64],
    err2: &mut [f64],
) {
    const STEP: f64 = 1e-3;
    let nparams = cam_params.len();
    for idx in 0..nparams {
        let val = cam_params[idx];
        cam_params[idx] = val - STEP;
        calc_error(edges, cam_params, err1);
        cam_params[idx] = val + STEP;
        calc_error(edges, cam_params, err2);
        for (r, (e2, e1)) in err2.iter().zip(err1.iter()).enumerate() {
            jac[r * nparams + idx] = (e2 - e1) / (2.0 * STEP);
        }
        cam_params[idx] = val;
    }
}

// ---------------------------------------------------------------------
// BundleAdjusterBase::estimate driver (motion_estimators.cpp:222-321)
// ---------------------------------------------------------------------

/// Bundle-adjust the cameras in place with `BundleAdjusterRay` semantics
/// (conf_thresh = 1.0, TermCriteria(COUNT+EPS, 1000, DBL_EPSILON)).
///
/// Returns false when the refined parameters contain NaN (OpenCV's
/// `ERR_CAMERA_PARAMS_ADJUST_FAIL`) or — a guarded deviation — when no pair
/// passes the confidence threshold (OpenCV would abort on an internal
/// assertion in that case).
pub fn bundle_adjust_ray(
    features: &[FeatureSet],
    graph: &MatchGraph,
    cameras: &mut [CameraParams],
) -> bool {
    let num_images = features.len();
    assert_eq!(cameras.len(), num_images);
    assert_eq!(graph.n, num_images);

    // setUpInitialCameraParams: cam_params_ is CV_64F but the rotation goes
    // through a CV_32F SVD + Rodrigues, so rvecs enter f32-truncated.
    let nparams = num_images * NUM_PARAMS_PER_CAM;
    let mut cam_params = vec![0.0f64; nparams];
    for (i, cam) in cameras.iter().enumerate() {
        cam_params[i * NUM_PARAMS_PER_CAM] = cam.focal;
        let rvec = cvnum::setup_rvec_f32(&cam.r);
        for k in 0..3 {
            cam_params[i * NUM_PARAMS_PER_CAM + 1 + k] = rvec[k] as f64;
        }
    }

    // Leave only consistent image pairs (confidence strictly above 1.0).
    let mut edges: Vec<(usize, usize)> = Vec::new();
    for i in 0..num_images.saturating_sub(1) {
        for j in i + 1..num_images {
            if graph.at(i, j).confidence > CONF_THRESH {
                edges.push((i, j));
            }
        }
    }
    let total_num_matches: usize = edges.iter().map(|&(i, j)| graph.at(i, j).num_inliers).sum();
    if total_num_matches == 0 {
        return false;
    }
    let nerrs = total_num_matches * NUM_ERRS_PER_MEASUREMENT;

    let edge_data: Vec<EdgeData> = edges
        .iter()
        .map(|&(i, j)| {
            let pm = graph.at(i, j);
            let pairs = pm
                .matches
                .iter()
                .zip(&pm.inliers)
                .filter(|&(_, &inl)| inl)
                .map(|(m, _)| {
                    let p1 = features[i].keypoints[m.query];
                    let p2 = features[j].keypoints[m.train];
                    [p1[0], p1[1], p2[0], p2[1]]
                })
                .collect();
            EdgeData {
                i,
                j,
                size1: (features[i].width as f64, features[i].height as f64),
                size2: (features[j].width as f64, features[j].height as f64),
                pairs,
            }
        })
        .collect();

    let mut solver = LevMarq::new(nparams, nerrs);
    solver.param.copy_from_slice(&cam_params);

    // The driver keeps its own err/jac buffers and copies them into the
    // solver, exactly like the `Mat err, jac` locals in C++.
    let mut err_buf = vec![0.0f64; nerrs];
    let mut jac_buf = vec![0.0f64; nerrs * nparams];
    let mut err1 = vec![0.0f64; nerrs];
    let mut err2 = vec![0.0f64; nerrs];

    // LM runs to `max_count` on hard problems — a 137-shot set uses all
    // 1000 iterations — and each one is a Jacobian, a JtJ and a solve. With
    // nothing reported, that is minutes to hours of a frozen label, which
    // is indistinguishable from a hang and hides non-convergence entirely.
    let mut announced = usize::MAX;
    loop {
        if solver.iters != announced {
            announced = solver.iters;
            crate::progress::stage(&format!("bundle-adjust:{}/{}", announced, solver.max_count));
        }
        let req = solver.update();
        cam_params.copy_from_slice(&solver.param);
        if !req.proceed || !req.want_err {
            break;
        }
        if req.want_jac {
            calc_jacobian(
                &edge_data,
                &mut cam_params,
                &mut jac_buf,
                &mut err1,
                &mut err2,
            );
            solver.j.copy_from_slice(&jac_buf);
        }
        calc_error(&edge_data, &cam_params, &mut err_buf);
        solver.err.copy_from_slice(&err_buf);
    }

    // Check if all camera parameters are valid.
    if cam_params.iter().any(|v| v.is_nan()) {
        return false;
    }

    // obtainRefinedCameraParams: focal + Rodrigues(rvec) stored as CV_32F.
    for (i, cam) in cameras.iter_mut().enumerate() {
        cam.focal = cam_params[i * NUM_PARAMS_PER_CAM];
        let r = cvnum::rodrigues_v2m(&[
            cam_params[i * NUM_PARAMS_PER_CAM + 1],
            cam_params[i * NUM_PARAMS_PER_CAM + 2],
            cam_params[i * NUM_PARAMS_PER_CAM + 3],
        ]);
        for row in 0..3 {
            for col in 0..3 {
                cam.r[row][col] = r[row][col] as f32;
            }
        }
    }

    // Normalize motion to the spanning-tree center image:
    // R_i <- R_center⁻¹ · R_i (CV_32F throughout).
    let tree = find_max_spanning_tree(graph);
    let r_inv = cvnum::invert3x3_lu_f32(&cameras[tree.centers[0]].r);
    for cam in cameras.iter_mut() {
        cam.r = cvnum::gemm3x3_f32(&r_inv, &cam.r);
    }
    true
}
