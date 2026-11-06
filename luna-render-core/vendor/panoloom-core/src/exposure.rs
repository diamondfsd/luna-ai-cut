//! Exposure (gain) compensation ported from OpenCV
//! `modules/stitching/src/exposure_compensate.cpp` (v4.14.0).
//!
//! PANORAMA-mode `Stitcher` uses `BlocksGainCompensator()` with all defaults:
//! `bl_width = bl_height = 32`, `nr_feeds = 1`, `nr_gain_filtering_iterations
//! = 2`, `similarity_threshold = 1` (which disables the similarity mask —
//! `prepareSimilarityMask` early-outs) and `update_gain = true`. Those
//! defaults are hardcoded here; the `nr_feeds > 1`, similarity-mask,
//! 1-channel and `ChannelsCompensator` code paths are intentionally not
//! ported (see docs/pipeline.md §9).
//!
//! Numerics mirrored verbatim:
//! * pairwise overlap statistics (`GainCompensator::singleFeed`): per-pixel
//!   intensity is the **L2 norm of the u8 triple** (`cv::norm(Vec3b)` =
//!   `sqrt(c0² + c1² + c2²)` in f64) — channel-order invariant, so our RGB
//!   layout vs OpenCV's BGR does not matter; sums accumulate in f64 in
//!   row-major scan order; `N(i,j) = max(1, |intersection|)` as i32.
//! * the `alpha = 0.01`, `beta = 100` linear system, assembled in the exact
//!   OpenCV loop order over non-skipped images.
//! * the solve: the reference opencv-python 4.14.0 build has **no Eigen and
//!   no LAPACK**, so `cv::solve(A, b)` takes the default `DECOMP_LU` path =
//!   OpenCV's own `LUImpl` (partial pivoting on |column max|, pivot-magnitude
//!   threshold `DBL_EPSILON * 100`, f64). Ported below as [`lu_solve`].
//!   Deviation: `cv::solve`'s special-cased Cramer path for n ≤ 3 systems is
//!   not replicated (block systems are always much larger); on a singular
//!   system `cv::solve` zero-fills the solution — mirrored.
//! * per-image gain maps at block resolution (`ceil(w/32) × ceil(h/32)`,
//!   f32), smoothed by **two** passes of the separable `[0.25, 0.5, 0.25]`
//!   kernel (`sepFilter2D`, `BORDER_REFLECT_101`), computed in f32 as
//!   `center*0.5 + (left+right)*0.25` per pass direction — the exact
//!   `SymmRowSmallFilter`/`SymmColumnSmallFilter` formulation.
//! * `apply`: gain map resized to the image size with `INTER_LINEAR` (f32
//!   weights from `(d + 0.5)*scale - 0.5` source mapping, edge clamping as in
//!   `resize.cpp`), then `dst = saturate_cast<u8>(src * gain)` per channel
//!   (`cvRound` = ties-to-even). OpenCV's `apply(index, corner, image, mask)`
//!   ignores `corner` and `mask`, so they are dropped from the signature.

use crate::cvmath::cv_round_f32;
use crate::imgproc::GrayImage;

/// 3-channel u8 image, RGB interleaved, tightly packed.
///
/// OpenCV feeds BGR mats; every computation in this module is
/// channel-order invariant, so RGB data produces identical gains.
#[derive(Debug, Clone)]
pub struct RgbImage {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl RgbImage {
    pub fn new(width: usize, height: usize, data: Vec<u8>) -> Self {
        assert_eq!(data.len(), width * height * 3);
        Self {
            width,
            height,
            data,
        }
    }

    /// One interleaved row, `3 * width` bytes.
    #[inline]
    pub fn row(&self, y: usize) -> &[u8] {
        &self.data[y * self.width * 3..(y + 1) * self.width * 3]
    }
}

/// Single-channel f32 matrix (per-image gain map at block resolution;
/// mirrors the CV_32F mats `BlocksCompensator::getMatGains` returns).
#[derive(Debug, Clone)]
pub struct GainMap {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
}

impl GainMap {
    #[inline]
    pub fn at(&self, x: usize, y: usize) -> f32 {
        self.data[y * self.width + x]
    }
}

/// Port of `cv::detail::BlocksGainCompensator` (GAIN_BLOCKS), the Stitcher
/// PANORAMA default. Construct with [`BlocksGainCompensator::feed`].
#[derive(Debug, Clone)]
pub struct BlocksGainCompensator {
    gain_maps: Vec<GainMap>,
}

/// `bl_width_` / `bl_height_` defaults (exposure_compensate.hpp).
const BLOCK: i32 = 32;
/// `nr_gain_filtering_iterations_` default.
const GAIN_FILTERING_ITERATIONS: usize = 2;

/// Largest equation count still solved by the dense `LUImpl` port, which is
/// what keeps the oracle gain maps bit-exact. The reference dumps need 528
/// (ring) and 2993 (sphere) equations, so both stay on the dense path;
/// above this the system goes to `solve_gains_cg`.
const DENSE_GAIN_MAX_EQ: usize = 3072;

impl BlocksGainCompensator {
    /// `BlocksCompensator::feedWithStrategy<GainCompensator>`
    /// (exposure_compensate.cpp:462-529).
    ///
    /// `corners` are the global top-left positions of the warped images,
    /// `masks` the warped validity masks; a pixel participates iff its mask
    /// value is exactly 255 (OpenCV pairs every mask with the level 255).
    pub fn feed(corners: &[(i32, i32)], images: &[RgbImage], masks: &[GrayImage]) -> Self {
        assert_eq!(corners.len(), images.len());
        assert_eq!(images.len(), masks.len());
        let num_images = images.len();

        // Construct blocks for the inner gain compensator.
        let mut bl_per_imgs = Vec::with_capacity(num_images);
        let mut blocks = Vec::new();
        for img_idx in 0..num_images {
            let img = &images[img_idx];
            let mask = &masks[img_idx];
            assert_eq!(img.width, mask.width);
            assert_eq!(img.height, mask.height);
            let cols = img.width as i32;
            let rows = img.height as i32;
            let bl_per_w = (cols + BLOCK - 1) / BLOCK;
            let bl_per_h = (rows + BLOCK - 1) / BLOCK;
            // Block size is recomputed so the grid covers the image evenly.
            let bl_width = (cols + bl_per_w - 1) / bl_per_w;
            let bl_height = (rows + bl_per_h - 1) / bl_per_h;
            bl_per_imgs.push((bl_per_w as usize, bl_per_h as usize));
            for by in 0..bl_per_h {
                for bx in 0..bl_per_w {
                    let tl_x = bx * bl_width;
                    let tl_y = by * bl_height;
                    let br_x = (tl_x + bl_width).min(cols);
                    let br_y = (tl_y + bl_height).min(rows);
                    blocks.push(BlockView {
                        corner: (corners[img_idx].0 + tl_x, corners[img_idx].1 + tl_y),
                        width: (br_x - tl_x) as usize,
                        height: (br_y - tl_y) as usize,
                        x0: tl_x as usize,
                        y0: tl_y as usize,
                        img,
                        mask,
                    });
                }
            }
        }

        // One GainCompensator over the whole block grid (nr_feeds = 1,
        // similarity mask disabled — the Stitcher defaults).
        let gains = gain_compensator_feed(&blocks);

        // Reshape per image and smooth twice with the [.25 .5 .25] kernel.
        let mut gain_maps = Vec::with_capacity(num_images);
        let mut bl_idx = 0usize;
        for &(bl_per_w, bl_per_h) in &bl_per_imgs {
            let n = bl_per_w * bl_per_h;
            let data: Vec<f32> = gains[bl_idx..bl_idx + n]
                .iter()
                .map(|&g| g as f32)
                .collect();
            bl_idx += n;
            let mut map = GainMap {
                width: bl_per_w,
                height: bl_per_h,
                data,
            };
            for _ in 0..GAIN_FILTERING_ITERATIONS {
                map = sep_filter_121(&map);
            }
            gain_maps.push(map);
        }
        Self { gain_maps }
    }

    /// `BlocksCompensator::apply` (exposure_compensate.cpp:560-582): resize
    /// the gain map to the image size with INTER_LINEAR and multiply each
    /// channel, saturating to u8. OpenCV ignores the `corner`/`mask`
    /// arguments, so they are omitted here.
    pub fn apply(&self, index: usize, image: &mut RgbImage) {
        let gm = &self.gain_maps[index];
        let resized;
        let gain: &[f32] = if gm.width == image.width && gm.height == image.height {
            &gm.data
        } else {
            resized = resize_linear_f32(gm, image.width, image.height);
            &resized
        };
        for (px, &g) in image.data.as_chunks_mut::<3>().0.iter_mut().zip(gain) {
            for c in px {
                *c = saturate_u8(*c as f32 * g);
            }
        }
    }

    /// Per-image gain maps at block resolution — exactly what
    /// `BlocksCompensator::getMatGains` returns (CV_32F).
    pub fn gain_maps(&self) -> &[GainMap] {
        &self.gain_maps
    }
}

/// A block pseudo-image: a rectangle of a parent image with a global corner,
/// exactly what `feedWithStrategy` pushes into `block_images`/`block_masks`.
struct BlockView<'a> {
    /// Global top-left (parent corner + block offset).
    corner: (i32, i32),
    width: usize,
    height: usize,
    /// Offset of the block inside the parent image.
    x0: usize,
    y0: usize,
    img: &'a RgbImage,
    mask: &'a GrayImage,
}

/// `cv::detail::overlapRoi` (util.cpp): half-open intersection of two
/// placed rectangles; `None` when the interiors do not intersect.
fn overlap_roi(
    tl1: (i32, i32),
    sz1: (i32, i32),
    tl2: (i32, i32),
    sz2: (i32, i32),
) -> Option<(i32, i32, i32, i32)> {
    let x_tl = tl1.0.max(tl2.0);
    let y_tl = tl1.1.max(tl2.1);
    let x_br = (tl1.0 + sz1.0).min(tl2.0 + sz2.0);
    let y_br = (tl1.1 + sz1.1).min(tl2.1 + sz2.1);
    (x_tl < x_br && y_tl < y_br).then_some((x_tl, y_tl, x_br - x_tl, y_br - y_tl))
}

/// `cv::norm(Vec<uchar, 3>)`: sqrt of the f64 sum of squares. The inputs are
/// small integers, so the f64 result is exact up to one correctly-rounded
/// sqrt — bit-identical to OpenCV regardless of channel order.
#[inline]
fn pix_norm(p: &[u8]) -> f64 {
    let c0 = p[0] as f64;
    let c1 = p[1] as f64;
    let c2 = p[2] as f64;
    (c0 * c0 + c1 * c1 + c2 * c2).sqrt()
}

/// A neighbour in the block-overlap graph: OpenCV's dense `N`/`I` matrices
/// restricted to the pairs whose rectangles actually intersect. Every other
/// entry of those matrices is a structural zero, and a structural zero
/// contributes `+= 0.0` to the normal equations — exact in f64 — so dropping
/// it leaves every accumulated value bit-identical.
#[derive(Clone, Copy)]
struct Nbr {
    j: u32,
    nij: i32,
    /// `I[i][j]`: mean intensity of block `i` over the `i`–`j` overlap.
    iij: f64,
    /// `I[j][i]`.
    iji: f64,
}

/// Compressed sparse row; columns ascending within each row.
struct Csr {
    row_ptr: Vec<usize>,
    col: Vec<u32>,
    val: Vec<f64>,
}

impl Csr {
    fn mul_into(&self, x: &[f64], out: &mut [f64]) {
        for (i, o) in out.iter_mut().enumerate() {
            let mut s = 0f64;
            for k in self.row_ptr[i]..self.row_ptr[i + 1] {
                s += self.val[k] * x[self.col[k] as usize];
            }
            *o = s;
        }
    }
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Every pair `(i, j)`, `i <= j`, whose block rectangles intersect.
///
/// OpenCV scans all n² pairs; at 137 images that is 1.1e8 rectangle tests to
/// find ~0.1% hits. A uniform grid sized to the largest block returns the
/// same pair set exactly — two rectangles that intersect must share at least
/// one cell — in time proportional to the number of hits.
fn overlapping_pairs(images: &[BlockView]) -> Vec<(usize, usize)> {
    let n = images.len();
    let mut cell = 1i64;
    let (mut min_x, mut min_y) = (i64::MAX, i64::MAX);
    let (mut max_x, mut max_y) = (i64::MIN, i64::MIN);
    for b in images {
        cell = cell.max(b.width as i64).max(b.height as i64);
        min_x = min_x.min(i64::from(b.corner.0));
        min_y = min_y.min(i64::from(b.corner.1));
        max_x = max_x.max(i64::from(b.corner.0) + b.width as i64);
        max_y = max_y.max(i64::from(b.corner.1) + b.height as i64);
    }
    let gw = ((max_x - min_x) / cell + 1) as usize;
    let gh = ((max_y - min_y) / cell + 1) as usize;
    // Every block spans at most 2x2 cells, so each lands in at most 4 buckets.
    let span = |b: &BlockView| {
        let cx0 = ((i64::from(b.corner.0) - min_x) / cell) as usize;
        let cy0 = ((i64::from(b.corner.1) - min_y) / cell) as usize;
        let cx1 = ((i64::from(b.corner.0) + b.width as i64 - 1 - min_x) / cell) as usize;
        let cy1 = ((i64::from(b.corner.1) + b.height as i64 - 1 - min_y) / cell) as usize;
        (cx0, cy0, cx1, cy1)
    };

    let mut buckets: Vec<Vec<u32>> = vec![Vec::new(); gw * gh];
    for (i, b) in images.iter().enumerate() {
        let (cx0, cy0, cx1, cy1) = span(b);
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                buckets[cy * gw + cx].push(i as u32);
            }
        }
    }

    let mut pairs = Vec::new();
    let mut seen = vec![u32::MAX; n];
    for (i, b1) in images.iter().enumerate() {
        let (cx0, cy0, cx1, cy1) = span(b1);
        let start = pairs.len();
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                for &jj in &buckets[cy * gw + cx] {
                    let j = jj as usize;
                    if j < i || seen[j] == i as u32 {
                        continue;
                    }
                    seen[j] = i as u32;
                    let b2 = &images[j];
                    if overlap_roi(
                        b1.corner,
                        (b1.width as i32, b1.height as i32),
                        b2.corner,
                        (b2.width as i32, b2.height as i32),
                    )
                    .is_some()
                    {
                        pairs.push((i, j));
                    }
                }
            }
        }
        pairs[start..].sort_unstable();
    }
    pairs
}

/// Jacobi-preconditioned conjugate gradient for the gain normal equations,
/// the large-system alternative to the dense `lu_solve` below.
///
/// `A` is symmetric — `N` is symmetric and the off-diagonal term is
/// `-2·alpha·I_ij·I_ji·N_ij`, identical either way round — and diagonally
/// dominant, because only the diagonal collects `beta·N_ij` (beta = 100).
/// That makes CG well conditioned here, and it touches only the ~20
/// non-zeros per row instead of the full n² matrix.
///
/// Writes the solution into `b`. Returns false when the diagonal is not
/// positive or the iteration stalls, so the caller can fall back to
/// OpenCV's zero-fill for a singular system.
fn solve_gains_cg(a: &Csr, b: &mut [f64]) -> bool {
    let n = b.len();
    let mut minv = vec![0f64; n];
    for (i, mi) in minv.iter_mut().enumerate() {
        let mut d = 0f64;
        for k in a.row_ptr[i]..a.row_ptr[i + 1] {
            if a.col[k] as usize == i {
                d = a.val[k];
                break;
            }
        }
        if d.is_nan() || d <= 0.0 {
            return false;
        }
        *mi = 1.0 / d;
    }

    let rhs = b.to_vec();
    let bnorm = dot(&rhs, &rhs).sqrt();
    if bnorm == 0.0 {
        b.fill(0.0);
        return true;
    }
    let tol = 1e-14 * bnorm;

    let mut x = vec![0f64; n];
    let mut r = rhs;
    let mut z: Vec<f64> = r.iter().zip(&minv).map(|(ri, mi)| ri * mi).collect();
    let mut p = z.clone();
    let mut rz = dot(&r, &z);
    let mut ap = vec![0f64; n];

    // CG's exact-arithmetic bound is n steps; this system converges in far
    // fewer, and the cap only guards a degenerate matrix.
    for _ in 0..n.max(200) {
        a.mul_into(&p, &mut ap);
        let pap = dot(&p, &ap);
        if pap.is_nan() || pap <= 0.0 {
            return false;
        }
        let step = rz / pap;
        for i in 0..n {
            x[i] += step * p[i];
            r[i] -= step * ap[i];
        }
        if dot(&r, &r).sqrt() <= tol {
            b.copy_from_slice(&x);
            return true;
        }
        for i in 0..n {
            z[i] = r[i] * minv[i];
        }
        let rz_next = dot(&r, &z);
        let beta = rz_next / rz;
        for i in 0..n {
            p[i] = z[i] + beta * p[i];
        }
        rz = rz_next;
    }
    false
}

/// `GainCompensator::feed`/`singleFeed` for the Stitcher defaults
/// (`nr_feeds = 1`, similarity mask disabled, `update_gain = true`), over
/// block pseudo-images. Returns one f64 gain per input, 1.0 for inputs that
/// intersect no other input ("skipped" in OpenCV).
///
/// OpenCV holds `N` and `I` as dense n x n Mats and solves the normal
/// equations with a dense `DECOMP_LU`. At 137 images that is 14,796 blocks:
/// 4.1 GB of matrices that measure 0.13% non-zero, and a 1.1e12-flop solve.
/// Both are stored and solved sparsely here. The assembly is bit-identical
/// either way — the entries the dense loop visits and this one skips
/// contribute exactly `+= 0.0` — so only the solver differs, and only above
/// [`DENSE_GAIN_MAX_EQ`].
fn gain_compensator_feed(images: &[BlockView]) -> Vec<f64> {
    let n = images.len();
    if n == 0 {
        return Vec::new();
    }

    // Per-pair overlap statistics. Each pair is independent, so this fans
    // out; the values are unchanged by the order they are computed in.
    let pairs = overlapping_pairs(images);
    let measured = crate::par::map(&pairs, |&(i, j)| {
        let b1 = &images[i];
        let b2 = &images[j];
        let (rx, ry, rw, rh) = overlap_roi(
            b1.corner,
            (b1.width as i32, b1.height as i32),
            b2.corner,
            (b2.width as i32, b2.height as i32),
        )
        .expect("overlapping_pairs only yields intersecting rectangles");
        let (rw, rh) = (rw as usize, rh as usize);
        // ROI in parent-image coordinates for each side.
        let l1x = (rx - b1.corner.0) as usize + b1.x0;
        let l1y = (ry - b1.corner.1) as usize + b1.y0;
        let l2x = (rx - b2.corner.0) as usize + b2.x0;
        let l2y = (ry - b2.corner.1) as usize + b2.y0;

        // intersect = (mask1 == 255) & (mask2 == 255); count and the two
        // intensity sums accumulate in the same row-major order OpenCV
        // scans, so all values are bit-identical.
        let mut intersect_count = 0usize;
        let mut isum1 = 0f64;
        let mut isum2 = 0f64;
        for y in 0..rh {
            let m1 = &b1.mask.row(l1y + y)[l1x..l1x + rw];
            let m2 = &b2.mask.row(l2y + y)[l2x..l2x + rw];
            let r1 = &b1.img.row(l1y + y)[l1x * 3..(l1x + rw) * 3];
            let r2 = &b2.img.row(l2y + y)[l2x * 3..(l2x + rw) * 3];
            for x in 0..rw {
                if m1[x] == 255 && m2[x] == 255 {
                    intersect_count += 1;
                    isum1 += pix_norm(&r1[x * 3..x * 3 + 3]);
                    isum2 += pix_norm(&r2[x * 3..x * 3 + 3]);
                }
            }
        }
        (intersect_count, isum1, isum2)
    });

    let mut nbrs: Vec<Vec<Nbr>> = vec![Vec::new(); n];
    let mut skip = vec![true; n];
    for (&(i, j), &(count, isum1, isum2)) in pairs.iter().zip(&measured) {
        let nij = count.max(1) as i32;
        // OpenCV records N even for a zero mask intersection (as max(count,1))
        // but leaves I at zero and does not clear `skip`.
        let (iij, iji) = if count == 0 {
            (0f64, 0f64)
        } else {
            // Don't skip images that intersect at least one other image.
            if i != j {
                skip[i] = false;
                skip[j] = false;
            }
            (isum1 / f64::from(nij), isum2 / f64::from(nij))
        };
        nbrs[i].push(Nbr {
            j: j as u32,
            nij,
            iij,
            iji,
        });
        if i != j {
            nbrs[j].push(Nbr {
                j: i as u32,
                nij,
                iij: iji,
                iji: iij,
            });
        }
    }
    // Ascending column order is what makes the assembly below match the
    // dense loop's accumulation order term for term.
    for row in nbrs.iter_mut() {
        row.sort_unstable_by_key(|e| e.j);
    }

    // Least squares on the gains: error
    //   sum_ij N_ij * [ alpha * (g_i I_ij - g_j I_ji)^2 + beta * (1 - g_i)^2 ]
    // with alpha = 0.01, beta = 100, assembled in OpenCV's exact loop order.
    let alpha = 0.01f64;
    let beta = 100f64;
    let num_eq = skip.iter().filter(|s| !**s).count();
    let mut gains = vec![1f64; n];
    if num_eq == 0 {
        return gains;
    }

    let mut eq_of = vec![u32::MAX; n];
    let mut next_eq = 0u32;
    for i in 0..n {
        if !skip[i] {
            eq_of[i] = next_eq;
            next_eq += 1;
        }
    }

    let mut row_ptr = Vec::with_capacity(num_eq + 1);
    let mut col: Vec<u32> = Vec::new();
    let mut val: Vec<f64> = Vec::new();
    let mut b = vec![0f64; num_eq];
    let mut offs: Vec<(u32, f64)> = Vec::new();
    row_ptr.push(0usize);
    for i in 0..n {
        if skip[i] {
            continue;
        }
        let ki = eq_of[i] as usize;
        let mut diag = 0f64;
        offs.clear();
        for nb in &nbrs[i] {
            let j = nb.j as usize;
            if skip[j] {
                continue;
            }
            let nij = f64::from(nb.nij);
            b[ki] += beta * nij;
            diag += beta * nij;
            if j != i {
                diag += 2.0 * alpha * nb.iij * nb.iij * nij;
                // `0.0 -` rather than a negation, so a zero term keeps the
                // dense `a[ki][kj] -= 0.0` sign.
                offs.push((eq_of[j], 0.0 - 2.0 * alpha * nb.iij * nb.iji * nij));
            }
        }
        // `eq_of` is monotonic, so `offs` is already ascending; splice the
        // diagonal into place to keep the row sorted.
        let cut = offs.partition_point(|&(c, _)| (c as usize) < ki);
        for &(c, v) in &offs[..cut] {
            col.push(c);
            val.push(v);
        }
        col.push(ki as u32);
        val.push(diag);
        for &(c, v) in &offs[cut..] {
            col.push(c);
            val.push(v);
        }
        row_ptr.push(col.len());
    }

    let solved = if num_eq <= DENSE_GAIN_MAX_EQ {
        // cv::solve(A, b, l_gains) — DECOMP_LU, on the scattered dense
        // matrix. This is the path the oracle gain fixtures are pinned to.
        let mut dense = vec![0f64; num_eq * num_eq];
        for i in 0..num_eq {
            for k in row_ptr[i]..row_ptr[i + 1] {
                dense[i * num_eq + col[k] as usize] = val[k];
            }
        }
        lu_solve(&mut dense, num_eq, &mut b)
    } else {
        solve_gains_cg(&Csr { row_ptr, col, val }, &mut b)
    };
    // OpenCV zero-fills on a singular system.
    if !solved {
        b.fill(0.0);
    }

    let mut j = 0usize;
    for i in 0..n {
        if !skip[i] {
            gains[i] = b[j];
            j += 1;
        }
    }
    gains
}

/// Port of OpenCV's `LUImpl<double>` (core/src/matrix_decomp.cpp) with a
/// single right-hand side, as reached via `cv::solve(..., DECOMP_LU)` →
/// `hal::LU64f` in builds without LAPACK: Gaussian elimination with partial
/// pivoting (largest |value| in the column), pivot threshold
/// `DBL_EPSILON * 100`. On success `b` holds the solution; returns `false`
/// (singular) when a pivot falls below the threshold.
fn lu_solve(a: &mut [f64], m: usize, b: &mut [f64]) -> bool {
    debug_assert_eq!(a.len(), m * m);
    debug_assert_eq!(b.len(), m);
    let eps = f64::EPSILON * 100.0;

    for i in 0..m {
        // Pivot: row with the largest |A[j][i]|, j >= i.
        let mut k = i;
        for j in i + 1..m {
            if a[j * m + i].abs() > a[k * m + i].abs() {
                k = j;
            }
        }
        if a[k * m + i].abs() < eps {
            return false;
        }
        if k != i {
            for j in i..m {
                a.swap(i * m + j, k * m + j);
            }
            b.swap(i, k);
        }

        let d = -1.0 / a[i * m + i];
        let (upper, lower) = a.split_at_mut((i + 1) * m);
        let pivot_row = &upper[i * m + i..(i + 1) * m];
        let (b_upper, b_lower) = b.split_at_mut(i + 1);
        let b_i = b_upper[i];
        for (row, b_j) in lower.chunks_exact_mut(m).zip(b_lower.iter_mut()) {
            let alpha = row[i] * d;
            for (x, &p) in row[i..].iter_mut().zip(pivot_row) {
                *x += alpha * p;
            }
            *b_j += alpha * b_i;
        }
    }

    // Back substitution.
    for i in (0..m).rev() {
        let mut s = b[i];
        for k in i + 1..m {
            s -= a[i * m + k] * b[k];
        }
        b[i] = s / a[i * m + i];
    }
    true
}

/// `cv::borderInterpolate(p, len, BORDER_REFLECT_101)`.
fn border_reflect_101(p: i64, len: i64) -> usize {
    if len == 1 {
        return 0;
    }
    let mut p = p;
    while p < 0 || p >= len {
        if p < 0 {
            p = -p;
        } else {
            p = 2 * len - p - 2;
        }
    }
    p as usize
}

/// One `sepFilter2D(map, CV_32F, [.25 .5 .25], [.25 .5 .25])` pass with the
/// default BORDER_REFLECT_101: horizontal then vertical, all math in f32 as
/// `center*0.5 + (side_a + side_b)*0.25` (the symmetric small-kernel filter
/// formulation; f32 addition is commutative, so term order is immaterial).
fn sep_filter_121(src: &GainMap) -> GainMap {
    let (w, h) = (src.width, src.height);
    let mut tmp = vec![0f32; w * h];
    for y in 0..h {
        let row = &src.data[y * w..(y + 1) * w];
        let out = &mut tmp[y * w..(y + 1) * w];
        for (x, o) in out.iter_mut().enumerate() {
            let xm = border_reflect_101(x as i64 - 1, w as i64);
            let xp = border_reflect_101(x as i64 + 1, w as i64);
            *o = (row[xm] + row[xp]) * 0.25 + row[x] * 0.5;
        }
    }
    let mut dst = vec![0f32; w * h];
    for y in 0..h {
        let ym = border_reflect_101(y as i64 - 1, h as i64);
        let yp = border_reflect_101(y as i64 + 1, h as i64);
        for x in 0..w {
            dst[y * w + x] = (tmp[ym * w + x] + tmp[yp * w + x]) * 0.25 + tmp[y * w + x] * 0.5;
        }
    }
    GainMap {
        width: w,
        height: h,
        data: dst,
    }
}

/// Linear-interpolation coefficients for one resize axis, mirroring
/// `cv::resize` INTER_LINEAR (resize.cpp): source coordinate
/// `(d + 0.5)*scale - 0.5` computed in f64 then cast to f32, floor/frac in
/// f32, clamped to the edges with a zero fraction (32F images keep float
/// weights — no fixed-point path).
fn resize_axis_coeffs(src_len: usize, dst_len: usize) -> Vec<(usize, usize, f32, f32)> {
    let scale = src_len as f64 / dst_len as f64;
    (0..dst_len)
        .map(|d| {
            let f = ((d as f64 + 0.5) * scale - 0.5) as f32;
            let mut s = f.floor() as i64;
            let mut f = f - s as f32;
            if s < 0 {
                s = 0;
                f = 0.0;
            }
            if s >= src_len as i64 - 1 {
                s = src_len as i64 - 1;
                f = 0.0;
            }
            let s = s as usize;
            (s, (s + 1).min(src_len - 1), 1.0 - f, f)
        })
        .collect()
}

/// `cv::resize(gain_map, dsize, INTER_LINEAR)` on CV_32F: horizontal pass
/// into f32 row buffers, then the vertical blend — the FilterEngine order,
/// all in f32.
fn resize_linear_f32(src: &GainMap, dst_w: usize, dst_h: usize) -> Vec<f32> {
    let xc = resize_axis_coeffs(src.width, dst_w);
    let yc = resize_axis_coeffs(src.height, dst_h);
    let hresize = |sy: usize, out: &mut [f32]| {
        let row = &src.data[sy * src.width..(sy + 1) * src.width];
        for (o, &(sx0, sx1, a0, a1)) in out.iter_mut().zip(&xc) {
            *o = row[sx0] * a0 + row[sx1] * a1;
        }
    };
    let mut row0 = vec![0f32; dst_w];
    let mut row1 = vec![0f32; dst_w];
    let mut dst = vec![0f32; dst_w * dst_h];
    for (dy, &(sy0, sy1, b0, b1)) in yc.iter().enumerate() {
        hresize(sy0, &mut row0);
        hresize(sy1, &mut row1);
        for (x, o) in dst[dy * dst_w..(dy + 1) * dst_w].iter_mut().enumerate() {
            *o = row0[x] * b0 + row1[x] * b1;
        }
    }
    dst
}

/// `saturate_cast<uchar>(float)`: cvRound (ties to even) then clamp.
#[inline]
fn saturate_u8(v: f32) -> u8 {
    cv_round_f32(v).clamp(0, 255) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlap_roi_matches_opencv() {
        // Touching edges do not overlap.
        assert_eq!(overlap_roi((0, 0), (10, 10), (10, 0), (10, 10)), None);
        assert_eq!(
            overlap_roi((0, 0), (10, 10), (5, 3), (10, 10)),
            Some((5, 3, 5, 7))
        );
        // Identical rects (the i == j diagonal case).
        assert_eq!(
            overlap_roi((-3, 2), (4, 5), (-3, 2), (4, 5)),
            Some((-3, 2, 4, 5))
        );
    }

    #[test]
    fn border_reflect_101_matches_opencv() {
        assert_eq!(border_reflect_101(-1, 5), 1);
        assert_eq!(border_reflect_101(-2, 5), 2);
        assert_eq!(border_reflect_101(5, 5), 3);
        assert_eq!(border_reflect_101(6, 5), 2);
        assert_eq!(border_reflect_101(-1, 1), 0);
        assert_eq!(border_reflect_101(1, 2), 1);
        assert_eq!(border_reflect_101(2, 2), 0);
    }

    /// The CG path must reach the same solution as the dense `DECOMP_LU`
    /// port it replaces above `DENSE_GAIN_MAX_EQ`, on a system shaped like
    /// the real one: strong positive diagonal, symmetric negative
    /// off-diagonals, ~20 non-zeros per row.
    #[test]
    fn cg_matches_dense_lu_on_a_gain_like_system() {
        const N: usize = 300;
        let mut seed = 0x1234_5678u32;
        let mut rnd = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            f64::from(seed >> 8) / f64::from(1u32 << 24)
        };

        // Symmetric off-diagonal couplings to ~10 neighbours either side.
        let mut dense = vec![0f64; N * N];
        for i in 0..N {
            for d in 1..=10usize {
                let j = (i + d) % N;
                if j <= i {
                    continue;
                }
                let v = -0.5 * rnd();
                dense[i * N + j] = v;
                dense[j * N + i] = v;
            }
        }
        // Diagonal dominant, as beta*N_ij makes the real one.
        for i in 0..N {
            let off: f64 = (0..N)
                .filter(|&j| j != i)
                .map(|j| dense[i * N + j].abs())
                .sum();
            dense[i * N + i] = off + 1.0 + rnd();
        }
        let rhs: Vec<f64> = (0..N).map(|_| rnd()).collect();

        // Dense LU reference.
        let mut a_lu = dense.clone();
        let mut x_lu = rhs.clone();
        assert!(lu_solve(&mut a_lu, N, &mut x_lu));

        // Same system as CSR, through CG.
        let mut row_ptr = vec![0usize];
        let mut col = Vec::new();
        let mut val = Vec::new();
        for i in 0..N {
            for j in 0..N {
                let v = dense[i * N + j];
                if v != 0.0 {
                    col.push(j as u32);
                    val.push(v);
                }
            }
            row_ptr.push(col.len());
        }
        let mut x_cg = rhs.clone();
        assert!(solve_gains_cg(&Csr { row_ptr, col, val }, &mut x_cg));

        for (i, (l, c)) in x_lu.iter().zip(&x_cg).enumerate() {
            assert!((l - c).abs() < 1e-10, "x[{i}]: LU {l} vs CG {c}");
        }
    }

    /// The uniform grid must find exactly the pairs the O(n^2) scan does.
    #[test]
    fn overlapping_pairs_matches_exhaustive_scan() {
        let img = RgbImage::new(8, 8, vec![0u8; 8 * 8 * 3]);
        let mask = GrayImage::new(8, 8, vec![255u8; 8 * 8]);
        let mut seed = 0xfeed_1234u32;
        let mut rnd = |m: i32| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((seed >> 8) % m as u32) as i32
        };
        let blocks: Vec<BlockView> = (0..200)
            .map(|_| BlockView {
                corner: (rnd(40) - 20, rnd(40) - 20),
                width: 1 + rnd(6) as usize,
                height: 1 + rnd(6) as usize,
                x0: 0,
                y0: 0,
                img: &img,
                mask: &mask,
            })
            .collect();

        let mut exhaustive = Vec::new();
        for i in 0..blocks.len() {
            for j in i..blocks.len() {
                let (b1, b2) = (&blocks[i], &blocks[j]);
                if overlap_roi(
                    b1.corner,
                    (b1.width as i32, b1.height as i32),
                    b2.corner,
                    (b2.width as i32, b2.height as i32),
                )
                .is_some()
                {
                    exhaustive.push((i, j));
                }
            }
        }
        let mut got = overlapping_pairs(&blocks);
        got.sort_unstable();
        assert_eq!(got, exhaustive);
    }

    #[test]
    fn lu_solve_known_system() {
        // A = [[4,1],[1,3]], b = [1,2] -> x = [1/11, 7/11]
        let mut a = vec![4.0, 1.0, 1.0, 3.0];
        let mut b = vec![1.0, 2.0];
        assert!(lu_solve(&mut a, 2, &mut b));
        assert!((b[0] - 1.0 / 11.0).abs() < 1e-15);
        assert!((b[1] - 7.0 / 11.0).abs() < 1e-15);

        let mut a = vec![1.0, 2.0, 2.0, 4.0]; // singular
        let mut b = vec![1.0, 2.0];
        assert!(!lu_solve(&mut a, 2, &mut b));
    }

    #[test]
    fn smoothing_is_normalized() {
        // A constant map stays constant under the 121 kernel (reflect-101
        // borders leak no mass).
        let map = GainMap {
            width: 5,
            height: 4,
            data: vec![1.5; 20],
        };
        let out = sep_filter_121(&map);
        assert!(out.data.iter().all(|&v| v == 1.5));
    }

    #[test]
    fn single_image_gain_is_one() {
        // One image overlapping nothing: skipped, gain stays 1.
        let img = RgbImage::new(40, 40, vec![128; 40 * 40 * 3]);
        let mask = GrayImage::new(40, 40, vec![255; 40 * 40]);
        let comp = BlocksGainCompensator::feed(&[(0, 0)], &[img], &[mask]);
        assert_eq!(comp.gain_maps().len(), 1);
        assert!(comp.gain_maps()[0].data.iter().all(|&g| g == 1.0));
    }

    #[test]
    fn two_identical_images_gain_one_and_apply_is_identity() {
        // Two fully-overlapping identical images: the system is symmetric,
        // gains must be ~1 and apply must keep pixels unchanged.
        let data: Vec<u8> = (0..64 * 64 * 3).map(|i| (i % 251) as u8).collect();
        let img = RgbImage::new(64, 64, data.clone());
        let mask = GrayImage::new(64, 64, vec![255; 64 * 64]);
        let comp = BlocksGainCompensator::feed(
            &[(0, 0), (0, 0)],
            &[img.clone(), img.clone()],
            &[mask.clone(), mask],
        );
        for gm in comp.gain_maps() {
            for &g in &gm.data {
                assert!((g - 1.0).abs() < 1e-6, "gain {g}");
            }
        }
        let mut out = img.clone();
        comp.apply(0, &mut out);
        assert_eq!(out.data, img.data);
    }
}
