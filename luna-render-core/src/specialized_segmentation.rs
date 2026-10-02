#[path = "specialized_segmentation/preprocess.rs"]
mod preprocess;
use preprocess::*;
pub use preprocess::{preprocess_birefnet, preprocess_rmbg14, preprocess_yolo};
#[path = "specialized_segmentation/yolo_masks.rs"]
mod yolo_masks;
use yolo_masks::*;
pub use yolo_masks::{yolo_instance_map, yolo_person_mask};
#[path = "specialized_segmentation/subject_masks.rs"]
mod subject_masks;
pub use subject_masks::birefnet_mask;
use subject_masks::*;
#[path = "specialized_segmentation/parsing_features.rs"]
mod parsing_features;
use parsing_features::*;
#[path = "specialized_segmentation/faces.rs"]
mod faces;
use faces::*;
#[path = "specialized_segmentation/yolo.rs"]
mod yolo;
#[allow(unused_imports)]
pub use yolo::segment_yolo;
use yolo::*;
#[path = "specialized_segmentation/subject.rs"]
mod subject;
use subject::*;
pub use subject::{segment_birefnet, segment_rmbg};

use crate::onnx_session::{ModelKind, Session};
use ort::value::Tensor;

const YOLO_SIZE: usize = 640;
const SEGFORMER_SIZE: usize = 512;
const SEGFORMER_CLASSES: usize = 150;
const SUBJECT_SIZE: usize = 1024;
const ULTRAFACE_WIDTH: usize = 320;
const ULTRAFACE_HEIGHT: usize = 240;
const ULTRAFACE_MAX_FACES: usize = 16;
const ULTRAFACE_BOX_VALUES: usize = ULTRAFACE_MAX_FACES * 4;
const EYE_SIZE: usize = 32;
const DINOV2_SIZE: usize = 224;
const DINOV2_DIMENSION: usize = 384;
const SFACE_SIZE: usize = 112;
const SFACE_DIMENSION: usize = 128;
const RELIC_CPC_SIZE: usize = 224;

fn session(model_path: &str) -> Result<Session, String> {
    session_for_model(model_path, ModelKind::General)
}

fn session_for_model(model_path: &str, model_kind: ModelKind) -> Result<Session, String> {
    let threads = std::thread::available_parallelism()
        .map(|count| count.get().saturating_sub(1).clamp(1, 4))
        .unwrap_or(2);
    Session::load_for_model(model_path, threads, model_kind)
        .map_err(|error| format!("加载专用分割模型失败: {error}"))
}

pub enum SpecializedSession {
    Yolo(Session),
    YoloLabels(Session),
    YoloInstances(Session),
    SegformerLabels(Session),
    Rmbg14(Session),
    UltraFace(Session),
    UltraFaceBoxes(Session),
    EyeState(Session),
    Dinov2Small(Session),
    SFace(Session),
    BirefNet(Session),
    FaceParsing(Session),
    HumanParsing(Session),
    Relic2Cpc(Session),
}

impl SpecializedSession {
    pub fn load(backend: &str, model_path: &str) -> Result<Self, String> {
        match backend {
            "yolo26-seg" => Ok(Self::Yolo(session_for_model(
                model_path,
                ModelKind::Yolo26Seg,
            )?)),
            "yolo26-labels" => Ok(Self::YoloLabels(session_for_model(
                model_path,
                ModelKind::Yolo26Seg,
            )?)),
            "yolo26-instances" => Ok(Self::YoloInstances(session_for_model(
                model_path,
                ModelKind::Yolo26Seg,
            )?)),
            "segformer-labels" => Ok(Self::SegformerLabels(session(model_path)?)),
            "rmbg-1.4" => Ok(Self::Rmbg14(session(model_path)?)),
            "ultraface" => Ok(Self::UltraFace(session(model_path)?)),
            "ultraface-boxes" => Ok(Self::UltraFaceBoxes(session(model_path)?)),
            "eye-state" => Ok(Self::EyeState(session(model_path)?)),
            "dinov2-small" => Ok(Self::Dinov2Small(session(model_path)?)),
            "sface" => Ok(Self::SFace(session(model_path)?)),
            "birefnet-general-lite" => Ok(Self::BirefNet(session(model_path)?)),
            "face-parsing" => Ok(Self::FaceParsing(session(model_path)?)),
            "human-parsing" => Ok(Self::HumanParsing(session(model_path)?)),
            "relic2-cpc" => Ok(Self::Relic2Cpc(session(model_path)?)),
            _ => Err("不支持的专用分割模型".to_string()),
        }
    }

    pub fn segment(
        &mut self,
        rgb: &[u8],
        scaled_width: usize,
        scaled_height: usize,
        pad_x: usize,
        pad_y: usize,
        output_size: usize,
    ) -> Result<Vec<u8>, String> {
        match self {
            Self::Yolo(session) => segment_yolo_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::YoloLabels(session) => segment_yolo_labels_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::YoloInstances(session) => segment_yolo_instances_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::SegformerLabels(session) => {
                segment_segformer_labels_with_session(session, rgb, output_size)
            }
            Self::Rmbg14(session) => segment_rmbg_with_session(session, rgb, output_size),
            Self::UltraFace(session) => segment_ultraface_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::UltraFaceBoxes(session) => extract_ultraface_boxes_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::EyeState(session) => classify_eye_with_session(session, rgb, output_size),
            Self::Dinov2Small(session) => extract_dinov2_with_session(session, rgb, output_size),
            Self::SFace(session) => extract_sface_with_session(session, rgb, output_size),
            Self::BirefNet(session) => segment_birefnet_with_session(session, rgb, output_size),
            Self::FaceParsing(session) => {
                segment_face_parsing_with_session(session, rgb, output_size)
            }
            Self::HumanParsing(session) => {
                segment_human_parsing_with_session(session, rgb, output_size)
            }
            Self::Relic2Cpc(session) => score_relic2_cpc_with_session(session, rgb, output_size),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yolo_keeps_person_instances_and_rejects_other_classes() {
        let detections = vec![
            0.0, 0.0, 640.0, 640.0, 0.9, 0.0, 2.0, 0.0, 0.0, 640.0, 640.0, 0.99, 1.0, 2.0,
        ];
        let mask = yolo_person_mask(&detections, 2, 7, &[1.0], 1, 1, 1, 640, 640, 0, 0, 2).unwrap();
        assert!(mask.iter().all(|value| *value > 127));
    }

    #[test]
    fn yolo_label_map_keeps_detected_object_classes() {
        let detections = vec![0.0, 0.0, 640.0, 640.0, 0.9, 2.0, 0.0];
        let labels = yolo_object_map(&detections, 1, 7, 640, 640, 0, 0, 2).unwrap();
        assert_eq!(labels, vec![3, 3, 3, 3]);
    }

    #[test]
    fn yolo_instance_map_keeps_instances_separate_and_prefers_stronger_overlap() {
        let detections = vec![
            0.0, 0.0, 400.0, 640.0, 0.8, 2.0, 2.0, 240.0, 0.0, 640.0, 640.0, 0.9, 2.0, 2.0,
        ];
        let bytes =
            yolo_instance_map(&detections, 2, 7, &[1.0], 1, 1, 1, 640, 640, 0, 0, 4).unwrap();
        let ids = bytes
            .chunks_exact(2)
            .map(|value| u16::from_le_bytes([value[0], value[1]]))
            .collect::<Vec<_>>();
        assert_eq!(&ids[0..4], &[1, 2, 2, 2]);
        assert_eq!(bytes.len(), 4 * 4 * 2);
    }

    #[test]
    fn subject_models_normalize_the_model_range() {
        let mask = normalized_subject_mask(&[-2.0, 0.0, 1.0, 2.0], 2, 2, 2).unwrap();
        assert_eq!(mask[0], 0);
        assert_eq!(mask[3], 255);
    }

    #[test]
    fn ultraface_filters_low_confidence_and_overlapping_boxes() {
        let boxes = [
            0.1, 0.1, 0.4, 0.4, 0.11, 0.11, 0.39, 0.39, 0.6, 0.6, 0.8, 0.8,
        ];
        let scores = [0.1, 0.95, 0.1, 0.9, 0.7, 0.3];
        let mask = ultraface_mask(&boxes, &scores, 640, 640, 0, 0, 20).unwrap();
        assert!(mask.iter().any(|value| *value == 255));
        assert_eq!(mask[15 * 20 + 15], 0);
    }

    #[test]
    fn ultraface_keeps_touching_faces_as_independent_boxes() {
        let boxes = [0.1, 0.1, 0.3, 0.4, 0.25, 0.1, 0.45, 0.4];
        let scores = [0.1, 0.95, 0.1, 0.94];
        let faces = ultraface_faces(&boxes, &scores, 640, 640, 0, 0).unwrap();
        assert_eq!(faces.len(), 2);
        assert!(faces[0].x2 > faces[1].x1);
    }

    #[test]
    fn dinov2_preprocessing_uses_expected_shape() {
        let rgb = vec![127u8; DINOV2_SIZE * DINOV2_SIZE * 3];
        let input = preprocess_dinov2(&rgb).unwrap();
        assert_eq!(input.len(), 3 * DINOV2_SIZE * DINOV2_SIZE);
        assert!(input.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn relic_cpc_preprocessing_uses_chw_imagenet_normalization() {
        let plane = RELIC_CPC_SIZE * RELIC_CPC_SIZE;
        let mut rgb = vec![127u8; plane * 3];
        rgb[0] = 0;
        rgb[1] = 127;
        rgb[2] = 255;
        let input = preprocess_relic_cpc(&rgb).unwrap();
        assert_eq!(input.len(), 3 * plane);
        assert!((input[0] - ((0.0 - 0.485) / 0.229)).abs() < 1e-6);
        assert!((input[plane] - ((127.0 / 255.0 - 0.456) / 0.224)).abs() < 1e-6);
        assert!((input[plane * 2] - ((255.0 / 255.0 - 0.406) / 0.225)).abs() < 1e-6);
    }

    #[test]
    fn sface_preprocessing_preserves_rgb_byte_range() {
        let rgb = vec![127u8; SFACE_SIZE * SFACE_SIZE * 3];
        let input = preprocess_sface(&rgb).unwrap();
        assert_eq!(input.len(), 3 * SFACE_SIZE * SFACE_SIZE);
        assert!(input.iter().all(|value| *value == 127.0));
    }

    #[test]
    fn birefnet_applies_sigmoid_to_logits() {
        let mask = birefnet_mask(&[-8.0, 8.0, -8.0, 8.0], 2, 2, 2).unwrap();
        assert!(mask[0] < 2);
        assert!(mask[1] > 200);
    }
}
