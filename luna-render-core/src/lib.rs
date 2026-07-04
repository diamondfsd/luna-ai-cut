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

/// 画布上的一个渲染层
#[napi(object)]
#[derive(Clone)]
pub struct RenderLayer {
    /// 纹理 ID（通过 loadTexture / updateTexture 管理）
    pub texture_id: u32,

    /// 目标区域在画布上的位置和大小（归一化 0.0-1.0，相对画布宽高）
    pub dst_x: f64,
    pub dst_y: f64,
    pub dst_w: f64,
    pub dst_h: f64,

    /// 源裁剪区域（归一化 0.0-1.0，相对纹理自身宽高）
    pub src_x: f64,
    pub src_y: f64,
    pub src_w: f64,
    pub src_h: f64,

    /// 透明度 0.0-1.0
    pub opacity: f64,

    /// 层级（数值越大越在上层）
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

/// 导出视频
///
/// - `ffmpeg_path`: FFmpeg 二进制路径（由 Electron 主进程传入）
/// - `input_path`: 输入视频路径
/// - `output_path`: 输出视频路径
/// - `canvas_width` / `canvas_height`: 画布尺寸
/// - `fps`: 导出帧率（可选，默认取源视频帧率）
/// - `hardware`: 是否使用硬件编码
/// - `video_layer`: 视频帧的布局（纹理 ID 由 Rust 侧创建，忽略传入的 texture_id）
/// - `overlay_layers`: 静态叠加层（水印等，纹理已预加载，texture_id 保持不变）
#[napi]
pub fn export_video(
    ffmpeg_path: String,
    ffprobe_path: String,
    input_path: String,
    output_path: String,
    canvas_width: u32,
    canvas_height: u32,
    fps: Option<f64>,
    hardware: bool,
    video_layer: RenderLayer,
    overlay_layers: Vec<RenderLayer>,
) -> napi::Result<()> {
    lock(|c| {
        export::export_video(
            &ffmpeg_path,
            &ffprobe_path,
            &input_path,
            &output_path,
            canvas_width,
            canvas_height,
            fps,
            hardware,
            &video_layer,
            &overlay_layers,
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
