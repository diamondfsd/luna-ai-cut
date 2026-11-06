//! Spherical rotation warper — port of `cv::detail::SphericalWarper`
//! (`RotationWarperBase<SphericalProjector>`, warpers.cpp + warpers_inl.hpp).
//!
//! All projector math is f32 with `atan2f/acosf` and the NaN guard, ROI
//! corners use `static_cast<int>` truncation toward zero, and maps span
//! `br - tl + 1` pixels inclusive — exactly like OpenCV (docs/pipeline.md §8).

#![allow(clippy::needless_range_loop)]

use crate::cvmath::cv_round_f32;
use crate::imgproc::GrayImage;

/// Interleaved u8 image with `channels` components per pixel (1 or 3).
#[derive(Debug, Clone)]
pub struct PixelImage {
    pub width: usize,
    pub height: usize,
    pub channels: usize,
    pub data: Vec<u8>,
}

impl PixelImage {
    pub fn new(width: usize, height: usize, channels: usize, data: Vec<u8>) -> Self {
        assert_eq!(data.len(), width * height * channels);
        Self {
            width,
            height,
            channels,
            data,
        }
    }

    pub fn from_gray(g: &GrayImage) -> Self {
        Self::new(g.width, g.height, 1, g.data.clone())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Border {
    /// `BORDER_REFLECT`: fedcba|abcdefgh|hgfedcb (edge duplicated).
    Reflect,
    /// `BORDER_CONSTANT` with value 0.
    Constant0,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interp {
    Linear,
    Nearest,
}

type Mat3f = [[f32; 3]; 3];

/// `ProjectorBase` state: scale plus the four derived 3x3s (f32, flattened
/// row-major like OpenCV's arrays).
pub struct SphericalWarper {
    pub scale: f32,
    k: [f32; 9],
    rinv: [f32; 9],
    r_kinv: [f32; 9],
    k_rinv: [f32; 9],
    /// Lens distortion applied in SOURCE pixel space; None = pure pinhole
    /// (the bit-exact OpenCV-parity path).
    lens: Option<(crate::lens::LensParams, f64, f64, f64, f64)>, // (params, cx, cy, w, h)
}

fn mul3f(a: &Mat3f, b: &Mat3f) -> Mat3f {
    let mut o = [[0.0f32; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            // f32 accumulation, like Mat_<float> gemm.
            let mut acc = 0.0f32;
            for k in 0..3 {
                acc += a[r][k] * b[k][c];
            }
            o[r][c] = acc;
        }
    }
    o
}

fn flat(m: &Mat3f) -> [f32; 9] {
    [
        m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2],
    ]
}

impl SphericalWarper {
    pub fn new(scale: f32) -> Self {
        Self {
            scale,
            k: [0.0; 9],
            rinv: [0.0; 9],
            r_kinv: [0.0; 9],
            k_rinv: [0.0; 9],
            lens: None,
        }
    }

    /// Enables lens distortion for subsequent warps of a `w` x `h` source
    /// whose principal point is (cx, cy). Zero params disable it (keeps
    /// the exact pinhole sampling path).
    pub fn set_lens(&mut self, params: crate::lens::LensParams, cx: f64, cy: f64, w: f64, h: f64) {
        self.lens = (!params.is_zero()).then_some((params, cx, cy, w, h));
    }

    /// Ideal pinhole pixel -> actual (distorted) source pixel.
    #[inline]
    pub fn to_source_px(&self, x: f32, y: f32) -> (f32, f32) {
        match &self.lens {
            None => (x, y),
            Some((p, cx, cy, w, h)) => {
                let (dx, dy) = p.distort(x as f64, y as f64, *cx, *cy, *w, *h);
                (dx as f32, dy as f32)
            }
        }
    }

    /// Actual (distorted) source pixel -> ideal pinhole pixel.
    #[inline]
    pub fn to_ideal_px(&self, x: f32, y: f32) -> (f32, f32) {
        match &self.lens {
            None => (x, y),
            Some((p, cx, cy, w, h)) => {
                let (ux, uy) = p.undistort(x as f64, y as f64, *cx, *cy, *w, *h);
                (ux as f32, uy as f32)
            }
        }
    }

    /// `ProjectorBase::setCameraParams` (warpers.cpp:128-158), T = 0.
    /// K and R arrive as CV_32F there; the K inverse is computed here in
    /// f64 and cast (OpenCV's f32 LU differs below the f32 noise floor).
    pub fn set_camera(&mut self, k: &Mat3f, r: &Mat3f) {
        let mut rinv = [[0.0f32; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                rinv[i][j] = r[j][i];
            }
        }
        // K is upper triangular: analytic inverse.
        let (fx, skew, cx) = (k[0][0] as f64, k[0][1] as f64, k[0][2] as f64);
        let (fy, cy) = (k[1][1] as f64, k[1][2] as f64);
        let kinv = [
            [
                (1.0 / fx) as f32,
                (-skew / (fx * fy)) as f32,
                ((skew * cy - cx * fy) / (fx * fy)) as f32,
            ],
            [0.0, (1.0 / fy) as f32, (-cy / fy) as f32],
            [0.0, 0.0, 1.0],
        ];
        self.k = flat(k);
        self.rinv = flat(&rinv);
        self.r_kinv = flat(&mul3f(r, &kinv));
        self.k_rinv = flat(&mul3f(k, &rinv));
    }

    /// `SphericalProjector::mapForward` (warpers_inl.hpp:253-262).
    #[inline]
    pub fn map_forward(&self, x: f32, y: f32) -> (f32, f32) {
        let rk = &self.r_kinv;
        let x_ = rk[0] * x + rk[1] * y + rk[2];
        let y_ = rk[3] * x + rk[4] * y + rk[5];
        let z_ = rk[6] * x + rk[7] * y + rk[8];

        let u = self.scale * x_.atan2(z_);
        let w = y_ / (x_ * x_ + y_ * y_ + z_ * z_).sqrt();
        // acosf(w == w ? w : 0) — NaN guard exactly as OpenCV writes it.
        let w = if w.is_nan() { 0.0 } else { w };
        let v = self.scale * (std::f32::consts::PI - w.acos());
        (u, v)
    }

    /// `SphericalProjector::mapBackward` (warpers_inl.hpp:266-283).
    #[inline]
    pub fn map_backward(&self, u: f32, v: f32) -> (f32, f32) {
        let u = u / self.scale;
        let v = v / self.scale;

        let sinv = (std::f32::consts::PI - v).sin();
        let x_ = sinv * u.sin();
        let y_ = (std::f32::consts::PI - v).cos();
        let z_ = sinv * u.cos();

        let kr = &self.k_rinv;
        let x = kr[0] * x_ + kr[1] * y_ + kr[2] * z_;
        let y = kr[3] * x_ + kr[4] * y_ + kr[5] * z_;
        let z = kr[6] * x_ + kr[7] * y_ + kr[8] * z_;

        if z > 0.0 {
            (x / z, y / z)
        } else {
            (-1.0, -1.0)
        }
    }

    /// `detectResultRoiByBorder` + SphericalWarper's pole handling
    /// (warpers_inl.hpp:185-218, warpers.cpp:375-415). Returns (tl, br)
    /// inclusive, truncated toward zero.
    pub fn detect_result_roi(&self, src_w: usize, src_h: usize) -> ((i32, i32), (i32, i32)) {
        let mut tl_uf = f32::MAX;
        let mut tl_vf = f32::MAX;
        let mut br_uf = f32::MIN;
        let mut br_vf = f32::MIN;
        let upd =
            |u: f32, v: f32, tl_uf: &mut f32, tl_vf: &mut f32, br_uf: &mut f32, br_vf: &mut f32| {
                *tl_uf = tl_uf.min(u);
                *tl_vf = tl_vf.min(v);
                *br_uf = br_uf.max(u);
                *br_vf = br_vf.max(v);
            };
        // Border points are ACTUAL image pixels; the forward map wants
        // ideal pinhole coordinates (identity without lens distortion).
        let fwd = |x: f32, y: f32| {
            let (xi, yi) = self.to_ideal_px(x, y);
            self.map_forward(xi, yi)
        };
        for x in 0..src_w {
            let (u, v) = fwd(x as f32, 0.0);
            upd(u, v, &mut tl_uf, &mut tl_vf, &mut br_uf, &mut br_vf);
            let (u, v) = fwd(x as f32, (src_h - 1) as f32);
            upd(u, v, &mut tl_uf, &mut tl_vf, &mut br_uf, &mut br_vf);
        }
        for y in 0..src_h {
            let (u, v) = fwd(0.0, y as f32);
            upd(u, v, &mut tl_uf, &mut tl_vf, &mut br_uf, &mut br_vf);
            let (u, v) = fwd((src_w - 1) as f32, y as f32);
            upd(u, v, &mut tl_uf, &mut tl_vf, &mut br_uf, &mut br_vf);
        }

        // Pole visibility fix-up (warpers.cpp:375-414): if a pole projects
        // inside the source image, the ROI must include its v coordinate.
        for sign in [1.0f32, -1.0] {
            let x = self.rinv[1];
            let y = sign * self.rinv[4];
            let z = self.rinv[7];
            if y > 0.0 {
                let x_ = (self.k[0] * x + self.k[1] * y) / z + self.k[2];
                let y_ = self.k[4] * y / z + self.k[5];
                if x_ > 0.0 && x_ < src_w as f32 && y_ > 0.0 && y_ < src_h as f32 {
                    let pole_v = if sign > 0.0 {
                        std::f32::consts::PI * self.scale
                    } else {
                        0.0
                    };
                    tl_uf = tl_uf.min(0.0);
                    tl_vf = tl_vf.min(pole_v);
                    br_uf = br_uf.max(0.0);
                    br_vf = br_vf.max(pole_v);
                }
            }
        }

        ((tl_uf as i32, tl_vf as i32), (br_uf as i32, br_vf as i32))
    }

    /// `RotationWarperBase::warpRoi`: (tl, size) with size = br - tl + 1.
    pub fn warp_roi(
        &mut self,
        src_w: usize,
        src_h: usize,
        k: &Mat3f,
        r: &Mat3f,
    ) -> (i32, i32, i32, i32) {
        self.set_camera(k, r);
        let (tl, br) = self.detect_result_roi(src_w, src_h);
        (tl.0, tl.1, br.0 - tl.0 + 1, br.1 - tl.1 + 1)
    }

    /// `RotationWarperBase::warp`: backward-map the destination ROI and
    /// remap. Returns (tl, warped image).
    pub fn warp(
        &mut self,
        src: &PixelImage,
        k: &Mat3f,
        r: &Mat3f,
        interp: Interp,
        border: Border,
    ) -> ((i32, i32), PixelImage) {
        self.set_camera(k, r);
        let (tl, br) = self.detect_result_roi(src.width, src.height);
        let dw = (br.0 - tl.0 + 1) as usize;
        let dh = (br.1 - tl.1 + 1) as usize;

        let mut dst = PixelImage::new(dw, dh, src.channels, vec![0u8; dw * dh * src.channels]);
        let this = &*self;
        crate::par::for_each_chunk_mut(&mut dst.data, dw * src.channels, |dv, row| {
            for du in 0..dw {
                let (sx, sy) =
                    this.map_backward((tl.0 + du as i32) as f32, (tl.1 + dv as i32) as f32);
                let (sx, sy) = this.to_source_px(sx, sy);
                sample(
                    src,
                    sx,
                    sy,
                    interp,
                    border,
                    &mut row[du * src.channels..(du + 1) * src.channels],
                );
            }
        });
        ((tl.0, tl.1), dst)
    }

    /// Partial `warp`: renders only ROI rows `[y0, y1)` (relative to the
    /// image's warp ROI) — the streaming primitive for banded compositing.
    /// Returns (roi_tl, rendered rows as an image of height y1-y0).
    #[allow(clippy::too_many_arguments)]
    pub fn warp_rows(
        &mut self,
        src: &PixelImage,
        k: &Mat3f,
        r: &Mat3f,
        interp: Interp,
        border: Border,
        y0: usize,
        y1: usize,
    ) -> ((i32, i32), PixelImage) {
        self.set_camera(k, r);
        let (tl, br) = self.detect_result_roi(src.width, src.height);
        let dw = (br.0 - tl.0 + 1) as usize;
        let dh = (br.1 - tl.1 + 1) as usize;
        let (y0, y1) = (y0.min(dh), y1.min(dh));
        let rows = y1.saturating_sub(y0);

        let mut dst = PixelImage::new(dw, rows, src.channels, vec![0u8; dw * rows * src.channels]);
        let this = &*self;
        crate::par::for_each_chunk_mut(&mut dst.data, dw * src.channels, |out_row, row| {
            let dv = y0 + out_row;
            for du in 0..dw {
                let (sx, sy) =
                    this.map_backward((tl.0 + du as i32) as f32, (tl.1 + dv as i32) as f32);
                let (sx, sy) = this.to_source_px(sx, sy);
                sample(
                    src,
                    sx,
                    sy,
                    interp,
                    border,
                    &mut row[du * src.channels..(du + 1) * src.channels],
                );
            }
        });
        ((tl.0, tl.1), dst)
    }
}

#[inline]
fn border_index(idx: i32, len: usize, border: Border) -> Option<usize> {
    let len = len as i32;
    match border {
        Border::Constant0 => {
            if idx < 0 || idx >= len {
                None
            } else {
                Some(idx as usize)
            }
        }
        Border::Reflect => {
            let mut i = idx;
            // BORDER_REFLECT: fedcba|abcdefgh|hgfedcb
            while i < 0 || i >= len {
                if i < 0 {
                    i = -i - 1;
                }
                if i >= len {
                    i = 2 * len - i - 1;
                }
            }
            Some(i as usize)
        }
    }
}

const INTER_TAB_SIZE: i32 = 32; // 5 fractional bits, like cv::remap
const INTER_REMAP_COEF_SCALE: i32 = 1 << 15;

/// `initInterTab2D(INTER_LINEAR, fixpt=true)` (imgwarp.cpp:156-227) —
/// 1024 blocks of 4 i16 coefficients summing (mostly) to 2^15.
///
/// Ported quirk included: the sum-correction searches min/max over indices
/// (1..3)x(1..3) of a ksize=2 block, which reaches into the NEXT block in
/// the flat array; corrections landing there are overwritten when that
/// block is filled — i.e. positive-diff corrections are silently lost,
/// exactly as in OpenCV.
fn bilinear_tab() -> &'static Vec<[i16; 4]> {
    use std::sync::OnceLock;
    static TAB: OnceLock<Vec<[i16; 4]>> = OnceLock::new();
    TAB.get_or_init(|| {
        let ts = INTER_TAB_SIZE as usize;
        // Flat array with slack to absorb the quirk's tail writes.
        let mut flat = vec![0i16; ts * ts * 4 + 8];
        let tab1d: Vec<f32> = (0..ts)
            .flat_map(|i| {
                let x = i as f32 / ts as f32;
                [1.0 - x, x]
            })
            .collect();
        for i in 0..ts {
            for j in 0..ts {
                let base = (i * ts + j) * 4;
                let mut isum = 0i32;
                for k1 in 0..2usize {
                    let vy = tab1d[i * 2 + k1];
                    for k2 in 0..2usize {
                        let v = vy * tab1d[j * 2 + k2];
                        // saturate_cast<short>(float) rounds ties-to-even.
                        let q = cv_round_f32(v * INTER_REMAP_COEF_SCALE as f32)
                            .clamp(i16::MIN as i32, i16::MAX as i32)
                            as i16;
                        flat[base + k1 * 2 + k2] = q;
                        isum += q as i32;
                    }
                }
                if isum != INTER_REMAP_COEF_SCALE {
                    let diff = isum - INTER_REMAP_COEF_SCALE;
                    // min/max over k1,k2 in {1,2} — indices 3,4,5,6 of the
                    // CURRENT block's base (3 is in-block; 4..6 leak).
                    let (mut mk, mut mk_val) = (3usize, flat[base + 3]);
                    let (mut mx, mut mx_val) = (3usize, flat[base + 3]);
                    for &ofs in &[4usize, 5, 6] {
                        let v = flat[base + ofs];
                        if v < mk_val {
                            mk = ofs;
                            mk_val = v;
                        } else if v > mx_val {
                            mx = ofs;
                            mx_val = v;
                        }
                    }
                    if diff < 0 {
                        flat[base + mx] = (flat[base + mx] as i32 - diff) as i16;
                    } else {
                        flat[base + mk] = (flat[base + mk] as i32 - diff) as i16;
                    }
                }
            }
        }
        (0..ts * ts)
            .map(|b| {
                [
                    flat[b * 4],
                    flat[b * 4 + 1],
                    flat[b * 4 + 2],
                    flat[b * 4 + 3],
                ]
            })
            .collect()
    })
}

#[inline]
fn sample(src: &PixelImage, sx: f32, sy: f32, interp: Interp, border: Border, out: &mut [u8]) {
    let ch = src.channels;

    match interp {
        Interp::Nearest => {
            // remapNearest uses cvRound directly on the f32 map values (no
            // fixed-point conversion) — verified bit-exact vs the oracle.
            let x = cv_round_f32(sx);
            let y = cv_round_f32(sy);
            match (
                border_index(x, src.width, border),
                border_index(y, src.height, border),
            ) {
                (Some(x), Some(y)) => {
                    let p = (y * src.width + x) * ch;
                    out.copy_from_slice(&src.data[p..p + ch]);
                }
                _ => out.fill(0),
            }
        }
        Interp::Linear => {
            // LINEAR quantizes f32 maps to 1/32-pixel fixed point
            // (convertMaps) with the shared coefficient table.
            let sx32 = cv_round_f32(sx * INTER_TAB_SIZE as f32);
            let sy32 = cv_round_f32(sy * INTER_TAB_SIZE as f32);
            let (ix, fx) = (sx32 >> 5, (sx32 & 31) as usize);
            let (iy, fy) = (sy32 >> 5, (sy32 & 31) as usize);
            let coeffs = &bilinear_tab()[fy * INTER_TAB_SIZE as usize + fx];
            let idx = |xi: i32, yi: i32| -> Option<usize> {
                match (
                    border_index(xi, src.width, border),
                    border_index(yi, src.height, border),
                ) {
                    (Some(x), Some(y)) => Some((y * src.width + x) * ch),
                    _ => None,
                }
            };
            let taps = [
                (idx(ix, iy), coeffs[0] as i32),
                (idx(ix + 1, iy), coeffs[1] as i32),
                (idx(ix, iy + 1), coeffs[2] as i32),
                (idx(ix + 1, iy + 1), coeffs[3] as i32),
            ];
            for c in 0..ch {
                let mut acc = 0i32;
                for (p, w) in &taps {
                    if let Some(p) = p {
                        acc += src.data[p + c] as i32 * w;
                    }
                }
                out[c] = ((acc + (1 << 14)) >> 15).clamp(0, 255) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity_setup(scale: f32, f: f32, w: usize, h: usize) -> SphericalWarper {
        let mut warper = SphericalWarper::new(scale);
        let k = [
            [f, 0.0, w as f32 / 2.0],
            [0.0, f, h as f32 / 2.0],
            [0.0, 0.0, 1.0],
        ];
        let r = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        warper.set_camera(&k, &r);
        warper
    }

    #[test]
    fn forward_backward_roundtrip() {
        let warper = identity_setup(500.0, 500.0, 640, 480);
        for &(x, y) in &[(320.0f32, 240.0f32), (10.0, 20.0), (600.0, 400.0)] {
            let (u, v) = warper.map_forward(x, y);
            let (x2, y2) = warper.map_backward(u, v);
            assert!(
                (x - x2).abs() < 0.1 && (y - y2).abs() < 0.1,
                "roundtrip ({x},{y}) -> ({u},{v}) -> ({x2},{y2})"
            );
        }
    }

    #[test]
    fn image_center_maps_forward_to_pano_center() {
        // Identity rotation, principal ray looks at (u, v) = (0, pi*scale/2
        // ... in OpenCV's convention v = scale * (pi - acos(0)) = pi/2*scale.
        let warper = identity_setup(500.0, 500.0, 640, 480);
        let (u, v) = warper.map_forward(320.0, 240.0);
        assert!(u.abs() < 1e-3, "u = {u}");
        assert!(
            (v - 500.0 * std::f32::consts::FRAC_PI_2).abs() < 1e-2,
            "v = {v}"
        );
    }

    #[test]
    fn border_reflect_indexing() {
        assert_eq!(border_index(-1, 5, Border::Reflect), Some(0));
        assert_eq!(border_index(-2, 5, Border::Reflect), Some(1));
        assert_eq!(border_index(5, 5, Border::Reflect), Some(4));
        assert_eq!(border_index(6, 5, Border::Reflect), Some(3));
        assert_eq!(border_index(-1, 5, Border::Constant0), None);
        assert_eq!(border_index(5, 5, Border::Constant0), None);
    }
}
