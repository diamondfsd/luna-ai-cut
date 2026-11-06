//! Grayscale image ops ported from OpenCV imgproc: color conversion, bilinear
//! resize, separable Gaussian blur. See docs/pipeline.md for parity notes.

use crate::cvmath::cv_round_f32;

/// Single-channel u8 image, tightly packed.
#[derive(Debug, Clone)]
pub struct GrayImage {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl GrayImage {
    pub fn new(width: usize, height: usize, data: Vec<u8>) -> Self {
        assert_eq!(data.len(), width * height);
        Self {
            width,
            height,
            data,
        }
    }

    #[inline]
    pub fn at(&self, x: usize, y: usize) -> u8 {
        self.data[y * self.width + x]
    }

    #[inline]
    pub fn row(&self, y: usize) -> &[u8] {
        &self.data[y * self.width..(y + 1) * self.width]
    }
}

/// OpenCV `COLOR_RGBA2GRAY`/`COLOR_RGB2GRAY` fixed-point conversion:
/// gray = (R*4899 + G*9617 + B*1868 + (1<<13)) >> 14
/// (cvtColor's exact integer path; matches cv2 byte-for-byte).
pub fn rgba_to_gray_cv(rgba: &[u8], width: usize, height: usize) -> GrayImage {
    const R2Y: u32 = 4899;
    const G2Y: u32 = 9617;
    const B2Y: u32 = 1868;
    let data = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .map(|px| {
            let v = R2Y * px[0] as u32 + G2Y * px[1] as u32 + B2Y * px[2] as u32 + (1 << 13);
            (v >> 14) as u8
        })
        .collect();
    GrayImage::new(width, height, data)
}

/// Same fixed-point luma for 3-channel RGB input.
pub fn rgb_to_gray_cv(rgb: &[u8], width: usize, height: usize) -> GrayImage {
    const R2Y: u32 = 4899;
    const G2Y: u32 = 9617;
    const B2Y: u32 = 1868;
    let data = rgb
        .as_chunks::<3>()
        .0
        .iter()
        .map(|px| {
            let v = R2Y * px[0] as u32 + G2Y * px[1] as u32 + B2Y * px[2] as u32 + (1 << 13);
            (v >> 14) as u8
        })
        .collect();
    GrayImage::new(width, height, data)
}

/// Bilinear resize with OpenCV's pixel-center coordinate mapping.
///
/// NOTE: ORB's pyramid uses `INTER_LINEAR_EXACT` (fixed-point, bit-exact).
/// This is the f32 approximation — output can differ from OpenCV by ±1 LSB
/// on some pixels. Parity gates at the match level absorb that; if they
/// don't, this is the first place to upgrade (ufixedpoint16 port).
pub fn resize_bilinear(src: &GrayImage, dst_w: usize, dst_h: usize) -> GrayImage {
    assert!(dst_w > 0 && dst_h > 0);
    let scale_x = src.width as f64 / dst_w as f64;
    let scale_y = src.height as f64 / dst_h as f64;
    let mut data = vec![0u8; dst_w * dst_h];

    for dy in 0..dst_h {
        let sy = (dy as f64 + 0.5) * scale_y - 0.5;
        let y0 = sy.floor() as isize;
        let fy = (sy - y0 as f64) as f32;
        let y0c = y0.clamp(0, src.height as isize - 1) as usize;
        let y1c = (y0 + 1).clamp(0, src.height as isize - 1) as usize;

        for dx in 0..dst_w {
            let sx = (dx as f64 + 0.5) * scale_x - 0.5;
            let x0 = sx.floor() as isize;
            let fx = (sx - x0 as f64) as f32;
            let x0c = x0.clamp(0, src.width as isize - 1) as usize;
            let x1c = (x0 + 1).clamp(0, src.width as isize - 1) as usize;

            let p00 = src.at(x0c, y0c) as f32;
            let p01 = src.at(x1c, y0c) as f32;
            let p10 = src.at(x0c, y1c) as f32;
            let p11 = src.at(x1c, y1c) as f32;
            let top = p00 + (p01 - p00) * fx;
            let bot = p10 + (p11 - p10) * fx;
            let v = top + (bot - top) * fy;
            data[dy * dst_w + dx] = cv_round_f32(v).clamp(0, 255) as u8;
        }
    }
    GrayImage::new(dst_w, dst_h, data)
}

/// Row-range variant of [`resize_bilinear`]: computes only rows `[y0, y1)`
/// of the virtual `dst_w x dst_h` result (banded compositing primitive).
pub fn resize_bilinear_rows(
    src: &GrayImage,
    dst_w: usize,
    dst_h: usize,
    y0: usize,
    y1: usize,
) -> GrayImage {
    assert!(dst_w > 0 && dst_h > 0 && y1 <= dst_h && y0 <= y1);
    let scale_x = src.width as f64 / dst_w as f64;
    let scale_y = src.height as f64 / dst_h as f64;
    let rows = y1 - y0;
    let mut data = vec![0u8; dst_w * rows];

    for (row, dy) in (y0..y1).enumerate() {
        let sy = (dy as f64 + 0.5) * scale_y - 0.5;
        let ys = sy.floor() as isize;
        let fy = (sy - ys as f64) as f32;
        let y0c = ys.clamp(0, src.height as isize - 1) as usize;
        let y1c = (ys + 1).clamp(0, src.height as isize - 1) as usize;
        for dx in 0..dst_w {
            let sx = (dx as f64 + 0.5) * scale_x - 0.5;
            let xs = sx.floor() as isize;
            let fx = (sx - xs as f64) as f32;
            let x0c = xs.clamp(0, src.width as isize - 1) as usize;
            let x1c = (xs + 1).clamp(0, src.width as isize - 1) as usize;

            let p00 = src.at(x0c, y0c) as f32;
            let p01 = src.at(x1c, y0c) as f32;
            let p10 = src.at(x0c, y1c) as f32;
            let p11 = src.at(x1c, y1c) as f32;
            let top = p00 + (p01 - p00) * fx;
            let bot = p10 + (p11 - p10) * fx;
            let v = top + (bot - top) * fy;
            data[row * dst_w + dx] = cv_round_f32(v).clamp(0, 255) as u8;
        }
    }
    GrayImage::new(dst_w, rows, data)
}

/// `getGaussianKernel(7, 2.0)` computed in f64 exactly like OpenCV, cast to
/// f32 (createGaussianKernels uses a CV_32F kernel for 8-bit images).
fn gaussian_kernel_7_sigma2() -> [f32; 7] {
    let sigma = 2.0f64;
    let scale2x = -0.5 / (sigma * sigma);
    let mut k = [0f64; 7];
    let mut sum = 0.0;
    for (i, v) in k.iter_mut().enumerate() {
        let x = i as f64 - 3.0;
        *v = (scale2x * x * x).exp();
        sum += *v;
    }
    let mut out = [0f32; 7];
    for i in 0..7 {
        out[i] = (k[i] / sum) as f32;
    }
    out
}

#[inline]
fn reflect101(idx: isize, len: usize) -> usize {
    // BORDER_REFLECT_101: gfedcb|abcdefgh|gfedcba (no edge duplication).
    let len = len as isize;
    let mut i = idx;
    while i < 0 || i >= len {
        if i < 0 {
            i = -i;
        }
        if i >= len {
            i = 2 * (len - 1) - i;
        }
    }
    i as usize
}

/// GaussianBlur(7x7, sigma=2, BORDER_REFLECT_101) — separable, f32
/// accumulation, cvRound to u8 (OpenCV's 8U filter path).
pub fn gaussian_blur_7_sigma2(src: &GrayImage) -> GrayImage {
    let kernel = gaussian_kernel_7_sigma2();
    let (w, h) = (src.width, src.height);
    let mut tmp = vec![0f32; w * h];

    // Horizontal pass.
    for y in 0..h {
        let row = src.row(y);
        for x in 0..w {
            let mut acc = 0f32;
            for (t, kv) in kernel.iter().enumerate() {
                let sx = reflect101(x as isize + t as isize - 3, w);
                acc += row[sx] as f32 * kv;
            }
            tmp[y * w + x] = acc;
        }
    }
    // Vertical pass.
    let mut data = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut acc = 0f32;
            for (t, kv) in kernel.iter().enumerate() {
                let sy = reflect101(y as isize + t as isize - 3, h);
                acc += tmp[sy * w + x] * kv;
            }
            data[y * w + x] = cv_round_f32(acc).clamp(0, 255) as u8;
        }
    }
    GrayImage::new(w, h, data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gray_matches_cv2_fixed_point() {
        // cv2 reference (BGR2GRAY on [[10,200,50],[255,0,0],[0,0,255],[123,45,67]])
        // = [133, 29, 76, 60]; our input is RGB so channels are reversed.
        let rgb = [50, 200, 10, 0, 0, 255, 255, 0, 0, 67, 45, 123];
        let gray = rgb_to_gray_cv(&rgb, 4, 1);
        assert_eq!(gray.data, vec![133, 29, 76, 60]);
    }

    #[test]
    fn resize_close_to_inter_linear_exact() {
        // cv2.resize(..., INTER_LINEAR_EXACT) references; f32 path must be
        // within 1 LSB of the fixed-point result.
        let src = GrayImage::new(5, 5, (0..25u8).map(|v| v * 10).collect());
        let expected3: [u8; 9] = [20, 37, 53, 103, 120, 137, 187, 203, 220];
        let got3 = resize_bilinear(&src, 3, 3);
        for (g, e) in got3.data.iter().zip(expected3) {
            assert!((*g as i32 - e as i32).abs() <= 1, "{got3:?}");
        }
        let expected4: [u8; 16] = [
            8, 20, 33, 45, 70, 83, 95, 108, 133, 145, 158, 170, 195, 208, 220, 233,
        ];
        let got4 = resize_bilinear(&src, 4, 4);
        for (g, e) in got4.data.iter().zip(expected4) {
            assert!((*g as i32 - e as i32).abs() <= 1, "{got4:?}");
        }
    }

    #[test]
    fn gaussian_kernel_matches_cv2() {
        let k = gaussian_kernel_7_sigma2();
        let expected = [
            0.07015932351350784,
            0.13107487559318542,
            0.1907128244638443,
            0.21610593795776367,
            0.1907128244638443,
            0.13107487559318542,
            0.07015932351350784,
        ];
        for (a, b) in k.iter().zip(expected) {
            assert!((a - b as f32).abs() < 1e-9, "{k:?}");
        }
    }

    #[test]
    fn reflect101_border() {
        assert_eq!(reflect101(-1, 5), 1);
        assert_eq!(reflect101(-2, 5), 2);
        assert_eq!(reflect101(5, 5), 3);
        assert_eq!(reflect101(6, 5), 2);
        assert_eq!(reflect101(2, 5), 2);
    }
}
