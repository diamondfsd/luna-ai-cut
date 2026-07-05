mod compositor;
mod export;
mod media;

use std::sync::{LazyLock, Mutex};

use crate::export::QualityPreset;
use compositor::Compositor;
use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Task};
use napi_derive::napi;

#[napi(object)]
pub struct TextureLoadResult {
    pub texture_id: u32,
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
#[derive(Clone, Default)]
pub struct RenderCurvePoint {
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
#[derive(Clone, Default)]
pub struct RenderToneCurveAdjust {
    pub rgb: Vec<RenderCurvePoint>,
    pub luminance: Vec<RenderCurvePoint>,
    pub red: Vec<RenderCurvePoint>,
    pub green: Vec<RenderCurvePoint>,
    pub blue: Vec<RenderCurvePoint>,
}

#[napi(object)]
#[derive(Clone, Default)]
pub struct RenderHslChannelAdjust {
    pub hue: f64,
    pub hue_shift: f64,
    pub saturation: f64,
    pub luminance: f64,
}

#[napi(object)]
#[derive(Clone)]
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
#[derive(Clone)]
pub struct RenderCropRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[napi(object)]
#[derive(Clone)]
pub struct RenderLayerTransform {
    pub crop: Option<RenderCropRect>,
    pub orientation: f64,
    pub rotate: f64,
    pub flip_h: bool,
    pub flip_v: bool,
    pub scale: f64,
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
        }
    }
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
    pub color: Option<RenderColorAdjustments>,
    pub transform: Option<RenderLayerTransform>,
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
    pub color: Option<RenderColorAdjustments>,
    pub transform: Option<RenderLayerTransform>,
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
    pub color: Option<RenderColorAdjustments>,
    pub transform: Option<RenderLayerTransform>,
}

/// render_preview 的输入
#[napi(object)]
#[derive(Clone)]
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
        export::render_layers_to_file(
            &ffmpeg_path,
            &output,
            width,
            height,
            &layers,
            &format,
            quality,
            c,
        )
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

/// 统一预览入口：传路径列表，Rust 内部解码 + 缓存 + 合成，返回 RGBA Buffer 和实际输出尺寸。
#[napi]
pub fn render_preview(input: RenderPreviewInput) -> napi::Result<RenderPreviewOutput> {
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
            color: l.color.clone().unwrap_or_default(),
            transform: l.transform.clone().unwrap_or_default(),
        })
        .collect();
    lock(|c| {
        let (data, width, height) = c.render_preview(
            &input.ffmpeg_path,
            &input.ffprobe_path,
            input.width,
            input.height,
            input.max_side,
            &layers,
        )?;
        Ok(RenderPreviewOutput {
            width,
            height,
            data: data.into(),
        })
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
            input,
            output,
            width,
            height,
            static_layers.len(),
            task_id,
            quality_preset
        );
        let preset = quality_preset.as_deref().map(QualityPreset::from_str);
        export::export_file(
            &ffmpeg_path,
            &ffprobe_path,
            &input,
            &output,
            width,
            height,
            fps,
            hardware,
            &video_layer,
            &static_layers,
            task_id.as_deref(),
            preset,
            c,
        )
    })
}

pub struct ExportFileTask {
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
}

impl Task for ExportFileTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        lock(|c| {
            crate::log!(
                "export async: in={} out={} {}x{} static={} task={:?} preset={:?}",
                self.input,
                self.output,
                self.width,
                self.height,
                self.static_layers.len(),
                self.task_id,
                self.quality_preset
            );
            let preset = self.quality_preset.as_deref().map(QualityPreset::from_str);
            export::export_file(
                &self.ffmpeg_path,
                &self.ffprobe_path,
                &self.input,
                &self.output,
                self.width,
                self.height,
                self.fps,
                self.hardware,
                &self.video_layer,
                &self.static_layers,
                self.task_id.as_deref(),
                preset,
                c,
            )
        })
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

/// 异步导出视频/图片（统一入口），避免阻塞 Electron 主进程事件循环。
#[napi]
pub fn export_file_async(
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
) -> AsyncTask<ExportFileTask> {
    AsyncTask::new(ExportFileTask {
        ffmpeg_path,
        ffprobe_path,
        input,
        output,
        width,
        height,
        fps,
        hardware,
        video_layer,
        static_layers,
        task_id,
        quality_preset,
    })
}

/// 从素材源文件直接导出图片（独立加载纹理，不依赖预览纹理缓存）
#[napi]
pub fn export_image_from_sources(
    ffmpeg_path: String,
    ffprobe_path: String,
    output: String,
    width: u32,
    height: u32,
    layers: Vec<PreviewLayer>,
    format: String,
    quality: f64,
) -> napi::Result<()> {
    lock(|c| {
        export::export_image_from_sources(
            &ffmpeg_path,
            &ffprobe_path,
            &output,
            width,
            height,
            &layers,
            &format,
            quality,
            c,
        )
    })
}

pub struct ExportImageFromSourcesTask {
    ffmpeg_path: String,
    ffprobe_path: String,
    output: String,
    width: u32,
    height: u32,
    layers: Vec<PreviewLayer>,
    format: String,
    quality: f64,
}

impl Task for ExportImageFromSourcesTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        lock(|c| {
            crate::log!(
                "export_image_from_sources async: out={} {}x{} layers={} fmt={} q={}",
                self.output,
                self.width,
                self.height,
                self.layers.len(),
                self.format,
                self.quality
            );
            export::export_image_from_sources(
                &self.ffmpeg_path,
                &self.ffprobe_path,
                &self.output,
                self.width,
                self.height,
                &self.layers,
                &self.format,
                self.quality,
                c,
            )
        })
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

/// 异步从素材源文件导出图片（避免阻塞主进程）
#[napi]
pub fn export_image_from_sources_async(
    ffmpeg_path: String,
    ffprobe_path: String,
    output: String,
    width: u32,
    height: u32,
    layers: Vec<PreviewLayer>,
    format: String,
    quality: f64,
) -> AsyncTask<ExportImageFromSourcesTask> {
    AsyncTask::new(ExportImageFromSourcesTask {
        ffmpeg_path,
        ffprobe_path,
        output,
        width,
        height,
        layers,
        format,
        quality,
    })
}

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
/// 素材颜色信息（分层检测：HDR ↔ 宽色域 ↔ 高位深，互不混淆）
#[napi(object)]
pub struct ColorInfo {
    pub is_hdr: bool,
    pub is_wide_gamut: bool,
    pub is_high_bit_depth: bool,
    pub color_primaries: String,
    pub color_transfer: String,
    pub color_space: String,
    pub bit_depth: u32,
    pub width: u32,
    pub height: u32,
}

fn contains_any(s: &str, keys: &[&str]) -> bool {
    let lower = s.to_lowercase();
    keys.iter().any(|k| lower.contains(k))
}

/// 解析后的渲染源
#[napi(object)]
pub struct ResolvedRenderSource {
    pub render_path: String,
    pub normalized: bool,
    pub width: u32,
    pub height: u32,
    pub color_primaries: String,
    pub color_transfer: String,
}

/// 检测素材颜色信息
fn probe_color_info(ffprobe: &str, path: &str) -> Result<ColorInfo, String> {
    use std::process::{Command, Stdio};

    let output = Command::new(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_frames",
            "-read_intervals",
            "%+#1",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe: {}", e))?;
    if !output.status.success() {
        return Err(format!("ffprobe exit: {}", output.status));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    crate::log!("resolve_render_source: ffprobe output: {}", stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("json: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;
    let vs = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or("no video stream")?;
    let frames = parsed["frames"].as_array();

    let w = vs["width"].as_u64().unwrap_or(0) as u32;
    let h = vs["height"].as_u64().unwrap_or(0) as u32;
    let primaries = vs["color_primaries"].as_str().unwrap_or("").to_string();
    let transfer = vs["color_transfer"].as_str().unwrap_or("").to_string();
    let colorspace = vs["color_space"].as_str().unwrap_or("").to_string();
    let bit_depth = vs["bits_per_raw_sample"].as_u64().unwrap_or(8) as u32;

    // ── 传输函数判断（HDR 强信号）──
    let is_pq = contains_any(
        &transfer,
        &[
            "2084",
            "smpte2084",
            "smpte st 2084",
            "pq",
            "perceptual quantizer",
        ],
    );
    let is_hlg = contains_any(&transfer, &["hlg", "arib", "b67", "arib-std-b67"]);

    // ── 色域判断 ──
    let is_bt2020 = contains_any(&primaries, &["2020", "bt2020", "bt.2020", "rec.2020"]);
    let is_display_p3 = contains_any(&primaries, &["p3", "display-p3", "display p3", "dcip3"]);

    // ── Gain Map / Adaptive Gain Curve 检测 ──
    let mut has_gain_map = false;
    let mut has_adaptive_gain_curve = false;
    if let Some(frames_arr) = frames {
        for frame in frames_arr {
            if let Some(tags) = frame["tags"].as_object() {
                for (k, v) in tags {
                    let key = k.to_lowercase();
                    let val = v.as_str().unwrap_or("").to_lowercase();
                    if key.contains("gain") || val.contains("gain") {
                        has_gain_map = true;
                    }
                    if key.contains("adaptive") || val.contains("adaptive") {
                        has_adaptive_gain_curve = true;
                    }
                }
            }
            if let Some(sd_list) = frame["side_data_list"].as_array() {
                for sd in sd_list {
                    if let Some(st) = sd["side_data_type"].as_str() {
                        let stl = st.to_lowercase();
                        if stl.contains("gain") || stl.contains("hdr") {
                            has_gain_map = true;
                        }
                        if stl.contains("adaptive") {
                            has_adaptive_gain_curve = true;
                        }
                    }
                }
            }
        }
    }

    // ── 分层结果 ──
    let is_hdr_transfer = is_pq || is_hlg;
    let is_wide_gamut = is_bt2020 || is_display_p3;
    let is_high_bit_depth = bit_depth > 8;
    let is_hdr = is_hdr_transfer || has_gain_map || has_adaptive_gain_curve;

    Ok(ColorInfo {
        is_hdr,
        is_wide_gamut,
        is_high_bit_depth,
        color_primaries: primaries,
        color_transfer: transfer,
        color_space: colorspace,
        bit_depth,
        width: w,
        height: h,
    })
}

/// 统一解析渲染源：检测 HDR / 宽色域并自动 normalize 为 SDR sRGB 中间图
///
/// - 普通 SDR sRGB：直接返回原路径
/// - 宽色域 SDR（P3/BT.2020）：只做色域转换，不做 tone mapping
/// - HDR（PQ/HLG/GainMap）：HDR→SDR tone mapping + 色域转换
///
/// 预览和导出都应使用 renderPath，保证颜色一致。
#[napi]
pub fn resolve_render_source(
    ffmpeg_path: String,
    ffprobe_path: String,
    original_path: String,
    cache_dir: String,
) -> napi::Result<ResolvedRenderSource> {
    use std::io::Write;
    use std::path::Path;
    use std::process::{Command, Stdio};

    crate::log!(
        "resolve_render_source: input path={} cache={}",
        original_path,
        cache_dir
    );

    let color_info = probe_color_info(&ffprobe_path, &original_path)
        .map_err(|e| napi::Error::from_reason(format!("探测颜色信息失败: {}", e)))?;

    crate::log!("resolve_render_source: color_info is_hdr={} is_wide_gamut={} is_high_bit_depth={} primaries={} transfer={} colorspace={} bit_depth={} size={}x{}",
        color_info.is_hdr, color_info.is_wide_gamut, color_info.is_high_bit_depth,
        color_info.color_primaries, color_info.color_transfer, color_info.color_space,
        color_info.bit_depth, color_info.width, color_info.height);

    // 普通 sRGB SDR → 直接返回原路径
    if !color_info.is_hdr && !color_info.is_wide_gamut {
        crate::log!("resolve_render_source: sRGB SDR, using original path");
        return Ok(ResolvedRenderSource {
            render_path: original_path.clone(),
            normalized: false,
            width: color_info.width,
            height: color_info.height,
            color_primaries: color_info.color_primaries,
            color_transfer: color_info.color_transfer,
        });
    }

    // 生成缓存文件名（基于原始路径 hash）
    use std::hash::{Hash, Hasher};
    let cache_dir = Path::new(&cache_dir).join("color-normalized");
    let _ = std::fs::create_dir_all(&cache_dir);

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    original_path.hash(&mut hasher);
    let hash = hasher.finish();

    let cache_path = cache_dir.join(format!("{:016x}_sdr_srgb.png", hash));
    let cache_str = cache_path.to_string_lossy().to_string();

    crate::log!("resolve_render_source: checking cache {}", cache_str);
    if cache_path.exists() {
        crate::log!("resolve_render_source: cache HIT");
        return Ok(ResolvedRenderSource {
            render_path: cache_str,
            normalized: true,
            width: color_info.width,
            height: color_info.height,
            color_primaries: "bt709".to_string(),
            color_transfer: "bt709".to_string(),
        });
    }

    // ── 构造 ffmpeg normalize 命令 ──
    let zscale_available = Command::new(&ffmpeg_path)
        .args(["-filters"])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .output()
        .map(|o| {
            let avail = String::from_utf8_lossy(&o.stderr).contains("zscale");
            crate::log!("resolve_render_source: zscale_available={}", avail);
            avail
        })
        .unwrap_or(false);

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(["-y", "-i", &original_path]);

    let mut cmd_log = format!("{} -y -i {}", ffmpeg_path, original_path);

    if color_info.is_hdr {
        crate::log!(
            "resolve_render_source: HDR detected, tone mapping {} → {}",
            original_path,
            cache_str
        );
        if zscale_available {
            cmd.args(["-vf", "zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709:p=bt709:m=bt709,format=rgb24"]);
            cmd_log += " -vf zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709:p=bt709:m=bt709,format=rgb24";
        } else {
            crate::log!("resolve_render_source: zscale not available, using basic conversion");
            cmd.args([
                "-vf",
                "setparams=color_primaries=bt709:color_trc=bt709,format=rgb24",
            ]);
            cmd_log += " -vf setparams=color_primaries=bt709:color_trc=bt709,format=rgb24";
        }
    } else if color_info.is_wide_gamut {
        crate::log!(
            "resolve_render_source: wide gamut SDR detected, gamut convert {} → {}",
            original_path,
            cache_str
        );
        if zscale_available {
            cmd.args(["-vf", "zscale=p=bt709:t=bt709:m=bt709,format=rgb24"]);
            cmd_log += " -vf zscale=p=bt709:t=bt709:m=bt709,format=rgb24";
        } else {
            cmd.args([
                "-vf",
                "setparams=color_primaries=bt709:color_trc=bt709,format=rgb24",
            ]);
            cmd_log += " -vf setparams=color_primaries=bt709:color_trc=bt709,format=rgb24";
        }
    }

    cmd_log += " ";
    cmd_log += &cache_str;
    crate::log!("resolve_render_source: ffmpeg cmd: {}", cmd_log);

    cmd.arg(&cache_str)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| napi::Error::from_reason(format!("ffmpeg normalize 启动失败: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = format!("ffmpeg normalize 失败：{} stderr={}", output.status, stderr);
        crate::log!("{}", msg);
        return Ok(ResolvedRenderSource {
            render_path: original_path.clone(),
            normalized: false,
            width: color_info.width,
            height: color_info.height,
            color_primaries: color_info.color_primaries,
            color_transfer: color_info.color_transfer,
        });
    }

    crate::log!(
        "resolve_render_source: normalized OK → {} width={} height={}",
        cache_str,
        color_info.width,
        color_info.height
    );

    Ok(ResolvedRenderSource {
        render_path: cache_str,
        normalized: true,
        width: color_info.width,
        height: color_info.height,
        color_primaries: "bt709".to_string(),
        color_transfer: "bt709".to_string(),
    })
}
