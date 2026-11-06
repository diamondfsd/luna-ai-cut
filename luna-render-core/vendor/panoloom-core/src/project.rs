//! The `.panoproj` project document — the single source of truth shared with
//! the frontend (TypeScript mirror in `packages/shared`). Serialized as JSON;
//! field names are camelCase on the wire.

use serde::{Deserialize, Serialize};

pub const PROJECT_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub version: u32,
    pub images: Vec<ImageEntry>,
    pub control_points: Vec<ControlPoint>,
    pub optimizer: OptimizerSettings,
    pub panorama: PanoramaSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEntry {
    pub id: u32,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub exif: Option<ExifInfo>,
    pub lens: Lens,
    pub pose: Pose,
    pub photometric: Photometric,
    /// Bracketed-exposure stack membership (HDR, phase 2).
    #[serde(default)]
    pub stack_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExifInfo {
    #[serde(default)]
    pub focal_length_mm: Option<f64>,
    #[serde(default)]
    pub focal_length_35mm: Option<f64>,
    #[serde(default)]
    pub make: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LensType {
    Rectilinear,
    FisheyeCircular,
    FisheyeFullframe,
}

/// PanoTools-style lens model: horizontal field of view plus radial
/// distortion polynomial (a, b, c) and optical-center shift (d, e).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lens {
    pub lens_type: LensType,
    pub hfov_deg: f64,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
}

/// Rotation of the camera for this shot, degrees.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pose {
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Photometric {
    /// Exposure offset in EV relative to the anchor image.
    pub ev: f64,
    pub wb_r: f64,
    pub wb_b: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlPointKind {
    Normal,
    /// Two points that must be vertical in the panorama (leveling).
    VerticalLine,
    HorizontalLine,
}

/// Coordinates are always in ORIGINAL image pixel space; the engine scales
/// internally. `error_px` is filled by the optimizer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlPoint {
    pub id: u32,
    pub img_a: u32,
    pub img_b: u32,
    pub x_a: f64,
    pub y_a: f64,
    pub x_b: f64,
    pub y_b: f64,
    pub kind: ControlPointKind,
    #[serde(default)]
    pub error_px: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizerSettings {
    pub optimize_yaw_pitch_roll: bool,
    pub optimize_hfov: bool,
    pub optimize_distortion: bool,
    pub optimize_shift: bool,
}

impl Default for OptimizerSettings {
    fn default() -> Self {
        Self {
            optimize_yaw_pitch_roll: true,
            optimize_hfov: false,
            optimize_distortion: false,
            optimize_shift: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Projection {
    Equirectangular,
    Cylindrical,
    Rectilinear,
    Stereographic,
    Mercator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaSettings {
    pub projection: Projection,
    /// View rotation applied to the whole panorama, degrees.
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub hfov_deg: f64,
    pub vfov_deg: f64,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub crop: Option<CropRect>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_json_roundtrip_is_camel_case() {
        let project = Project {
            version: PROJECT_FORMAT_VERSION,
            images: vec![ImageEntry {
                id: 0,
                file_name: "IMG_0001.jpg".into(),
                width: 8192,
                height: 5464,
                exif: None,
                lens: Lens {
                    lens_type: LensType::Rectilinear,
                    hfov_deg: 65.5,
                    a: 0.0,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                    e: 0.0,
                },
                pose: Pose::default(),
                photometric: Photometric {
                    ev: 0.0,
                    wb_r: 1.0,
                    wb_b: 1.0,
                },
                stack_id: None,
            }],
            control_points: vec![],
            optimizer: OptimizerSettings::default(),
            panorama: PanoramaSettings {
                projection: Projection::Equirectangular,
                yaw: 0.0,
                pitch: 0.0,
                roll: 0.0,
                hfov_deg: 360.0,
                vfov_deg: 180.0,
                width: 8192,
                height: 4096,
                crop: None,
            },
        };

        let json = serde_json::to_string(&project).unwrap();
        assert!(
            json.contains("\"fileName\""),
            "wire format must be camelCase"
        );
        assert!(json.contains("\"hfovDeg\""));
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(back.images.len(), 1);
        assert_eq!(back.panorama.projection, Projection::Equirectangular);
    }
}
