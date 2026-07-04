mod compositor;
mod export;

use std::sync::{LazyLock, Mutex};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use compositor::Compositor;

// ── 跨模块日志宏 ──
macro_rules! log {
    ($($arg:tt)*) => {
        $crate::compositor::log_write(&format!($($arg)*))
    };
}
pub(crate) use log;

/// 全局单例 compositor
static COMPOSITOR: LazyLock<Mutex<Option<Compositor>>> =
    LazyLock::new(|| Mutex::new(None));

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
    pub dst_x: f64, pub dst_y: f64, pub dst_w: f64, pub dst_h: f64,
    pub src_x: f64, pub src_y: f64, pub src_w: f64, pub src_h: f64,
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
    pub dst_x: f64, pub dst_y: f64, pub dst_w: f64, pub dst_h: f64,
    /// 源裁剪区域（归一化 0-1）
    pub src_x: f64, pub src_y: f64, pub src_w: f64, pub src_h: f64,
    pub opacity: f64,
    pub z_index: i32,
}

// ─────────────── napi exports ───────────────

/// 初始化 GPU compositor
///
/// - `log_path`: 日志文件路径（可选，默认 luna-rc.log）
#[napi]
pub fn init_compositor(log_path: Option<String>) -> napi::Result<()> {
    let mut guard = COMPOSITOR.lock().map_err(|e| {
        napi::Error::from_reason(format!("lock: {}", e))
    })?;
    if guard.is_some() {
        return Ok(());
    }
    let c = Compositor::new(log_path.as_deref())
        .map_err(|e| napi::Error::from_reason(e))?;
    *guard = Some(c);
    Ok(())
}

/// 加载一张纹理到 GPU，返回 texture_id
#[napi]
pub fn load_texture(data: Buffer, width: u32, height: u32) -> napi::Result<u32> {
    let bytes: Vec<u8> = data.into();
    lock(|c| c.load_texture(&bytes, width, height))
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
            &ffmpeg_path, &ffprobe_path,
            &input, width, height,
            &static_layers, c,
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
) -> napi::Result<()> {
    lock(|c| {
        crate::log!("export: in={} out={} {}x{} static={}", input, output, width, height, static_layers.len());
        export::export_file(
            &ffmpeg_path, &ffprobe_path,
            &input, &output,
            width, height, fps, hardware,
            &video_layer, &static_layers,
            c,
        )
    })
}

/// 销毁 compositor
#[napi]
pub fn destroy_compositor() -> napi::Result<()> {
    let mut guard = COMPOSITOR.lock().map_err(|e| {
        napi::Error::from_reason(format!("lock: {}", e))
    })?;
    *guard = None;
    Ok(())
}
