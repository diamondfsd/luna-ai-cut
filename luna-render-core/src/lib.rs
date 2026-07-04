mod compositor;
mod export;

use std::sync::{LazyLock, Mutex};

use compositor::Compositor;
use napi::bindgen_prelude::Buffer;
use crate::export::QualityPreset;
use napi_derive::napi;

#[napi(object)]
pub struct TextureLoadResult {
    pub texture_id: u32,
    pub width: u32,
    pub height: u32,
}

// ── 跨模块日志宏 ──
macro_rules! log {
    ($($arg:tt)*) => {
        $crate::compositor::log_write(&format!($($arg)*))
    };
}
pub(crate) use log;

/// 全局单例 compositor
static COMPOSITOR: LazyLock<Mutex<Option<Compositor>>> = LazyLock::new(|| Mutex::new(None));

fn lock<T>(f: impl FnOnce(&mut Compositor) -> Result<T, String>) -> napi::Result<T> {
    let mut guard = COMPOSITOR.lock().map_err(|e| {
        let msg = format!("lock: {}", e);
        compositor::log_error(&msg);
        napi::Error::from_reason(msg)
    })?;
    let c = guard.as_mut().ok_or_else(|| {
        let msg = "compositor not initialized, call initCompositor() first".to_string();
        compositor::log_error(&msg);
        napi::Error::from_reason(msg)
    })?;
    f(c).map_err(|e| {
        compositor::log_error(&e);
        napi::Error::from_reason(e.to_string())
    })
}

// ─────────────── napi 结构体 ───────────────

/// 画布上的一个渲染层（预览用，纹理已由 JS 预加载）
#[napi(object)]
#[derive(Clone)]
pub struct RenderLayer {
    pub texture_id: u32,
    pub dst_x: f64,
    pub dst_y: f64,
    pub dst_w: f64,
    pub dst_h: f64,
    pub src_x: f64,
    pub src_y: f64,
    pub src_w: f64,
    pub src_h: f64,
    pub opacity: f64,
    pub z_index: i32,
}

/// 静态叠加层 — 导出用，传文件绝对路径，Rust 内部加载+渲染
#[napi(object)]
#[derive(Clone)]
pub struct StaticLayer {
    /// 图片文件绝对路径（水印、贴纸等）
    pub image_path: String,
    /// 目标区域（归一化 0-1）
    pub dst_x: f64,
    pub dst_y: f64,
    pub dst_w: f64,
    pub dst_h: f64,
    /// 源裁剪区域（归一化 0-1）
    pub src_x: f64,
    pub src_y: f64,
    pub src_w: f64,
    pub src_h: f64,
    pub opacity: f64,
    pub z_index: i32,
}

/// 预览层 — render_preview 的统一层描述
#[napi(object)]
#[derive(Clone)]
pub struct PreviewLayer {
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
    pub z_index: i32,
}

/// render_preview 的输入
#[napi(object)]
#[derive(Clone)]
pub struct RenderPreviewInput {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub width: u32,
    pub height: u32,
    pub layers: Vec<PreviewLayer>,
}

// ─────────────── napi exports ───────────────

/// 初始化 GPU compositor
///
/// - `log_path`: 日志文件路径（可选，默认 luna-rc.log）
#[napi]
pub fn init_compositor(log_path: Option<String>) -> napi::Result<()> {
    let mut guard = COMPOSITOR
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {}", e)))?;
    if guard.is_some() {
        return Ok(());
    }
    let c = Compositor::new(log_path.as_deref()).map_err(|e| napi::Error::from_reason(e))?;
    *guard = Some(c);
    Ok(())
}

/// 加载一张纹理到 GPU，返回 texture_id
#[napi]
pub fn load_texture(data: Buffer, width: u32, height: u32) -> napi::Result<u32> {
    let bytes: Vec<u8> = data.into();
    lock(|c| c.load_texture(&bytes, width, height))
}

/// 从本地图片路径加载预览纹理，native 内部通过 ffmpeg 解码并等比缩小后上传 GPU。
#[napi]
pub fn load_texture_from_path(
    ffmpeg_path: String,
    ffprobe_path: String,
    path: String,
    max_size: u32,
) -> napi::Result<TextureLoadResult> {
    lock(|c| {
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
    lock(|c| c.update_texture(texture_id, &bytes))
}

/// 释放纹理
#[napi]
pub fn release_texture(texture_id: u32) -> napi::Result<()> {
    lock(|c| c.release_texture(texture_id))
}

/// 渲染一帧
#[napi]
pub fn render_frame(
    canvas_width: u32,
    canvas_height: u32,
    layers: Vec<RenderLayer>,
) -> napi::Result<Buffer> {
    let result = lock(|c| c.render(canvas_width, canvas_height, &layers))?;
    Ok(result.into())
}

/// 渲染已有纹理并直接编码保存到文件（不返回像素数据）
///
/// 和 render_frame 使用相同的渲染算法，区别在于：
/// - 渲染后直接通过 ffmpeg 编码为 JPEG/PNG/WebP 写入磁盘
/// - 不返回像素数据到 JS，避免大块内存传输
#[napi]
pub fn render_layers_to_file(
    ffmpeg_path: String,
    output: String,
    width: u32,
    height: u32,
    layers: Vec<RenderLayer>,
    format: String,
    quality: f64,
) -> napi::Result<()> {
    lock(|c| {
        export::render_layers_to_file(&ffmpeg_path, &output, width, height, &layers, &format, quality, c)
    })
}

/// 预览一帧 — 和 export_file 同样的参数，但返回 RGBA Buffer 而非编码输出
///
/// JS 只传 JSON：文件路径 + 层参数。Rust 解码 → renderFrame → 返回 RGBA。
#[napi]
pub fn preview_file(
    ffmpeg_path: String,
    ffprobe_path: String,
    input: String,
    width: u32,
    height: u32,
    static_layers: Vec<StaticLayer>,
) -> napi::Result<Buffer> {
    lock(|c| {
        let result = export::preview_file(
            &ffmpeg_path,
            &ffprobe_path,
            &input,
            width,
            height,
            &static_layers,
            c,
        )?;
        Ok(result.into())
    })
}

/// 统一预览入口：传路径列表，Rust 内部解码 + 缓存 + 合成，返回 RGBA Buffer。
#[napi]
pub fn render_preview(input: RenderPreviewInput) -> napi::Result<Buffer> {
    let layers: Vec<compositor::PreviewLayerInput> = input
        .layers
        .iter()
        .map(|l| compositor::PreviewLayerInput {
            file_path: l.file_path.clone(),
            is_video: l.is_video,
            video_time: l.video_time,
            dst_x: l.dst_x,
            dst_y: l.dst_y,
            dst_w: l.dst_w,
            dst_h: l.dst_h,
            src_x: l.src_x,
            src_y: l.src_y,
            src_w: l.src_w,
            src_h: l.src_h,
            opacity: l.opacity,
            z_index: l.z_index,
        })
        .collect();
    lock(|c| {
        let result = c.render_preview(
            &input.ffmpeg_path,
            &input.ffprobe_path,
            input.width,
            input.height,
            &layers,
        )?;
        Ok(result.into())
    })
}

/// 导出视频/图片（统一入口）
#[napi]
pub fn export_file(
    ffmpeg_path: String,
    ffprobe_path: String,
    input: String,
    output: String,
    width: u32,
    height: u32,
    fps: Option<f64>,
    hardware: bool,
    video_layer: RenderLayer,
    static_layers: Vec<StaticLayer>,
    task_id: Option<String>,
    quality_preset: Option<String>,
) -> napi::Result<()> {
    lock(|c| {
        crate::log!(
            "export: in={} out={} {}x{} static={} task={:?} preset={:?}",
            input, output, width, height, static_layers.len(), task_id, quality_preset
        );
        let preset = quality_preset.as_deref().map(QualityPreset::from_str);
        export::export_file(
            &ffmpeg_path, &ffprobe_path,
            &input, &output,
            width, height,
            fps, hardware,
            &video_layer, &static_layers,
            task_id.as_deref(), preset,
            c,
        )
    })
}

/// 销毁 compositor
#[napi]
pub fn destroy_compositor() -> napi::Result<()> {
    let mut guard = COMPOSITOR
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("lock: {}", e)))?;
    *guard = None;
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

