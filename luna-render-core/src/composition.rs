mod frame;
mod image_export;
mod mask_texture;
mod timeline;
mod video_export;

pub use frame::{
    render_composition_frame, render_composition_frame_async, RenderCompositionFrameTask,
};
pub use image_export::{
    export_composition_image_async, ExportCompositionImageInput, ExportCompositionImageTask,
};
pub(crate) use mask_texture::bind_layer_mask_texture;
#[cfg(target_os = "windows")]
pub(crate) use timeline::is_video_source;
pub(crate) use timeline::{composition_layers, mux_primary_audio};
pub use video_export::{export_composition_video_async, ExportCompositionVideoTask};

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{LazyLock, Mutex};

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use crate::compositor::{Compositor, PreviewLayerInput};
use crate::export::{cleanup_task, register_task, QualityPreset};
use crate::logging::write as log_write;
use crate::media::probe_video_info;
use crate::{LayerPositioning, RenderColorAdjustments, RenderLayerTransform, RenderPreviewOutput};

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionCanvas {
    pub width: u32,
    pub height: u32,
    pub fps: Option<f64>,
    pub duration: Option<f64>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionSourceTime {
    pub offset: Option<f64>,
    pub start: Option<f64>,
    pub duration: Option<f64>,
    pub loop_enabled: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionSource {
    pub path: String,
    pub source_type: Option<String>,
    pub time: Option<CompositionSourceTime>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionReveal {
    pub direction: String,
    pub start: f64,
    pub duration: f64,
    pub midpoint_hold: Option<f64>,
    pub midpoint_bounce: Option<f64>,
    pub easing: Option<String>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct MaskTrackKeyframe {
    pub time: f64,
    pub translate_x: f64,
    pub translate_y: f64,
    pub scale: f64,
    pub rotation: f64,
    pub confidence: f64,
    pub corrected: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct MaskTrack {
    pub version: u32,
    pub anchor_time: f64,
    pub start_time: f64,
    pub end_time: f64,
    pub keyframes: Vec<MaskTrackKeyframe>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionLayer {
    pub id: Option<String>,
    pub layer_type: Option<String>,
    #[serde(rename = "precomposeGroup", alias = "precompose_group")]
    pub precompose_group: Option<String>,
    #[serde(rename = "precomposeRole", alias = "precompose_role")]
    pub precompose_role: Option<String>,
    pub source: CompositionSource,
    pub rect: CompositionRect,
    #[serde(rename = "sourceRect", alias = "source_rect")]
    pub source_rect: Option<CompositionRect>,
    pub fit: Option<String>,
    pub opacity: Option<f64>,
    pub blend_mode: Option<String>,
    pub z_index: Option<i32>,
    #[serde(rename = "activeStart", alias = "active_start")]
    pub active_start: Option<f64>,
    #[serde(rename = "activeEnd", alias = "active_end")]
    pub active_end: Option<f64>,
    pub reveal: Option<CompositionReveal>,
    pub color: Option<RenderColorAdjustments>,
    pub mask_path: Option<String>,
    pub mask_opacity: Option<f64>,
    pub mask_inverted: Option<bool>,
    pub mask_feather: Option<f64>,
    pub mask_track: Option<MaskTrack>,
    #[serde(rename = "pixelStretch", alias = "pixel_stretch")]
    pub pixel_stretch: Option<crate::RenderPixelStretch>,
    #[serde(rename = "pixelFlow", alias = "pixel_flow")]
    pub pixel_flow: Option<crate::RenderPixelFlow>,
    pub transform: Option<RenderLayerTransform>,
    pub positioning: Option<LayerPositioning>,
    pub restore_lut_id: Option<String>,
    pub lut_id: Option<String>,
    pub lut_intensity: Option<f64>,
    pub shape: Option<String>,
    pub fill_color: Option<String>,
    pub corner_radius: Option<f64>,
    pub stroke_color: Option<String>,
    pub stroke_width: Option<f64>,
    pub content: Option<String>,
    pub font_size: Option<f64>,
    pub font_family: Option<String>,
    pub font_file: Option<String>,
    pub font_weight: Option<f64>,
    pub text_color: Option<String>,
    pub text_align: Option<String>,
    pub vertical_align: Option<String>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionInput {
    pub version: Option<u32>,
    pub canvas: CompositionCanvas,
    pub layers: Vec<CompositionLayer>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct RenderCompositionFrameInput {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub composition: CompositionInput,
    pub time: f64,
    pub max_side: Option<u32>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct ExportCompositionVideoInput {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub output_path: String,
    pub composition: CompositionInput,
    pub fps: Option<f64>,
    pub duration: Option<f64>,
    pub hardware: Option<bool>,
    pub task_id: Option<String>,
    pub quality_preset: Option<String>,
}
