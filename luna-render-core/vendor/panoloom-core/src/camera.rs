//! Camera parameters — port of `cv::detail::CameraParams` (camera.cpp).
//!
//! `focal`/`ppx`/`ppy` are in WORK-SCALE pixels (the registration
//! resolution); `r` is the pano<-camera rotation, stored f32 exactly like
//! OpenCV's CV_32F camera matrices after estimation (docs/pipeline.md §0).

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraParams {
    pub focal: f64,
    pub aspect: f64,
    pub ppx: f64,
    pub ppy: f64,
    pub r: [[f32; 3]; 3],
}

impl Default for CameraParams {
    /// `CameraParams::CameraParams()`: focal 1, aspect 1, pp (0,0), R = I.
    fn default() -> Self {
        Self {
            focal: 1.0,
            aspect: 1.0,
            ppx: 0.0,
            ppy: 0.0,
            r: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        }
    }
}

impl CameraParams {
    /// `CameraParams::K()` as CV_64F (camera.cpp:64-70).
    pub fn k(&self) -> [[f64; 3]; 3] {
        [
            [self.focal, 0.0, self.ppx],
            [0.0, self.focal * self.aspect, self.ppy],
            [0.0, 0.0, 1.0],
        ]
    }
}
