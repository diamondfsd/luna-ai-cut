mod api_types;
mod color_source;
mod composition;
mod compositor;
mod export;
mod logging;
#[cfg(target_os = "macos")]
mod macos;
mod media;
mod native_preview;
mod sam_core;
pub mod sam_segmentation;
mod segmentation;
mod segmentation_refinement;
#[cfg(target_os = "windows")]
mod windows;

use std::sync::{LazyLock, Mutex};

pub use api_types::*;

#[napi(object)]
pub struct SegmentationResult {
    pub width: u32,
    pub height: u32,
    pub class_id: u32,
    pub bytes: Buffer,
}

#[napi]
pub fn segment_image(
    model_path: String,
    rgb: Buffer,
    point_x: f64,
    point_y: f64,
    target_class_id: Option<u32>,
    input_size: Option<u32>,
) -> napi::Result<SegmentationResult> {
    segmentation::segment(
        model_path,
        rgb.to_vec(),
        point_x,
        point_y,
        target_class_id,
        input_size,
    )
    .map(|result| SegmentationResult {
        width: result.width,
        height: result.height,
        class_id: result.class_id,
        bytes: result.bytes.into(),
    })
    .map_err(napi::Error::from_reason)
}

#[napi]
pub fn segment_sam(
    vision_encoder_path: String,
    prompt_decoder_path: String,
    rgb: Buffer,
    source_width: u32,
    source_height: u32,
    point_x: f64,
    point_y: f64,
) -> napi::Result<sam_segmentation::SamSegmentationResult> {
    sam_segmentation::segment(
        vision_encoder_path,
        prompt_decoder_path,
        rgb,
        source_width,
        source_height,
        point_x,
        point_y,
    )
    .map_err(napi::Error::from_reason)
}
pub use color_source::{resolve_render_source, ColorInfo, ResolvedRenderSource};
pub use composition::*;
use compositor::Compositor;
use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Task};
use napi_derive::napi;
pub use native_preview::*;

// ── 跨模块日志宏 ──
macro_rules! log {
    ($($arg:tt)*) => {
        $crate::logging::write(&format!($($arg)*))
    };
}
pub(crate) use log;

macro_rules! log_error {
    ($($arg:tt)*) => {
        $crate::logging::error(&format!($($arg)*))
    };
}
pub(crate) use log_error;

/// 两套独立 compositor：预览和导出互不争锁
static COMPOSITOR_PREVIEW: LazyLock<Mutex<Option<Compositor>>> = LazyLock::new(|| Mutex::new(None));
static COMPOSITOR_EXPORT: LazyLock<Mutex<Option<Compositor>>> = LazyLock::new(|| Mutex::new(None));
static COMPOSITOR_LOG_PATH: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

fn lock_compositor<T>(
    compositor: &LazyLock<Mutex<Option<Compositor>>>,
    label: &str,
    f: impl FnOnce(&mut Compositor) -> Result<T, String>,
) -> napi::Result<T> {
    let mut guard = compositor.lock().map_err(|e| {
        let msg = format!("lock {}: {}", label, e);
        logging::error(&msg);
        napi::Error::from_reason(msg)
    })?;
    let c = guard.as_mut().ok_or_else(|| {
        let msg = format!(
            "compositor [{}] not initialized, call initCompositor() first",
            label
        );
        logging::error(&msg);
        napi::Error::from_reason(msg)
    })?;
    f(c).map_err(|e| {
        logging::error(&e);
        napi::Error::from_reason(e.to_string())
    })
}

pub(crate) fn lock_preview<T>(
    f: impl FnOnce(&mut Compositor) -> Result<T, String>,
) -> napi::Result<T> {
    lock_compositor(&COMPOSITOR_PREVIEW, "preview", f)
}

pub(crate) fn lock_export<T>(
    f: impl FnOnce(&mut Compositor) -> Result<T, String>,
) -> napi::Result<T> {
    ensure_export_compositor()?;
    lock_compositor(&COMPOSITOR_EXPORT, "export", f)
}

fn ensure_export_compositor() -> napi::Result<()> {
    {
        let guard = COMPOSITOR_EXPORT
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("lock export compositor: {}", e)))?;
        if guard.is_some() {
            return Ok(());
        }
    }
    let replacement = new_shared_compositor().map_err(napi::Error::from_reason)?;
    let mut guard = COMPOSITOR_EXPORT
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock export compositor: {}", e)))?;
    if guard.is_none() {
        *guard = Some(replacement);
        log!("init_export_compositor OK shared_gpu=true");
    }
    Ok(())
}

pub(crate) fn new_shared_compositor() -> Result<Compositor, String> {
    let guard = COMPOSITOR_PREVIEW
        .lock()
        .map_err(|error| format!("lock preview compositor: {error}"))?;
    let shared = guard
        .as_ref()
        .ok_or_else(|| "preview compositor is not initialized".to_string())?;
    Compositor::new_with_shared_gpu(shared)
}

#[cfg(target_os = "windows")]
pub(crate) fn reset_export_compositor() -> napi::Result<()> {
    let replacement = new_shared_compositor()
        .map_err(|e| napi::Error::from_reason(format!("reinitialize export compositor: {}", e)))?;
    let mut guard = COMPOSITOR_EXPORT
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock export compositor: {}", e)))?;
    *guard = Some(replacement);
    log!("reset_export_compositor OK after Windows GPU fallback");
    Ok(())
}

// ─────────────── napi exports ───────────────

/// 初始化两套 GPU compositor（预览 + 导出），共用日志路径
///
/// - `log_path`: 日志文件路径（可选，默认 luna-rc.log）
#[napi]
pub fn init_compositor(log_path: Option<String>) -> napi::Result<()> {
    init_compositors(log_path)
}

fn init_compositors(log_path: Option<String>) -> napi::Result<()> {
    if let Ok(mut guard) = COMPOSITOR_LOG_PATH.lock() {
        *guard = log_path.clone();
    }
    let path = log_path.as_deref();
    init_one_compositor(&COMPOSITOR_PREVIEW, path, "preview")?;
    Ok(())
}

pub struct InitCompositorTask {
    log_path: Option<String>,
}

impl Task for InitCompositorTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        init_compositors(self.log_path.clone())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

#[napi]
pub fn init_compositor_async(log_path: Option<String>) -> AsyncTask<InitCompositorTask> {
    AsyncTask::new(InitCompositorTask { log_path })
}

fn init_one_compositor(
    compositor: &LazyLock<Mutex<Option<Compositor>>>,
    log_path: Option<&str>,
    label: &str,
) -> napi::Result<()> {
    let mut guard = compositor
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock {}: {}", label, e)))?;
    if guard.is_some() {
        return Ok(());
    }
    let c = Compositor::new(log_path).map_err(|e| napi::Error::from_reason(e))?;
    log!("init_{}_compositor OK", label);
    *guard = Some(c);
    Ok(())
}

/// 加载一张纹理到 GPU，返回 texture_id
#[napi]
pub fn load_texture(data: Buffer, width: u32, height: u32) -> napi::Result<u32> {
    let bytes: Vec<u8> = data.into();
    lock_preview(|c| c.load_texture(&bytes, width, height))
}

/// 从本地图片路径加载预览纹理，native 内部通过 ffmpeg 解码并等比缩小后上传 GPU。
#[napi]
pub fn load_texture_from_path(
    ffmpeg_path: String,
    ffprobe_path: String,
    path: String,
    max_size: u32,
) -> napi::Result<TextureLoadResult> {
    lock_preview(|c| {
        let (texture_id, width, height) =
            c.load_texture_from_path(&ffmpeg_path, &ffprobe_path, &path, max_size)?;
        Ok(TextureLoadResult {
            texture_id,
            width,
            height,
        })
    })
}
/// 更新已有纹理的内容（用于视频逐帧更新）
#[napi]
pub fn update_texture(texture_id: u32, data: Buffer) -> napi::Result<()> {
    let bytes: Vec<u8> = data.into();
    lock_preview(|c| c.update_texture(texture_id, &bytes))
}

/// 释放纹理
#[napi]
pub fn release_texture(texture_id: u32) -> napi::Result<()> {
    lock_preview(|c| c.release_texture(texture_id))
}

/// 渲染一帧
#[napi]
pub fn render_frame(
    canvas_width: u32,
    canvas_height: u32,
    layers: Vec<RenderLayer>,
) -> napi::Result<Buffer> {
    let result = lock_preview(|c| c.render(canvas_width, canvas_height, &layers))?;
    Ok(result.into())
}

/// 统一预览入口：传路径列表，Rust 内部解码 + 缓存 + 合成，返回 RGBA Buffer 和实际输出尺寸。
#[napi]
pub fn render_preview(input: RenderPreviewInput) -> napi::Result<RenderPreviewOutput> {
    let layers: Vec<compositor::PreviewLayerInput> = input
        .layers
        .iter()
        .map(|l| compositor::PreviewLayerInput {
            layer_type: l.layer_type.clone(),
            precompose_group: l.precompose_group.clone(),
            precompose_role: l.precompose_role.clone(),
            file_path: l.file_path.clone(),
            is_video: l.is_video,
            video_time: l.video_time,
            fit: "stretch".to_string(),
            dst_x: l.dst_x,
            dst_y: l.dst_y,
            dst_w: l.dst_w,
            dst_h: l.dst_h,
            src_x: l.src_x,
            src_y: l.src_y,
            src_w: l.src_w,
            src_h: l.src_h,
            opacity: l.opacity,
            blend_mode: l.blend_mode.clone(),
            reveal_progress: 1.0,
            z_index: l.z_index,
            color: l.color.clone().unwrap_or_default(),
            mask_path: l.mask_path.clone(),
            mask_texture_id: None,
            mask_opacity: l.mask_opacity.unwrap_or(1.0).clamp(0.0, 1.0),
            mask_inverted: l.mask_inverted.unwrap_or(false),
            mask_feather: l.mask_feather.unwrap_or(0.0).clamp(0.0, 100.0),
            mask_transform: l
                .mask_transform
                .clone()
                .unwrap_or(crate::RenderMaskTransform {
                    scale: 1.0,
                    ..Default::default()
                }),
            pixel_stretch: l.pixel_stretch.clone(),
            transform: l.transform.clone().unwrap_or_default(),
            positioning: l.positioning.clone(),
            restore_lut_id: l.restore_lut_id.clone(),
            lut_id: l.lut_id.clone(),
            lut_intensity: l.lut_intensity,
            shape: l.shape.clone(),
            fill_color: l.fill_color.clone(),
            corner_radius: l.corner_radius,
            stroke_color: l.stroke_color.clone(),
            stroke_width: l.stroke_width,
            content: l.content.clone(),
            font_size: l.font_size,
            font_family: l.font_family.clone(),
            font_file: l.font_file.clone(),
            font_weight: l.font_weight,
            text_color: l.text_color.clone(),
            text_align: l.text_align.clone(),
            vertical_align: l.vertical_align.clone(),
        })
        .collect();
    lock_preview(|c| {
        let (data, width, height) = c.render_preview(
            &input.ffmpeg_path,
            &input.ffprobe_path,
            input.width,
            input.height,
            input.max_side,
            &layers,
            None,
        )?;
        Ok(RenderPreviewOutput {
            width,
            height,
            data: data.into(),
        })
    })
}

/// 只计算预览输出尺寸和图层布局，不解码、不渲染。
/// 前端可以缓存 texture/video frame，但 contain/fill 等布局由 Rust 统一规划。
#[napi]
pub fn plan_preview(input: PreviewPlanInput) -> napi::Result<PreviewPlanOutput> {
    let layers: Vec<(
        compositor::PreviewLayerInput,
        compositor::PreviewTextureInfo,
    )> = input
        .layers
        .iter()
        .map(|item| {
            (
                compositor::PreviewLayerInput {
                    layer_type: item.layer.layer_type.clone(),
                    precompose_group: item.layer.precompose_group.clone(),
                    precompose_role: item.layer.precompose_role.clone(),
                    file_path: item.layer.file_path.clone(),
                    is_video: item.layer.is_video,
                    video_time: item.layer.video_time,
                    fit: "stretch".to_string(),
                    dst_x: item.layer.dst_x,
                    dst_y: item.layer.dst_y,
                    dst_w: item.layer.dst_w,
                    dst_h: item.layer.dst_h,
                    src_x: item.layer.src_x,
                    src_y: item.layer.src_y,
                    src_w: item.layer.src_w,
                    src_h: item.layer.src_h,
                    opacity: item.layer.opacity,
                    blend_mode: item.layer.blend_mode.clone(),
                    reveal_progress: 1.0,
                    z_index: item.layer.z_index,
                    color: item.layer.color.clone().unwrap_or_default(),
                    mask_path: item.layer.mask_path.clone(),
                    mask_texture_id: None,
                    mask_opacity: item.layer.mask_opacity.unwrap_or(1.0).clamp(0.0, 1.0),
                    mask_inverted: item.layer.mask_inverted.unwrap_or(false),
                    mask_feather: item.layer.mask_feather.unwrap_or(0.0).clamp(0.0, 100.0),
                    mask_transform: item.layer.mask_transform.clone().unwrap_or(
                        crate::RenderMaskTransform {
                            scale: 1.0,
                            ..Default::default()
                        },
                    ),
                    pixel_stretch: item.layer.pixel_stretch.clone(),
                    transform: item.layer.transform.clone().unwrap_or_default(),
                    positioning: item.layer.positioning.clone(),
                    restore_lut_id: item.layer.restore_lut_id.clone(),
                    lut_id: item.layer.lut_id.clone(),
                    lut_intensity: item.layer.lut_intensity,
                    shape: item.layer.shape.clone(),
                    fill_color: item.layer.fill_color.clone(),
                    corner_radius: item.layer.corner_radius,
                    stroke_color: item.layer.stroke_color.clone(),
                    stroke_width: item.layer.stroke_width,
                    content: item.layer.content.clone(),
                    font_size: item.layer.font_size,
                    font_family: item.layer.font_family.clone(),
                    font_file: item.layer.font_file.clone(),
                    font_weight: item.layer.font_weight,
                    text_color: item.layer.text_color.clone(),
                    text_align: item.layer.text_align.clone(),
                    vertical_align: item.layer.vertical_align.clone(),
                },
                compositor::PreviewTextureInfo {
                    texture_id: item.texture.texture_id,
                    width: item.texture.width,
                    height: item.texture.height,
                },
            )
        })
        .collect();
    lock_preview(|c| {
        let planned = c.plan_preview(input.width, input.height, input.max_side, &layers)?;
        Ok(PreviewPlanOutput {
            width: planned.width,
            height: planned.height,
            layers: planned.layers,
        })
    })
}

pub fn destroy_compositor() -> napi::Result<()> {
    if let Ok(mut guard) = COMPOSITOR_PREVIEW.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = COMPOSITOR_EXPORT.lock() {
        *guard = None;
    }
    Ok(())
}
/// 取消指定导出任务
#[napi]
pub fn cancel_export_task(task_id: String) -> napi::Result<()> {
    export::cancel_task(&task_id);
    Ok(())
}

/// 查询导出任务进度（current_frame, total_frames）
#[napi]
pub fn get_export_task_progress(task_id: String) -> napi::Result<Option<Vec<u64>>> {
    let progress = export::task_progress(&task_id);
    Ok(progress.map(|(c, t)| vec![c, t]))
}
