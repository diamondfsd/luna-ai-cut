use super::PREVIEW_MAX_SIZE;
use crate::media::fit_output_size;

/// 单个渲染层描述（静态图或视频帧）
#[derive(Clone)]
pub struct PreviewLayerInput {
    pub layer_type: Option<String>,
    pub precompose_group: Option<String>,
    pub precompose_role: Option<String>,
    pub file_path: String,
    pub is_video: bool,
    pub video_time: f64,
    pub fit: String,
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
    pub reveal_progress: f64,
    pub z_index: i32,
    pub color: crate::RenderColorAdjustments,
    pub mask_path: Option<String>,
    pub mask_texture_id: Option<u32>,
    pub mask_opacity: f64,
    pub mask_inverted: bool,
    pub mask_feather: f64,
    pub mask_transform: crate::RenderMaskTransform,
    pub pixel_stretch: Option<crate::RenderPixelStretch>,
    pub pixel_flow: Option<crate::RenderPixelFlow>,
    pub transform: crate::RenderLayerTransform,
    pub positioning: Option<crate::LayerPositioning>,
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

#[derive(Clone, Debug)]
pub struct PreviewTextureInfo {
    pub texture_id: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone)]
pub struct PlannedPreview {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<crate::RenderLayer>,
}

pub(super) fn plan_layer_rect(
    layer: &PreviewLayerInput,
    _texture: &PreviewTextureInfo,
    _output_width: u32,
    _output_height: u32,
) -> (f64, f64, f64, f64) {
    (layer.dst_x, layer.dst_y, layer.dst_w, layer.dst_h)
}

pub(super) fn should_swap_orientation(orientation: f64) -> bool {
    let normalized = ((orientation % 180.0) + 180.0) % 180.0;
    (45.0..=135.0).contains(&normalized)
}

pub(super) fn frame_aspect(texture: &PreviewTextureInfo, orientation: f64) -> f64 {
    let source_aspect = texture.width as f64 / texture.height.max(1) as f64;
    if should_swap_orientation(orientation) {
        1.0 / source_aspect.max(0.001)
    } else {
        source_aspect.max(0.001)
    }
}

pub(super) fn plan_cover_scale(
    texture: &PreviewTextureInfo,
    target_aspect: f64,
    transform: &mut crate::RenderLayerTransform,
) -> (f64, f64) {
    let source_aspect = texture.width as f64 / texture.height.max(1) as f64;
    let (crop_x, crop_y, crop_w, crop_h) = match transform.crop.as_ref() {
        Some(crop) => {
            let w = crop.w.clamp(0.001, 1.0);
            let h = crop.h.clamp(0.001, 1.0);
            (crop.x.clamp(0.0, 1.0 - w), crop.y.clamp(0.0, 1.0 - h), w, h)
        }
        None => (0.0, 0.0, 1.0, 1.0),
    };
    let frame_w = target_aspect * crop_h / crop_w;
    let frame_h = 1.0;
    let swaps_axes = should_swap_orientation(transform.orientation);
    let (original_frame_w, original_frame_h) = if swaps_axes {
        (1.0, source_aspect)
    } else {
        (source_aspect, 1.0)
    };
    let base_scale = if swaps_axes {
        frame_w.max(frame_h / source_aspect.max(0.001))
    } else {
        (frame_w / source_aspect.max(0.001)).max(frame_h)
    };

    let crop_center_x = crop_x + crop_w / 2.0;
    let crop_center_y = crop_y + crop_h / 2.0;
    let base_translate_x =
        (crop_center_x - 0.5) * frame_w / base_scale - (crop_center_x - 0.5) * original_frame_w;
    let base_translate_y =
        (crop_center_y - 0.5) * frame_h / base_scale - (crop_center_y - 0.5) * original_frame_h;

    transform.scale *= base_scale;
    transform.translate_x = Some(transform.translate_x.unwrap_or(0.0) + base_translate_x);
    transform.translate_y = Some(transform.translate_y.unwrap_or(0.0) + base_translate_y);
    (frame_w, frame_h)
}

pub(super) fn plan_layer_source_rect(
    layer: &PreviewLayerInput,
    _texture: &PreviewTextureInfo,
    _output_width: u32,
    _output_height: u32,
) -> (f64, f64, f64, f64) {
    (layer.src_x, layer.src_y, layer.src_w, layer.src_h)
}

pub(super) fn plan_layer_transform(
    layer: &PreviewLayerInput,
    texture: &PreviewTextureInfo,
    output_width: u32,
    output_height: u32,
) -> crate::RenderLayerTransform {
    plan_cover_transform(
        &layer.fit,
        layer.positioning.is_some(),
        layer.dst_w,
        layer.dst_h,
        &layer.transform,
        texture,
        output_width,
        output_height,
    )
}

pub(super) fn plan_cover_transform(
    fit: &str,
    has_positioning: bool,
    dst_w: f64,
    dst_h: f64,
    source_transform: &crate::RenderLayerTransform,
    texture: &PreviewTextureInfo,
    output_width: u32,
    output_height: u32,
) -> crate::RenderLayerTransform {
    let mut transform = source_transform.clone();
    if fit != "cover" || has_positioning {
        return transform;
    }
    let (crop_x, crop_y, crop_w, crop_h) = match transform.crop.as_ref() {
        Some(crop) => {
            let w = crop.w.clamp(0.001, 1.0);
            let h = crop.h.clamp(0.001, 1.0);
            (crop.x.clamp(0.0, 1.0 - w), crop.y.clamp(0.0, 1.0 - h), w, h)
        }
        None => (0.0, 0.0, 1.0, 1.0),
    };
    let visible_aspect = frame_aspect(texture, transform.orientation) * crop_w / crop_h.max(0.001);
    let layer_pixel_w = (dst_w * output_width as f64).abs().max(1.0);
    let layer_pixel_h = (dst_h * output_height as f64).abs().max(1.0);
    let target_aspect = layer_pixel_w / layer_pixel_h;

    if visible_aspect > target_aspect {
        let next_w = (crop_w * target_aspect / visible_aspect).clamp(0.001, crop_w);
        transform.crop = Some(crate::RenderCropRect {
            x: crop_x + (crop_w - next_w) / 2.0,
            y: crop_y,
            w: next_w,
            h: crop_h,
        });
    } else {
        let next_h = (crop_h * visible_aspect / target_aspect).clamp(0.001, crop_h);
        transform.crop = Some(crate::RenderCropRect {
            x: crop_x,
            y: crop_y + (crop_h - next_h) / 2.0,
            w: crop_w,
            h: next_h,
        });
    }
    transform
}

pub(super) fn layer_visible_pixel_size(
    texture: &PreviewTextureInfo,
    transform: &crate::RenderLayerTransform,
) -> (u32, u32) {
    let (frame_w, frame_h) = if should_swap_orientation(transform.orientation) {
        (texture.height as f64, texture.width as f64)
    } else {
        (texture.width as f64, texture.height as f64)
    };
    let crop = transform.crop.as_ref();
    let crop_w = crop.map(|c| c.w).unwrap_or(1.0).clamp(0.001, 1.0);
    let crop_h = crop.map(|c| c.h).unwrap_or(1.0).clamp(0.001, 1.0);
    (
        (frame_w * crop_w).round().max(1.0) as u32,
        (frame_h * crop_h).round().max(1.0) as u32,
    )
}

/// 根据相对定位重算 dst，保持纹理比例不变形
pub(super) fn resolve_positioning(
    positioning: &Option<crate::LayerPositioning>,
    default_x: f64,
    default_y: f64,
    default_w: f64,
    default_h: f64,
    canvas_w: f64,
    canvas_h: f64,
    tex_w: f64,
    tex_h: f64,
) -> (f64, f64, f64, f64) {
    let pos = match positioning {
        Some(p) => p,
        None => return (default_x, default_y, default_w, default_h),
    };

    let canvas_aspect = canvas_w / canvas_h.max(1.0);
    let tex_aspect = tex_w / tex_h.max(1.0);

    // target_width 作为输出画布 UV [0,1] 直接使用
    let dst_w = pos.target_width;
    let dst_h = dst_w * canvas_aspect / tex_aspect;
    let margin_x = pos.margin_x;
    let margin_y = pos.margin_y;

    let (dst_x, dst_y) = match pos.anchor.as_str() {
        "top-left" => (margin_x, margin_y),
        "top-center" => ((1.0 - dst_w) / 2.0, margin_y),
        "top-right" => (1.0 - dst_w - margin_x, margin_y),
        "bottom-left" => (margin_x, 1.0 - dst_h - margin_y),
        "bottom-center" => ((1.0 - dst_w) / 2.0, 1.0 - dst_h - margin_y),
        "bottom-right" => (1.0 - dst_w - margin_x, 1.0 - dst_h - margin_y),
        "center" => ((1.0 - dst_w) / 2.0, (1.0 - dst_h) / 2.0),
        _ => (default_x, default_y),
    };

    (dst_x, dst_y, dst_w, dst_h)
}

impl super::Compositor {
    pub fn plan_preview(
        &mut self,
        width: Option<u32>,
        height: Option<u32>,
        max_side: Option<u32>,
        layers: &[(PreviewLayerInput, PreviewTextureInfo)],
    ) -> Result<PlannedPreview, String> {
        let (first_layer, first_texture) = layers
            .first()
            .ok_or_else(|| "no valid layers for preview plan".to_string())?;

        // 有 transform.crop 时，按裁剪框像素尺寸作为基础输出尺寸
        let (base_w, base_h) = match &first_layer.transform.crop {
            Some(_) => {
                let (cw, ch) = layer_visible_pixel_size(first_texture, &first_layer.transform);
                (cw, ch)
            }
            None => {
                let (frame_w, frame_h) =
                    layer_visible_pixel_size(first_texture, &first_layer.transform);
                (frame_w, frame_h)
            }
        };

        let (output_width, output_height) = fit_output_size(
            width.unwrap_or(base_w).max(1),
            height.unwrap_or(base_h).max(1),
            max_side.unwrap_or(PREVIEW_MAX_SIZE),
        );
        let result_layers = layers
            .iter()
            .map(|(layer, texture)| {
                let (dst_x, dst_y, dst_w, dst_h) =
                    plan_layer_rect(layer, texture, output_width, output_height);
                let (src_x, src_y, src_w, src_h) =
                    plan_layer_source_rect(layer, texture, output_width, output_height);
                let transform = plan_layer_transform(layer, texture, output_width, output_height);
                crate::RenderLayer {
                    texture_id: texture.texture_id,
                    layer_type: layer.layer_type.clone(),
                    precompose_group: layer.precompose_group.clone(),
                    precompose_role: layer.precompose_role.clone(),
                    shape: layer.shape.clone(),
                    fill_color: layer.fill_color.clone(),
                    corner_radius: layer.corner_radius,
                    stroke_color: layer.stroke_color.clone(),
                    stroke_width: layer.stroke_width,
                    content: layer.content.clone(),
                    font_size: layer.font_size,
                    font_family: layer.font_family.clone(),
                    font_file: layer.font_file.clone(),
                    font_weight: layer.font_weight,
                    text_color: layer.text_color.clone(),
                    text_align: layer.text_align.clone(),
                    vertical_align: layer.vertical_align.clone(),
                    fit: Some(layer.fit.clone()),
                    dst_x,
                    dst_y,
                    dst_w,
                    dst_h,
                    src_x,
                    src_y,
                    src_w,
                    src_h,
                    opacity: layer.opacity,
                    blend_mode: layer.blend_mode.clone(),
                    reveal_progress: Some(layer.reveal_progress),
                    z_index: layer.z_index,
                    color: Some(layer.color.clone()),
                    mask_path: layer.mask_path.clone(),
                    mask_texture_id: layer.mask_texture_id,
                    mask_opacity: Some(layer.mask_opacity),
                    mask_inverted: Some(layer.mask_inverted),
                    mask_feather: Some(layer.mask_feather),
                    mask_transform: Some(layer.mask_transform.clone()),
                    pixel_stretch: layer.pixel_stretch.clone(),
                    pixel_flow: layer.pixel_flow.clone(),
                    transform: Some(transform),
                    positioning: layer.positioning.clone(),
                    restore_lut_id: layer.restore_lut_id.clone(),
                    lut_id: layer.lut_id.clone(),
                    lut_intensity: layer.lut_intensity,
                }
            })
            .collect();
        Ok(PlannedPreview {
            width: output_width,
            height: output_height,
            layers: result_layers,
        })
    }
}
