mod frame;
mod image_export;
mod timeline;
mod video_export;

pub use frame::{
    render_composition_frame, render_composition_frame_async, RenderCompositionFrameTask,
};
pub use image_export::{
    export_composition_image_async, ExportCompositionImageInput, ExportCompositionImageTask,
};
pub(crate) use timeline::{composition_layers, is_video_source, mux_primary_audio};
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
pub struct CompositionLayer {
    pub id: Option<String>,
    pub layer_type: Option<String>,
    pub source: CompositionSource,
    pub rect: CompositionRect,
    pub fit: Option<String>,
    pub opacity: Option<f64>,
    pub z_index: Option<i32>,
    pub reveal: Option<CompositionReveal>,
    pub color: Option<RenderColorAdjustments>,
    pub transform: Option<RenderLayerTransform>,
    pub positioning: Option<LayerPositioning>,
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
