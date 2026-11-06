//! Blending — port of `cv::detail::Blender` / `FeatherBlender` /
//! `MultiBandBlender` (blenders.cpp) and the `cv::pyrDown` / `cv::pyrUp`
//! kernels they rely on (imgproc/src/pyramids.cpp).

#![allow(clippy::needless_range_loop)]

use crate::imgproc::GrayImage;

const WEIGHT_EPS: f32 = 1e-5;

/// `distanceTransform(mask, DIST_L1, 3)`: two-pass 3x3 chamfer with
/// a = 1, b = 2 (exact for L1), f32 output.
pub fn distance_transform_l1(mask: &GrayImage) -> Vec<f32> {
    let (w, h) = (mask.width, mask.height);
    const INF: f32 = 1e15;
    let mut dist = vec![0.0f32; w * h];
    for i in 0..w * h {
        dist[i] = if mask.data[i] == 0 { 0.0 } else { INF };
    }
    let (a, b) = (1.0f32, 2.0f32);
    // Forward pass.
    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            if dist[idx] == 0.0 {
                continue;
            }
            let mut d = dist[idx];
            if x > 0 {
                d = d.min(dist[idx - 1] + a);
            }
            if y > 0 {
                d = d.min(dist[idx - w] + a);
                if x > 0 {
                    d = d.min(dist[idx - w - 1] + b);
                }
                if x + 1 < w {
                    d = d.min(dist[idx - w + 1] + b);
                }
            }
            dist[idx] = d;
        }
    }
    // Backward pass.
    for y in (0..h).rev() {
        for x in (0..w).rev() {
            let idx = y * w + x;
            if dist[idx] == 0.0 {
                continue;
            }
            let mut d = dist[idx];
            if x + 1 < w {
                d = d.min(dist[idx + 1] + a);
            }
            if y + 1 < h {
                d = d.min(dist[idx + w] + a);
                if x + 1 < w {
                    d = d.min(dist[idx + w + 1] + b);
                }
                if x > 0 {
                    d = d.min(dist[idx + w - 1] + b);
                }
            }
            dist[idx] = d;
        }
    }
    dist
}

/// `createWeightMap`: distance transform scaled by sharpness, truncated at 1.
pub fn create_weight_map(mask: &GrayImage, sharpness: f32) -> Vec<f32> {
    let mut w = distance_transform_l1(mask);
    for v in w.iter_mut() {
        *v = (*v * sharpness).min(1.0);
    }
    w
}

/// `FeatherBlender` (sharpness default 0.02): weighted accumulation into a
/// CV_16SC3-equivalent buffer, normalized by the summed weight map.
pub struct FeatherBlender {
    sharpness: f32,
    roi: (i32, i32, usize, usize), // (x, y, w, h)
    dst: Vec<[i16; 3]>,
    dst_weight: Vec<f32>,
}

impl FeatherBlender {
    pub fn new(sharpness: f32) -> Self {
        Self {
            sharpness,
            roi: (0, 0, 0, 0),
            dst: Vec::new(),
            dst_weight: Vec::new(),
        }
    }

    pub fn prepare(&mut self, x: i32, y: i32, w: usize, h: usize) {
        self.roi = (x, y, w, h);
        self.dst = vec![[0i16; 3]; w * h];
        self.dst_weight = vec![0.0f32; w * h];
    }

    /// `FeatherBlender::feed`: img is RGB u8 (converted to i16 exactly like
    /// the compose loop's `convertTo(CV_16S)`); per-addend products are
    /// truncated toward zero via the `static_cast<short>` port.
    pub fn feed(
        &mut self,
        img_rgb: &[u8],
        img_w: usize,
        img_h: usize,
        mask: &GrayImage,
        tl: (i32, i32),
    ) {
        assert_eq!(img_rgb.len(), img_w * img_h * 3);
        assert_eq!(mask.width, img_w);
        assert_eq!(mask.height, img_h);
        let weight = create_weight_map(mask, self.sharpness);
        let (rx, ry, rw, _rh) = self.roi;
        let dx = (tl.0 - rx) as usize;
        let dy = (tl.1 - ry) as usize;

        for y in 0..img_h {
            for x in 0..img_w {
                let wv = weight[y * img_w + x];
                let s = &img_rgb[(y * img_w + x) * 3..(y * img_w + x + 1) * 3];
                let d = &mut self.dst[(dy + y) * rw + dx + x];
                d[0] += (s[0] as i16 as f32 * wv) as i16;
                d[1] += (s[1] as i16 as f32 * wv) as i16;
                d[2] += (s[2] as i16 as f32 * wv) as i16;
                self.dst_weight[(dy + y) * rw + dx + x] += wv;
            }
        }
    }

    /// `FeatherBlender::blend` + `Blender::blend`: normalize by weights,
    /// zero uncovered pixels, return (RGB u8 clamped, coverage mask).
    pub fn blend(self) -> (Vec<u8>, GrayImage) {
        let (_x, _y, w, h) = self.roi;
        let mut out = vec![0u8; w * h * 3];
        let mut mask = vec![0u8; w * h];
        for i in 0..w * h {
            let cov = self.dst_weight[i] > WEIGHT_EPS;
            mask[i] = if cov { 255 } else { 0 };
            if cov {
                for c in 0..3 {
                    let v = (self.dst[i][c] as f32 / (self.dst_weight[i] + WEIGHT_EPS)) as i16;
                    out[i * 3 + c] = v.clamp(0, 255) as u8;
                }
            }
        }
        (out, GrayImage::new(w, h, mask))
    }
}

/// `resultRoi(corners, sizes)`: union rectangle. Returns (x, y, w, h).
pub fn result_roi(corners: &[(i32, i32)], sizes: &[(i32, i32)]) -> (i32, i32, usize, usize) {
    assert!(!corners.is_empty());
    let mut tl = (i32::MAX, i32::MAX);
    let mut br = (i32::MIN, i32::MIN);
    for (c, s) in corners.iter().zip(sizes) {
        tl.0 = tl.0.min(c.0);
        tl.1 = tl.1.min(c.1);
        br.0 = br.0.max(c.0 + s.0);
        br.1 = br.1.max(c.1 + s.1);
    }
    (tl.0, tl.1, (br.0 - tl.0) as usize, (br.1 - tl.1) as usize)
}

// ======================== Gaussian pyramid kernels ========================
//
// Ports of cv::pyrDown / cv::pyrUp (imgproc/src/pyramids.cpp) for the two
// type instantiations MultiBandBlender dispatches to:
//
//   CV_16SC3: pyrDown_<FixPtCast<short, 8>> / pyrUp_<FixPtCast<short, 6>>
//             — int accumulation of the [1 4 6 4 1] kernel, then
//             `(short)((sum + (1 << (shift-1))) >> shift)`.
//   CV_32FC1: pyrDown_<FltCast<float, 8>> — f32 accumulation, then
//             `sum * (float)(1./256)`.
//
// Border is BORDER_DEFAULT = BORDER_REFLECT_101 (pyrDown vertical +
// horizontal via borderInterpolate; pyrUp uses its own edge formulas
// horizontally and `borderInterpolate(2*sy, 2*h, REFLECT_101)/2` vertically).
//
// The integer paths are order-independent, so the scalar loops reproduce
// OpenCV's SIMD output bit-for-bit (the SIMD packs saturate where the scalar
// FixPtCast wraps, but blender values never reach the i16 limits). The f32
// path is NOT order-independent: OpenCV's universal-intrinsic loops compute
// `v_muladd` (a true fused multiply-add on aarch64 NEON, 4 f32 lanes) for
// the vectorized body and plain mul/add for the scalar tail, and the two
// round differently once weight values need more than 24 mantissa bits
// (num_bands >= 4 pyramids). `pyr_down_f32` therefore replicates the exact
// 128-bit lane structure of the NEON build the fixtures were recorded on
// (see tools/reference/gen_blend_fixtures.py); an AVX2 build of OpenCV (8
// lanes) would disagree with both in the last ulp of deep weight levels.
// The "scalar" tails are ALSO fma-contracted: clang's default
// -ffp-contract=on fuses the first product of `a*6 + (b+c)*4 + d + e` into
// fma(a, 6, (b+c)*4). Both facts were established empirically by testing
// every candidate association per element region against cv2 4.14.0 output
// (unique survivors; see the port notes in tools/reference/
// gen_blend_fixtures.py).

/// f32 lane count of the OpenCV universal-intrinsic build being mirrored
/// (128-bit NEON / SSE => 4).
const SIMD_F32_LANES: usize = 4;

/// `cv::borderInterpolate` (core) restricted to the two reflect modes used
/// here: `delta = 1` -> BORDER_REFLECT_101 (`gfedcb|abcdefgh|gfedcba`),
/// `delta = 0` -> BORDER_REFLECT (`fedcba|abcdefgh|hgfedcb`).
fn border_interpolate_reflect(mut p: i32, len: i32, delta: i32) -> i32 {
    if p >= 0 && p < len {
        return p;
    }
    if len == 1 {
        return 0;
    }
    loop {
        p = if p < 0 {
            -p - 1 + delta
        } else {
            len - 1 - (p - len) - delta
        };
        if p >= 0 && p < len {
            return p;
        }
    }
}

/// Source columns feeding pyrDown output column `x` — the tabL/tabM/tabR
/// machinery of pyramids.cpp:965-1100 collapsed to per-pixel form (exactly
/// equivalent: tabL is borderInterpolate around column 0, tabM the interior
/// `2x-2..2x+2` window, tabR borderInterpolate around `2*width0`).
fn pyr_down_cols(x: usize, w: usize, width0: usize) -> [usize; 5] {
    let mut cols = [0usize; 5];
    for (j, col) in cols.iter_mut().enumerate() {
        let sx = if x < width0 {
            2 * x as i32 + j as i32 - 2
        } else {
            (2 * width0 + (x - width0)) as i32 + j as i32 - 2
        };
        *col = border_interpolate_reflect(sx, w as i32, 1) as usize;
    }
    cols
}

/// `width0` of pyrDown_ (pyramids.cpp:972/1008): the first output column
/// whose 5-tap window would read past the right edge. C truncating division.
fn pyr_down_width0(w: usize, dw: usize) -> usize {
    usize::min(((w as i32 - 3) / 2 + 1).max(0) as usize, dw)
}

/// `cv::pyrDown` on CV_16SC3, default dst size `((w+1)/2, (h+1)/2)`,
/// BORDER_REFLECT_101. Returns (data, dst_w, dst_h).
pub fn pyr_down_i16c3(src: &[i16], w: usize, h: usize) -> (Vec<i16>, usize, usize) {
    const CN: usize = 3;
    assert_eq!(src.len(), w * h * CN);
    assert!(w >= 1 && h >= 1);
    let dw = w.div_ceil(2);
    let dh = h.div_ceil(2);
    let width0 = pyr_down_width0(w, dw);

    // Horizontal [1 4 6 4 1] convolution + decimation of every source row
    // (each is consumed by up to 5 output rows; values depend only on the
    // border-interpolated source row, so precompute all).
    let mut rows = vec![0i32; h * dw * CN];
    for sy in 0..h {
        let s = &src[sy * w * CN..(sy + 1) * w * CN];
        let row = &mut rows[sy * dw * CN..(sy + 1) * dw * CN];
        for x in 0..dw {
            let cols = pyr_down_cols(x, w, width0);
            for c in 0..CN {
                row[x * CN + c] = s[cols[2] * CN + c] as i32 * 6
                    + (s[cols[1] * CN + c] as i32 + s[cols[3] * CN + c] as i32) * 4
                    + s[cols[0] * CN + c] as i32
                    + s[cols[4] * CN + c] as i32;
            }
        }
    }

    // Vertical convolution + decimation, FixPtCast<short, 8>.
    let mut dst = vec![0i16; dw * dh * CN];
    for y in 0..dh {
        let r = |k: usize| -> &[i32] {
            let sy = border_interpolate_reflect(2 * y as i32 + k as i32 - 2, h as i32, 1) as usize;
            &rows[sy * dw * CN..(sy + 1) * dw * CN]
        };
        let (r0, r1, r2, r3, r4) = (r(0), r(1), r(2), r(3), r(4));
        let out = &mut dst[y * dw * CN..(y + 1) * dw * CN];
        for x in 0..dw * CN {
            let acc = r2[x] * 6 + (r1[x] + r3[x]) * 4 + r0[x] + r4[x];
            out[x] = ((acc + 128) >> 8) as i16;
        }
    }
    (dst, dw, dh)
}

/// `cv::pyrDown` on CV_32FC1, default dst size, BORDER_REFLECT_101,
/// replicating the NEON build's FMA lane structure (see module notes above).
pub fn pyr_down_f32(src: &[f32], w: usize, h: usize) -> (Vec<f32>, usize, usize) {
    assert_eq!(src.len(), w * h);
    assert!(w >= 1 && h >= 1);
    let dw = w.div_ceil(2);
    let dh = h.div_ceil(2);
    let width0 = pyr_down_width0(w, dw);
    // Elements [1, 1 + n_h) of each row take the PyrDownVecH<float,float,1>
    // path (pyramids.cpp:399-416): fma(a, 6, fma(b+c, 4, d+e)).
    let n_h = if width0 >= 1 {
        ((width0 - 1) / SIMD_F32_LANES) * SIMD_F32_LANES
    } else {
        0
    };

    let mut rows = vec![0f32; h * dw];
    for sy in 0..h {
        let s = &src[sy * w..(sy + 1) * w];
        let row = &mut rows[sy * dw..(sy + 1) * dw];
        for x in 0..dw {
            let cols = pyr_down_cols(x, w, width0);
            let (d, b, a, c, e) = (s[cols[0]], s[cols[1]], s[cols[2]], s[cols[3]], s[cols[4]]);
            row[x] = if x >= 1 && x < 1 + n_h {
                // PyrDownVecH<float,float,1>: fma(a, 6, fma(b+c, 4, d+e)).
                a.mul_add(6.0, (b + c).mul_add(4.0, d + e))
            } else {
                // Scalar tabL/tail/tabR expression as clang contracts it:
                // fma(a, 6, (b+c)*4) + d + e.
                a.mul_add(6.0, (b + c) * 4.0) + d + e
            };
        }
    }

    // Vertical: elements [0, n_v) take PyrDownVecV<float,float>
    // (pyramids.cpp:571-591): fma((r1+r3)+r2, 4, (r0+r4)+2*r2) * 1/256;
    // the tail is the scalar FltCast<float, 8> expression.
    const SCALE: f32 = 1.0 / 256.0;
    let n_v = (dw / SIMD_F32_LANES) * SIMD_F32_LANES;
    let mut dst = vec![0f32; dw * dh];
    for y in 0..dh {
        let r = |k: usize| -> &[f32] {
            let sy = border_interpolate_reflect(2 * y as i32 + k as i32 - 2, h as i32, 1) as usize;
            &rows[sy * dw..(sy + 1) * dw]
        };
        let (r0, r1, r2, r3, r4) = (r(0), r(1), r(2), r(3), r(4));
        let out = &mut dst[y * dw..(y + 1) * dw];
        for x in 0..dw {
            out[x] = if x < n_v {
                ((r1[x] + r3[x]) + r2[x]).mul_add(4.0, (r0[x] + r4[x]) + (r2[x] + r2[x])) * SCALE
            } else {
                // Scalar tail as clang contracts it: fma(r2, 6, (r1+r3)*4).
                (r2[x].mul_add(6.0, (r1[x] + r3[x]) * 4.0) + r0[x] + r4[x]) * SCALE
            };
        }
    }
    (dst, dw, dh)
}

/// `cv::pyrUp` on CV_16SC3 to an explicit dst size (`pyrUp_<FixPtCast<short,
/// 6>>`, pyramids.cpp:1115-1230). `dw`/`dh` must satisfy OpenCV's
/// `|d - 2s| == d % 2` constraint.
pub fn pyr_up_i16c3(src: &[i16], w: usize, h: usize, dw: usize, dh: usize) -> Vec<i16> {
    const CN: usize = 3;
    assert_eq!(src.len(), w * h * CN);
    assert!(w >= 1 && h >= 1);
    assert_eq!((dw as i32 - 2 * w as i32).abs(), (dw % 2) as i32);
    assert_eq!((dh as i32 - 2 * h as i32).abs(), (dh % 2) as i32);
    assert!(
        !(w == 1 && dw > 2),
        "pyrUp 1 -> 3 columns reads uninitialized memory in OpenCV; unsupported"
    );
    let dwc = dw * CN;

    // Horizontal zero-stuffed convolution of each source row. Row buffers
    // carry `dwc + CN` entries: odd `dw = 2w - 1` writes one pixel past the
    // used width (bufstep slack in OpenCV), read back only for even columns.
    let stride = dwc + CN;
    let mut rows = vec![0i32; h * stride];
    for sy in 0..h {
        let s = &src[sy * w * CN..(sy + 1) * w * CN];
        let row = &mut rows[sy * stride..(sy + 1) * stride];
        if w == 1 {
            for c in 0..CN {
                row[c] = s[c] as i32 * 8;
                row[CN + c] = row[c];
            }
            continue;
        }
        for c in 0..CN {
            // Left edge (dtab[0]): 6a+2b / 4(a+b).
            row[c] = s[c] as i32 * 6 + s[CN + c] as i32 * 2;
            row[CN + c] = (s[c] as i32 + s[CN + c] as i32) * 4;
            // Right edge (dtab[w-1]): z+7y / 8y (pyramids.cpp:1170-1179).
            let dx = (w - 1) * 2 * CN;
            let sx = (w - 1) * CN;
            row[dx + c] = s[sx - CN + c] as i32 + s[sx + c] as i32 * 7;
            row[dx + CN + c] = s[sx + c] as i32 * 8;
            if dw > w * 2 {
                row[(dw - 1) * CN + c] = row[dx + CN + c];
            }
        }
        for x in 1..w - 1 {
            for c in 0..CN {
                let sxc = x * CN + c;
                row[x * 2 * CN + c] = s[sxc - CN] as i32 + s[sxc] as i32 * 6 + s[sxc + CN] as i32;
                row[x * 2 * CN + CN + c] = (s[sxc] as i32 + s[sxc + CN] as i32) * 4;
            }
        }
    }

    // Vertical: rows sy-1, sy, sy+1 with `borderInterpolate(2*sy, 2*h,
    // REFLECT_101)/2`, FixPtCast<short, 6>.
    let bi_row =
        |sy: i32| -> usize { (border_interpolate_reflect(sy * 2, (h * 2) as i32, 1) / 2) as usize };
    let mut dst = vec![0i16; dwc * dh];
    for y in 0..h {
        let y0 = y * 2;
        let y1 = usize::min(y * 2 + 1, dh - 1);
        let r0 = &rows[bi_row(y as i32 - 1) * stride..];
        let r1 = &rows[bi_row(y as i32) * stride..];
        let r2 = &rows[bi_row(y as i32 + 1) * stride..];
        if y0 != y1 {
            for x in 0..dwc {
                dst[y1 * dwc + x] = (((r1[x] + r2[x]) * 4 + 32) >> 6) as i16;
                dst[y0 * dwc + x] = ((r0[x] + r1[x] * 6 + r2[x] + 32) >> 6) as i16;
            }
        } else {
            for x in 0..dwc {
                dst[y0 * dwc + x] = ((r0[x] + r1[x] * 6 + r2[x] + 32) >> 6) as i16;
            }
        }
    }
    if dh > h * 2 {
        let (head, tail) = dst.split_at_mut(h * 2 * dwc);
        tail[..dwc].copy_from_slice(&head[(h * 2 - 2) * dwc..(h * 2 - 1) * dwc]);
    }
    dst
}

// ======================== MultiBandBlender ========================

/// CV_16SC3 plane (interleaved).
struct PlaneI16 {
    w: usize,
    h: usize,
    data: Vec<i16>,
}

/// CV_32FC1 plane.
struct PlaneF32 {
    w: usize,
    h: usize,
    data: Vec<f32>,
}

/// Band count the Stitcher pipeline uses for a panorama of the given final
/// size (oracle.py stage 6 / samples/cpp/stitching_detailed.cpp with
/// `blend_strength = 5`):
/// `blend_width = sqrt(w*h) * 5 / 100`,
/// `num_bands = max(1, ceil(log2(blend_width)) - 1)`.
/// (The `Stitcher` *class* would always use 5; PanoLoom follows its oracle.)
pub fn num_bands_for(dst_w: usize, dst_h: usize) -> usize {
    let blend_width = ((dst_w * dst_h) as f64).sqrt() * 5.0 / 100.0;
    let nb = (blend_width.ln() / 2f64.ln()).ceil() as i64 - 1;
    nb.max(1) as usize
}

/// `cv::detail::MultiBandBlender` (blenders.cpp:216-693), CPU path with the
/// Stitcher defaults: `try_gpu = false`, `weight_type = CV_32F`
/// (blenders.hpp:130). The CV_16S weight path is dead by default and not
/// ported.
pub struct MultiBandBlender {
    actual_num_bands: usize,
    num_bands: usize,
    /// Padded ROI (`dst_roi_` after rounding w/h up to multiples of
    /// `2^num_bands`).
    dst_roi: (i32, i32, usize, usize),
    /// ROI as passed to `prepare` (`dst_roi_final_`).
    dst_roi_final: (i32, i32, usize, usize),
    dst_pyr_laplace: Vec<PlaneI16>,
    dst_band_weights: Vec<PlaneF32>,
}

impl MultiBandBlender {
    /// `MultiBandBlender(false, num_bands, CV_32F)`. The Stitcher default is
    /// `new(5)`; the pipeline computes the count via [`num_bands_for`].
    pub fn new(num_bands: usize) -> Self {
        Self {
            actual_num_bands: num_bands,
            num_bands: 0,
            dst_roi: (0, 0, 0, 0),
            dst_roi_final: (0, 0, 0, 0),
            dst_pyr_laplace: Vec::new(),
            dst_band_weights: Vec::new(),
        }
    }

    /// `MultiBandBlender::prepare(Rect)` (blenders.cpp:233-300): crop the
    /// band count to `ceil(log2(max(w, h)))`, pad the ROI up to multiples of
    /// `2^num_bands`, allocate the zeroed dst Laplacian pyramid and band
    /// weights (level k+1 size = `(size_k + 1) / 2`).
    pub fn prepare(&mut self, x: i32, y: i32, w: usize, h: usize) {
        assert!(w >= 1 && h >= 1);
        self.dst_roi_final = (x, y, w, h);
        let max_len = usize::max(w, h) as f64;
        self.num_bands = usize::min(
            self.actual_num_bands,
            (max_len.ln() / 2f64.ln()).ceil() as usize,
        );
        let step = 1usize << self.num_bands;
        let w_pad = w + (step - w % step) % step;
        let h_pad = h + (step - h % step) % step;
        self.dst_roi = (x, y, w_pad, h_pad);

        self.dst_pyr_laplace.clear();
        self.dst_band_weights.clear();
        let (mut lw, mut lh) = (w_pad, h_pad);
        for i in 0..=self.num_bands {
            if i > 0 {
                lw = lw.div_ceil(2);
                lh = lh.div_ceil(2);
            }
            self.dst_pyr_laplace.push(PlaneI16 {
                w: lw,
                h: lh,
                data: vec![0; lw * lh * 3],
            });
            self.dst_band_weights.push(PlaneF32 {
                w: lw,
                h: lh,
                data: vec![0.0; lw * lh],
            });
        }
    }

    /// `MultiBandBlender::feed` CPU path (blenders.cpp:328-601). `img_rgb_u8`
    /// is converted to CV_16S exactly like the compose loop's
    /// `convertTo(CV_16S)`; `tl` is the image corner in panorama coordinates.
    /// The image rectangle must lie inside the `prepare`d ROI.
    pub fn feed(
        &mut self,
        img_rgb_u8: &[u8],
        w: usize,
        h: usize,
        mask: &GrayImage,
        tl: (i32, i32),
    ) {
        assert!(!self.dst_pyr_laplace.is_empty(), "prepare() not called");
        assert_eq!(img_rgb_u8.len(), w * h * 3);
        assert_eq!((mask.width, mask.height), (w, h));
        let nb = self.num_bands;
        let one = 1i32 << nb;
        let gap = 3 * one;
        let (rx, ry, rw, rh) = self.dst_roi;
        let roi_br = (rx + rw as i32, ry + rh as i32);

        // Rectangle around the image: expanded by `gap`, clamped to the ROI,
        // snapped so tl offset and size are multiples of 2^num_bands
        // (blenders.cpp:369-391).
        let mut tl_new = (i32::max(rx, tl.0 - gap), i32::max(ry, tl.1 - gap));
        let mut br_new = (
            i32::min(roi_br.0, tl.0 + w as i32 + gap),
            i32::min(roi_br.1, tl.1 + h as i32 + gap),
        );
        tl_new.0 = rx + (((tl_new.0 - rx) >> nb) << nb);
        tl_new.1 = ry + (((tl_new.1 - ry) >> nb) << nb);
        let mut width = br_new.0 - tl_new.0;
        let mut height = br_new.1 - tl_new.1;
        width += (one - width % one) % one;
        height += (one - height % one) % one;
        br_new.0 = tl_new.0 + width;
        br_new.1 = tl_new.1 + height;
        let ddy = i32::max(br_new.1 - roi_br.1, 0);
        let ddx = i32::max(br_new.0 - roi_br.0, 0);
        tl_new.0 -= ddx;
        br_new.0 -= ddx;
        tl_new.1 -= ddy;
        br_new.1 -= ddy;

        let top = tl.1 - tl_new.1;
        let left = tl.0 - tl_new.0;
        let bottom = br_new.1 - tl.1 - h as i32;
        let right = br_new.0 - tl.0 - w as i32;
        assert!(
            top >= 0 && left >= 0 && bottom >= 0 && right >= 0,
            "image rectangle must lie inside the prepared ROI"
        );

        // copyMakeBorder(img, BORDER_REFLECT) on the CV_16S image.
        let bw = (br_new.0 - tl_new.0) as usize;
        let bh = (br_new.1 - tl_new.1) as usize;
        let mut bordered = vec![0i16; bw * bh * 3];
        for yy in 0..bh {
            let sy = border_interpolate_reflect(yy as i32 - top, h as i32, 0) as usize;
            for xx in 0..bw {
                let sx = border_interpolate_reflect(xx as i32 - left, w as i32, 0) as usize;
                let si = (sy * w + sx) * 3;
                let di = (yy * bw + xx) * 3;
                for c in 0..3 {
                    bordered[di + c] = img_rgb_u8[si + c] as i16;
                }
            }
        }

        // createLaplacePyr, CV_16S branch (blenders.cpp:825-836): pyrDown
        // chain, then level_i -= pyrUp(level_{i+1}) (cv::subtract saturates).
        let mut src_pyr: Vec<PlaneI16> = Vec::with_capacity(nb + 1);
        src_pyr.push(PlaneI16 {
            w: bw,
            h: bh,
            data: bordered,
        });
        for i in 0..nb {
            let (data, pw, ph) = pyr_down_i16c3(&src_pyr[i].data, src_pyr[i].w, src_pyr[i].h);
            src_pyr.push(PlaneI16 { w: pw, h: ph, data });
        }
        for i in 0..nb {
            let up = pyr_up_i16c3(
                &src_pyr[i + 1].data,
                src_pyr[i + 1].w,
                src_pyr[i + 1].h,
                src_pyr[i].w,
                src_pyr[i].h,
            );
            for (d, u) in src_pyr[i].data.iter_mut().zip(&up) {
                *d = d.saturating_sub(*u);
            }
        }

        // Weight Gaussian pyramid: mask.convertTo(CV_32F, 1./255.) (the
        // conversion is done in f32, blenders.cpp:513), zero-padded to the
        // bordered rectangle (BORDER_CONSTANT), then a pyrDown chain.
        const MASK_SCALE: f32 = (1.0f64 / 255.0) as f32;
        let mut wt0 = vec![0f32; bw * bh];
        for yy in 0..h {
            for xx in 0..w {
                wt0[(yy + top as usize) * bw + (xx + left as usize)] =
                    mask.data[yy * w + xx] as f32 * MASK_SCALE;
            }
        }
        let mut weight_pyr: Vec<PlaneF32> = Vec::with_capacity(nb + 1);
        weight_pyr.push(PlaneF32 {
            w: bw,
            h: bh,
            data: wt0,
        });
        for i in 0..nb {
            let (data, pw, ph) =
                pyr_down_f32(&weight_pyr[i].data, weight_pyr[i].w, weight_pyr[i].h);
            weight_pyr.push(PlaneF32 { w: pw, h: ph, data });
        }

        // Accumulate the weighted bands into the dst pyramid over the snapped
        // rectangle, halving it per level (blenders.cpp:533-598, CV_32F
        // branch). `static_cast<short>` truncates toward zero; the +=
        // wraps like the C++ short addition.
        let mut x_tl = (tl_new.0 - rx) as usize;
        let mut y_tl = (tl_new.1 - ry) as usize;
        let mut x_br = (br_new.0 - rx) as usize;
        let mut y_br = (br_new.1 - ry) as usize;
        for i in 0..=nb {
            let (rc_w, rc_h) = (x_br - x_tl, y_br - y_tl);
            let sp = &src_pyr[i];
            let wp = &weight_pyr[i];
            debug_assert_eq!((sp.w, sp.h), (rc_w, rc_h));
            debug_assert_eq!((wp.w, wp.h), (rc_w, rc_h));
            let dp = &mut self.dst_pyr_laplace[i];
            let dwt = &mut self.dst_band_weights[i];
            for y in 0..rc_h {
                for x in 0..rc_w {
                    let wv = wp.data[y * wp.w + x];
                    let si = (y * sp.w + x) * 3;
                    let di = ((y_tl + y) * dp.w + (x_tl + x)) * 3;
                    for c in 0..3 {
                        dp.data[di + c] =
                            dp.data[di + c].wrapping_add((sp.data[si + c] as f32 * wv) as i16);
                    }
                    dwt.data[(y_tl + y) * dwt.w + (x_tl + x)] += wv;
                }
            }
            x_tl /= 2;
            y_tl /= 2;
            x_br /= 2;
            y_br /= 2;
        }
    }

    /// `MultiBandBlender::blend` + `Blender::blend` (blenders.cpp:604-693),
    /// returning the raw CV_16SC3 result cropped to the `prepare`d ROI plus
    /// the coverage mask (`dst_band_weights[0] > WEIGHT_EPS`).
    pub fn blend_i16(mut self) -> (Vec<i16>, GrayImage) {
        assert!(!self.dst_pyr_laplace.is_empty(), "prepare() not called");
        let nb = self.num_bands;

        // normalizeUsingWeightMap, CV_32F branch (blenders.cpp:735-749):
        // v = short(v / (w + WEIGHT_EPS)) — truncation toward zero.
        for i in 0..=nb {
            let wp = &self.dst_band_weights[i];
            let dp = &mut self.dst_pyr_laplace[i];
            for j in 0..wp.w * wp.h {
                let denom = wp.data[j] + WEIGHT_EPS;
                for c in 0..3 {
                    dp.data[j * 3 + c] = (dp.data[j * 3 + c] as f32 / denom) as i16;
                }
            }
        }

        // restoreImageFromLaplacePyr (blenders.cpp:868-878): top-down
        // pyrUp + cv::add (saturating).
        for i in (1..=nb).rev() {
            let up = pyr_up_i16c3(
                &self.dst_pyr_laplace[i].data,
                self.dst_pyr_laplace[i].w,
                self.dst_pyr_laplace[i].h,
                self.dst_pyr_laplace[i - 1].w,
                self.dst_pyr_laplace[i - 1].h,
            );
            for (d, u) in self.dst_pyr_laplace[i - 1].data.iter_mut().zip(&up) {
                *d = d.saturating_add(*u);
            }
        }

        // Crop to dst_roi_final_, mask = weights[0] > WEIGHT_EPS, zero
        // uncovered pixels (Blender::blend).
        let (_, _, fw, fh) = self.dst_roi_final;
        let l0 = &self.dst_pyr_laplace[0];
        let w0 = &self.dst_band_weights[0];
        let mut out = vec![0i16; fw * fh * 3];
        let mut mask = vec![0u8; fw * fh];
        for y in 0..fh {
            for x in 0..fw {
                if w0.data[y * w0.w + x] > WEIGHT_EPS {
                    mask[y * fw + x] = 255;
                    let (si, di) = ((y * l0.w + x) * 3, (y * fw + x) * 3);
                    out[di..di + 3].copy_from_slice(&l0.data[si..si + 3]);
                }
            }
        }
        (out, GrayImage::new(fw, fh, mask))
    }

    /// [`Self::blend_i16`] followed by the pipeline's `convertTo(CV_8U)`
    /// saturation, as the Stitcher compose loop does.
    pub fn blend(self) -> (Vec<u8>, GrayImage) {
        let (raw, mask) = self.blend_i16();
        let out = raw.iter().map(|&v| v.clamp(0, 255) as u8).collect();
        (out, mask)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_transform_simple() {
        // 5x1 mask: 0 255 255 255 0 -> distances 0 1 2 1 0.
        let mask = GrayImage::new(5, 1, vec![0, 255, 255, 255, 0]);
        let d = distance_transform_l1(&mask);
        assert_eq!(d, vec![0.0, 1.0, 2.0, 1.0, 0.0]);
    }

    #[test]
    fn feather_blend_two_overlapping() {
        // Two 4x1 images overlapping by 2px; constant colors 100 and 200.
        let mask = GrayImage::new(4, 1, vec![255; 4]);
        let mut b = FeatherBlender::new(1.0);
        b.prepare(0, 0, 6, 1);
        b.feed(&[100u8; 12], 4, 1, &mask, (0, 0));
        b.feed(&[200u8; 12], 4, 1, &mask, (2, 0));
        let (out, cov) = b.blend();
        assert!(cov.data.iter().all(|&m| m == 255));
        // Left edge ~100, right edge ~200 — MINUS one: OpenCV divides by
        // (weight + 1e-5) and truncates via static_cast<short>, so solo
        // pixels lose one LSB. Faithfully ported.
        assert_eq!(out[0], 99);
        assert_eq!(out[5 * 3], 199);
        let mid = out[2 * 3 + 1];
        assert!(mid > 100 && mid < 200, "overlap should mix: {mid}");
    }

    #[test]
    fn result_roi_union() {
        let roi = result_roi(&[(-5, 2), (10, -3)], &[(20, 10), (5, 8)]);
        assert_eq!(roi, (-5, -3, 20, 15));
    }
}
