//! Minimal owned image buffer used at the engine boundary.
//!
//! Pixels arrive from JS as tightly-packed RGBA8 (the layout produced by
//! `ImageData`/`createImageBitmap` readback). Internal stages convert to
//! whatever layout they need.

#[derive(Debug, Clone)]
pub struct RgbaImage {
    pub width: u32,
    pub height: u32,
    /// len == width * height * 4
    pub data: Vec<u8>,
}

impl RgbaImage {
    pub fn new(width: u32, height: u32, data: Vec<u8>) -> Result<Self, String> {
        let expected = width as usize * height as usize * 4;
        if data.len() != expected {
            return Err(format!(
                "RGBA buffer length {} does not match {}x{}x4 = {}",
                data.len(),
                width,
                height,
                expected
            ));
        }
        Ok(Self {
            width,
            height,
            data,
        })
    }

    /// Rec. 601 luma, matching OpenCV's `cvtColor(COLOR_RGBA2GRAY)` coefficients,
    /// so grayscale-based stages stay bit-comparable with the oracle.
    pub fn to_gray(&self) -> Vec<u8> {
        self.data
            .as_chunks::<4>()
            .0
            .iter()
            .map(|px| {
                let (r, g, b) = (px[0] as f32, px[1] as f32, px[2] as f32);
                (0.299 * r + 0.587 * g + 0.114 * b)
                    .round()
                    .clamp(0.0, 255.0) as u8
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gray_matches_opencv_coefficients() {
        let img = RgbaImage::new(2, 1, vec![255, 0, 0, 255, 0, 255, 0, 255]).unwrap();
        let gray = img.to_gray();
        // OpenCV RGBA2GRAY: red -> 76.245 -> 76, green -> 149.685 -> 150
        assert_eq!(gray, vec![76, 150]);
    }

    #[test]
    fn rejects_mismatched_buffer() {
        assert!(RgbaImage::new(2, 2, vec![0; 3]).is_err());
    }
}
