use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
pub struct TextureLoadResult {
    pub texture_id: u32,
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct RenderCurvePoint {
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct RenderToneCurveAdjust {
    pub rgb: Vec<RenderCurvePoint>,
    pub luminance: Vec<RenderCurvePoint>,
    pub red: Vec<RenderCurvePoint>,
    pub green: Vec<RenderCurvePoint>,
    pub blue: Vec<RenderCurvePoint>,
}

#[napi(object)]
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct RenderHslChannelAdjust {
    pub hue: f64,
    pub hue_shift: f64,
    pub saturation: f64,
    pub luminance: f64,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct RenderColorAdjustments {
    pub exposure: f64,
    pub black: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub vibrance: f64,
    pub temperature: f64,
    pub tint: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub whites: f64,
    pub blacks: f64,
    pub clarity: f64,
    pub texture: f64,
    pub sharpen: f64,
    pub denoise: f64,
    pub grade_shadows_hue: f64,
    pub grade_shadows_amount: f64,
    pub grade_mid_hue: f64,
    pub grade_mid_amount: f64,
    pub grade_highlights_hue: f64,
    pub grade_highlights_amount: f64,
    pub curve_lift: f64,
    pub curve_contrast: f64,
    pub curve: RenderToneCurveAdjust,
    pub levels_black: f64,
    pub levels_gray: f64,
    pub levels_white: f64,
    pub hsl_channels: Vec<RenderHslChannelAdjust>,
}

impl Default for RenderColorAdjustments {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            black: 0.0,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            vibrance: 0.0,
            temperature: 0.0,
            tint: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            clarity: 0.0,
            texture: 0.0,
            sharpen: 0.0,
            denoise: 0.0,
            grade_shadows_hue: 220.0,
            grade_shadows_amount: 0.0,
            grade_mid_hue: 35.0,
            grade_mid_amount: 0.0,
            grade_highlights_hue: 42.0,
            grade_highlights_amount: 0.0,
            curve_lift: 0.0,
            curve_contrast: 0.0,
            curve: RenderToneCurveAdjust::default(),
            levels_black: 0.0,
            levels_gray: 0.5,
            levels_white: 1.0,
            hsl_channels: default_hsl_channels(),
        }
    }
}

fn default_hsl_channels() -> Vec<RenderHslChannelAdjust> {
    [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 285.0, 320.0]
        .iter()
        .map(|hue| RenderHslChannelAdjust {
            hue: *hue,
            hue_shift: 0.0,
            saturation: 0.0,
            luminance: 0.0,
        })
        .collect()
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct RenderCropRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct RenderLayerTransform {
    pub crop: Option<RenderCropRect>,
    pub orientation: f64,
    pub rotate: f64,
    pub flip_h: bool,
    pub flip_v: bool,
    pub scale: f64,
    pub translate_x: Option<f64>,
    pub translate_y: Option<f64>,
}

#[napi(object)]
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct RenderMaskTransform {
    pub translate_x: f64,
    pub translate_y: f64,
    pub scale: f64,
    pub rotation: f64,
}

/// 层相对定位：Rust 根据画布比例自动计算 dst，保证纹理比例不变形
#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct LayerPositioning {
    pub anchor: String,
    pub target_width: f64,
    pub margin_x: f64,
    pub margin_y: f64,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPixelStretch {
    pub mode: String,
    pub intensity: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub angle: Option<f64>,
    pub ribbon_size: Option<f64>,
    pub sample_start: Option<f64>,
    pub sample_end: Option<f64>,
    pub line_end: Option<f64>,
    pub control_start: Option<f64>,
    pub control_end: Option<f64>,
    pub center_x: Option<f64>,
    pub center_y: Option<f64>,
    pub path_points: Option<Vec<f64>>,
    pub path_start_width: Option<f64>,
    pub path_end_width: Option<f64>,
    pub fill_sample_gaps: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPixelFlow {
    pub duration: f64,
    pub progress: Option<f64>,
    pub flow_mode: Option<String>,
    pub trajectory: Option<String>,
    pub sky_mode: Option<String>,
    pub other_direction: Option<String>,
    pub pixel_count: f64,
    pub light_width: f64,
    pub depth_strength: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub impact_x: f64,
    pub impact_y: f64,
    pub sky_scale: Option<f64>,
    pub background_scale: Option<f64>,
    pub subject_scale: Option<f64>,
    pub sky_black_ratio: Option<f64>,
    pub bloom_strength: Option<f64>,
    pub filter_strength: Option<f64>,
    pub color_transition: Option<f64>,
}

impl Default for RenderLayerTransform {
    fn default() -> Self {
        Self {
            crop: None,
            orientation: 0.0,
            rotate: 0.0,
            flip_h: false,
            flip_v: false,
            scale: 1.0,
            translate_x: Some(0.0),
            translate_y: Some(0.0),
        }
    }
}

// ─────────────── napi 结构体 ───────────────

/// 画布上的一个渲染层（预览用，纹理已由 JS 预加载）
#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct RenderLayer {
    pub texture_id: u32,
    pub layer_type: Option<String>,
    pub precompose_group: Option<String>,
    pub precompose_role: Option<String>,
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
    pub fit: Option<String>,
    pub dst_x: f64,
    pub dst_y: f64,
    pub dst_w: f64,
    pub dst_h: f64,
    pub src_x: f64,
    pub src_y: f64,
    pub src_w: f64,
    pub src_h: f64,
    pub opacity: f64,
    pub blend_mode: Option<String>,
    pub reveal_progress: Option<f64>,
    pub z_index: i32,
    pub color: Option<RenderColorAdjustments>,
    pub mask_path: Option<String>,
    pub mask_texture_id: Option<u32>,
    pub mask_opacity: Option<f64>,
    pub mask_inverted: Option<bool>,
    pub mask_feather: Option<f64>,
    pub mask_transform: Option<RenderMaskTransform>,
    pub pixel_stretch: Option<RenderPixelStretch>,
    pub pixel_flow: Option<RenderPixelFlow>,
    pub transform: Option<RenderLayerTransform>,
    pub positioning: Option<LayerPositioning>,
    pub restore_lut_id: Option<String>,
    pub lut_id: Option<String>,
    pub lut_intensity: Option<f64>,
}

/// 预览层 — render_preview 的统一层描述
#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct PreviewLayer {
    pub layer_type: Option<String>,
    pub precompose_group: Option<String>,
    pub precompose_role: Option<String>,
    pub file_path: String,
    pub is_video: bool,
    pub video_time: f64,
    pub dst_x: f64,
    pub dst_y: f64,
    pub dst_w: f64,
    pub dst_h: f64,
    pub src_x: f64,
    pub src_y: f64,
    pub src_w: f64,
    pub src_h: f64,
    pub opacity: f64,
    pub blend_mode: Option<String>,
    pub z_index: i32,
    pub color: Option<RenderColorAdjustments>,
    pub mask_path: Option<String>,
    pub mask_opacity: Option<f64>,
    pub mask_inverted: Option<bool>,
    pub mask_feather: Option<f64>,
    pub mask_transform: Option<RenderMaskTransform>,
    pub pixel_stretch: Option<RenderPixelStretch>,
    pub pixel_flow: Option<RenderPixelFlow>,
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

/// render_preview 的输入
#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct RenderPreviewInput {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub max_side: Option<u32>,
    pub layers: Vec<PreviewLayer>,
}

#[napi(object)]
pub struct RenderPreviewOutput {
    pub width: u32,
    pub height: u32,
    pub data: Buffer,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct PreviewTexture {
    pub texture_id: u32,
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct PreviewPlanLayer {
    pub layer: PreviewLayer,
    pub texture: PreviewTexture,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct PreviewPlanInput {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub max_side: Option<u32>,
    pub layers: Vec<PreviewPlanLayer>,
}

#[napi(object)]
pub struct PreviewPlanOutput {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<RenderLayer>,
}
