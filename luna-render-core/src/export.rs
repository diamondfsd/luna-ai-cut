//! 统一导出 — Rust 内部完成全部加载+渲染+编码

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use crate::compositor::Compositor;
use crate::media::probe_video_info;
use crate::{PreviewLayer, RenderLayer, StaticLayer};

const IMAGE_EXPORT_MAX_EDGE: u32 = 8192;

// ── 多任务导出状态 ──

struct TaskProcs {
    decode: Option<std::process::Child>,
    encode: Option<std::process::Child>,
}

pub struct TaskState {
    cancel: AtomicBool,
    pub current_frame: AtomicU64,
    pub total_frames: AtomicU64,
    procs: Mutex<TaskProcs>,
}

impl TaskState {
    fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            current_frame: AtomicU64::new(0),
            total_frames: AtomicU64::new(0),
            procs: Mutex::new(TaskProcs {
                decode: None,
                encode: None,
            }),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn store_procs(&self, decode: std::process::Child, encode: std::process::Child) {
        if let Ok(mut procs) = self.procs.lock() {
            procs.decode = Some(decode);
            procs.encode = Some(encode);
        }
    }

    pub fn take_procs(&self) -> (Option<std::process::Child>, Option<std::process::Child>) {
        if let Ok(mut procs) = self.procs.lock() {
            (procs.decode.take(), procs.encode.take())
        } else {
            (None, None)
        }
    }
}

static EXPORT_TASKS: LazyLock<Mutex<HashMap<String, Arc<TaskState>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 注册导出任务，返回 TaskState 供内部读写
pub fn register_task(task_id: &str) -> Arc<TaskState> {
    let state = Arc::new(TaskState::new());
    if let Ok(mut map) = EXPORT_TASKS.lock() {
        map.insert(task_id.to_string(), state.clone());
    }
    state
}

/// 取消指定任务
pub fn cancel_task(task_id: &str) {
    if let Ok(map) = EXPORT_TASKS.lock() {
        if let Some(state) = map.get(task_id) {
            state.cancel.store(true, Ordering::SeqCst);
            if let Ok(mut procs) = state.procs.lock() {
                if let Some(ref mut p) = procs.decode {
                    let _ = p.kill();
                }
                if let Some(ref mut p) = procs.encode {
                    let _ = p.kill();
                }
            }
        }
    }
}

/// 查询任务进度
pub fn task_progress(task_id: &str) -> Option<(u64, u64)> {
    EXPORT_TASKS.lock().ok().and_then(|map| {
        map.get(task_id).map(|s| {
            (
                s.current_frame.load(Ordering::Relaxed),
                s.total_frames.load(Ordering::Relaxed),
            )
        })
    })
}

/// 清理已完成的任务状态
pub fn cleanup_task(task_id: &str) {
    if let Ok(mut map) = EXPORT_TASKS.lock() {
        map.remove(task_id);
    }
}

// ── 质量预设 ──

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum QualityPreset {
    Small,
    Standard,
    High,
    OriginalLike,
}

impl QualityPreset {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "small" => QualityPreset::Small,
            "high" => QualityPreset::High,
            "original-like" | "originallike" => QualityPreset::OriginalLike,
            _ => QualityPreset::Standard,
        }
    }
}

// ── 编码器探测 ──

/// 运行时探测 FFmpeg 支持的 h264 编码器，按优先级返回可用列表
fn detect_h264_encoders(ffmpeg: &str) -> Vec<String> {
    let output = match Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .output()
    {
        Ok(o) => o,
        Err(_) => return vec!["libx264".to_string()],
    };
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut available: Vec<String> = Vec::new();

    // 硬件编码器匹配检测
    let hw_encoders = [
        "h264_videotoolbox",
        "h264_nvenc",
        "h264_qsv",
        "h264_amf",
        "h264_vaapi",
    ];
    for name in &hw_encoders {
        if stderr.contains(name) {
            available.push(name.to_string());
        }
    }

    // libx264 是万能降级（ffmpeg 几乎一定有）
    available.push("libx264".to_string());

    crate::log!("detect_h264_encoders: available={:?}", available);
    available
}

/// 选择最佳编码器
fn choose_encoder(ffmpeg: &str, prefer_hw: bool) -> String {
    let available = detect_h264_encoders(ffmpeg);
    if !prefer_hw {
        return "libx264".to_string();
    }
    // 按平台偏好排序
    let pref_order: &[&str] = if cfg!(target_os = "macos") {
        &["h264_videotoolbox", "h264_nvenc", "h264_qsv", "libx264"]
    } else if cfg!(target_os = "windows") {
        &["h264_nvenc", "h264_qsv", "h264_amf", "libx264"]
    } else {
        &["h264_nvenc", "h264_qsv", "h264_vaapi", "libx264"]
    };
    for name in pref_order {
        if available.iter().any(|a| a == name) {
            return name.to_string();
        }
    }
    "libx264".to_string()
}

// ── 码率计算 ──

/// 按分辨率和帧率估算默认码率（bps）
fn default_bitrate(width: u32, height: u32, fps: f64) -> u32 {
    let pixels = width as u64 * height as u64;
    let fps_val = fps as u64;
    // 经验公式：每像素约 0.1 bit/frame，再乘以系数
    let base = (pixels * fps_val) / 10;
    // 限幅
    if base < 5_000_000 {
        5_000_000
    } else if base > 100_000_000 {
        100_000_000
    } else {
        base as u32
    }
}

/// 按质量预设计算目标码率
fn choose_bitrate(
    width: u32,
    height: u32,
    fps: f64,
    src_bitrate: u32,
    preset: QualityPreset,
) -> u32 {
    let default = default_bitrate(width, height, fps);
    match preset {
        QualityPreset::Small => default / 2,
        QualityPreset::Standard => default,
        QualityPreset::High => (default * 15) / 10,
        QualityPreset::OriginalLike => {
            if src_bitrate > 0 {
                src_bitrate.max(default)
            } else {
                default * 2
            }
        }
    }
}

/// 用 FFmpeg 解码图片到 RGBA
fn decode_image(ffmpeg: &str, ffprobe: &str, path: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("json: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;
    let vs = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or("no video stream")?;
    let w = vs["width"].as_u64().unwrap_or(1920) as u32;
    let h = vs["height"].as_u64().unwrap_or(1080) as u32;

    let mut proc = Command::new(ffmpeg)
        .args([
            "-i",
            path,
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{}x{}", w, h),
            "-vframes",
            "1",
            "pipe:1",
            "-loglevel",
            "error",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn decode: {}", e))?;
    let mut buf = vec![];
    proc.stdout
        .take()
        .unwrap()
        .read_to_end(&mut buf)
        .map_err(|e| format!("read: {}", e))?;
    proc.wait().ok();
    Ok((buf, w, h))
}

/// 用 FFmpeg 解码图片到 RGBA，限制最大边长（保持宽高比）
fn decode_image_scaled(
    ffmpeg: &str,
    ffprobe: &str,
    path: &str,
    max_size: u32,
) -> Result<(Vec<u8>, u32, u32), String> {
    let (_, src_w, src_h) = decode_image(ffmpeg, ffprobe, path)?;
    let max_edge = src_w.max(src_h);
    let (dw, dh) = if max_edge > max_size {
        let s = max_size as f64 / max_edge as f64;
        (
            (src_w as f64 * s).round().max(1.0) as u32,
            (src_h as f64 * s).round().max(1.0) as u32,
        )
    } else {
        (src_w, src_h)
    };
    let expected = (dw * dh * 4) as usize;
    let mut proc = Command::new(ffmpeg)
        .args([
            "-i",
            path,
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{}x{}", dw, dh),
            "-vframes",
            "1",
            "pipe:1",
            "-loglevel",
            "error",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn: {}", e))?;
    let mut buf = vec![0u8; expected];
    proc.stdout
        .take()
        .unwrap()
        .read_exact(&mut buf)
        .map_err(|e| format!("read: {}", e))?;
    proc.wait().ok();
    Ok((buf, dw, dh))
}

fn capped_image_export_size(width: u32, height: u32, c: &Compositor) -> (u32, u32) {
    let max_edge = IMAGE_EXPORT_MAX_EDGE.min(c.max_texture_size()).max(1);
    let current_edge = width.max(height);
    if current_edge <= max_edge {
        return (width, height);
    }

    let scale = max_edge as f64 / current_edge as f64;
    let capped_width = (width as f64 * scale).round().max(1.0) as u32;
    let capped_height = (height as f64 * scale).round().max(1.0) as u32;
    crate::log!(
        "  image export size capped: {}x{} -> {}x{} max_edge={}",
        width,
        height,
        capped_width,
        capped_height,
        max_edge
    );
    (capped_width, capped_height)
}

/// 从素材源文件直接导出图片（独立加载纹理，不依赖预览纹理缓存）
///
/// 预览和导出算法完全一致，但资源完全隔离：
/// - 不接受 textureId，只接受 filePath
/// - Rust 内部按目标分辨率加载纹理
/// - 导出结束自动释放纹理，不影响预览缓存
pub fn export_image_from_sources(
    ffmpeg: &str,
    ffprobe: &str,
    output: &str,
    width: u32,
    height: u32,
    layers: &[PreviewLayer],
    format: &str,
    quality: f64,
    c: &mut Compositor,
) -> Result<(), String> {
    crate::log!(
        "export_image_from_sources: out={} {}x{} layers={} fmt={} q={}",
        output,
        width,
        height,
        layers.len(),
        format,
        quality
    );

    let (render_width, render_height) = capped_image_export_size(width, height, c);
    let target_max = render_width.max(render_height);
    let mut temp_tex = Vec::new();
    let mut render_layers = Vec::new();

    for layer in layers {
        // 跳过视频层（视频纹理由浏览器解码，不支持导出时重新加载）
        if layer.is_video {
            continue;
        }

        let (rgba, iw, ih) = decode_image_scaled(ffmpeg, ffprobe, &layer.file_path, target_max)
            .map_err(|e| format!("decode {}: {}", layer.file_path, e))?;
        let tex_id = c.load_texture(&rgba, iw, ih)?;
        temp_tex.push(tex_id);

        render_layers.push(RenderLayer {
            texture_id: tex_id,
            dst_x: layer.dst_x,
            dst_y: layer.dst_y,
            dst_w: layer.dst_w,
            dst_h: layer.dst_h,
            src_x: layer.src_x,
            src_y: layer.src_y,
            src_w: layer.src_w,
            src_h: layer.src_h,
            opacity: layer.opacity,
            z_index: layer.z_index,
            color: layer.color.clone(),
            transform: layer.transform.clone(),
        });
    }

    if render_layers.is_empty() {
        return Err("no valid layers for export".to_string());
    }

    let result = c.render(render_width, render_height, &render_layers)?;

    // 编码写文件（复用 render_layers_to_file 的编码逻辑）
    let q = format!("{:.0}", quality.clamp(1.0, 100.0));
    let mut args: Vec<String> = vec![
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "rgba".into(),
        "-s".into(),
        format!("{}x{}", render_width, render_height),
        "-i".into(),
        "pipe:0".into(),
        "-frames:v".into(),
        "1".into(),
        "-y".into(),
        "-loglevel".into(),
        "error".into(),
    ];
    match format {
        "jpeg" | "jpg" => {
            let ffmpeg_q = ((100.0 - quality.clamp(1.0, 100.0)) * 24.0 / 99.0 + 1.0) as u32;
            args.extend_from_slice(&[
                "-c:v".into(),
                "mjpeg".into(),
                "-q:v".into(),
                ffmpeg_q.to_string(),
            ]);
        }
        "png" => {
            args.extend_from_slice(&["-c:v".into(), "png".into()]);
        }
        "webp" => {
            args.extend_from_slice(&["-c:v".into(), "libwebp".into(), "-quality".into(), q]);
        }
        _ => return Err(format!("unsupported format: {}", format)),
    }
    args.push(output.into());

    let mut proc = Command::new(ffmpeg)
        .args(&args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("encode spawn: {}", e))?;
    proc.stdin
        .take()
        .unwrap()
        .write_all(&result)
        .map_err(|e| format!("encode write: {}", e))?;
    proc.wait().ok();

    // 清理临时纹理
    for tex_id in temp_tex {
        c.release_texture(tex_id).ok();
    }

    crate::log!("  export_image_from_sources done: {}", output);
    Ok(())
}

/// 预览一帧 — 和 export_file 同样的加载+渲染，返回 RGBA Buffer
pub fn preview_file(
    ffmpeg: &str,
    ffprobe: &str,
    input: &str,
    cw: u32,
    ch: u32,
    static_layers: &[StaticLayer],
    c: &mut Compositor,
) -> Result<Vec<u8>, String> {
    crate::log!(
        "preview: {} {}x{} static={}",
        input,
        cw,
        ch,
        static_layers.len()
    );

    let (rgba, iw, ih) = decode_image(ffmpeg, ffprobe, input)?;
    let img_tex = c
        .load_texture(&rgba, iw, ih)
        .map_err(|e| format!("img: {}", e))?;

    let mut layers = vec![RenderLayer {
        texture_id: img_tex,
        dst_x: 0.0,
        dst_y: 0.0,
        dst_w: 1.0,
        dst_h: 1.0,
        src_x: 0.0,
        src_y: 0.0,
        src_w: 1.0,
        src_h: 1.0,
        opacity: 1.0,
        z_index: 0,
        color: None,
        transform: None,
    }];
    layers.extend(load_static_layers(ffmpeg, ffprobe, static_layers, c)?);

    let result = c
        .render(cw, ch, &layers)
        .map_err(|e| format!("render: {}", e))?;

    c.release_texture(img_tex).ok();
    for l in &layers[1..] {
        c.release_texture(l.texture_id).ok();
    }
    Ok(result)
}

/// 统一导出入口
pub fn export_file(
    ffmpeg: &str,
    ffprobe: &str,
    input: &str,
    output: &str,
    canvas_w: u32,
    canvas_h: u32,
    fps: Option<f64>,
    hardware: bool,
    video_layer: &RenderLayer,
    static_layers: &[StaticLayer],
    task_id: Option<&str>,
    quality_preset: Option<QualityPreset>,
    c: &mut Compositor,
) -> Result<(), String> {
    // 注册任务
    let task = task_id.and_then(|id| {
        let s = register_task(id);
        s.total_frames.store(1, Ordering::SeqCst); // 占位，视频导出时会覆盖
        Some(s)
    });
    let preset = quality_preset.unwrap_or(QualityPreset::High);

    let result = if input.to_lowercase().ends_with(".png")
        || input.to_lowercase().ends_with(".jpg")
        || input.to_lowercase().ends_with(".jpeg")
        || input.to_lowercase().ends_with(".webp")
    {
        crate::log!("export: image mode {} → {}", input, output);
        export_image(
            ffmpeg,
            ffprobe,
            input,
            output,
            canvas_w,
            canvas_h,
            video_layer,
            static_layers,
            c,
        )
    } else {
        crate::log!(
            "export: video mode {} → {} preset={:?}",
            input,
            output,
            preset
        );
        export_video(
            ffmpeg,
            ffprobe,
            input,
            output,
            canvas_w,
            canvas_h,
            fps,
            hardware,
            video_layer,
            static_layers,
            c,
            preset,
            task.as_deref(),
        )
    };

    // 清理任务状态
    if let Some(id) = task_id {
        cleanup_task(id);
    }
    result
}

/// 加载所有静态层（内部 FFmpeg decode + 上传 wgpu）
fn load_static_layers(
    ffmpeg: &str,
    ffprobe: &str,
    layers: &[StaticLayer],
    c: &mut Compositor,
) -> Result<Vec<RenderLayer>, String> {
    let mut result = vec![];
    for sl in layers {
        crate::log!("  load static: {}", sl.image_path);
        let (rgba, _w, _h) = decode_image(ffmpeg, ffprobe, &sl.image_path)?;
        let tex = c
            .load_texture(&rgba, _w, _h)
            .map_err(|e| format!("load {}: {}", sl.image_path, e))?;
        crate::log!("    tex={} {}x{}", tex, _w, _h);
        result.push(RenderLayer {
            texture_id: tex,
            dst_x: sl.dst_x,
            dst_y: sl.dst_y,
            dst_w: sl.dst_w,
            dst_h: sl.dst_h,
            src_x: sl.src_x,
            src_y: sl.src_y,
            src_w: sl.src_w,
            src_h: sl.src_h,
            opacity: sl.opacity,
            z_index: sl.z_index,
            color: sl.color.clone(),
            transform: sl.transform.clone(),
        });
    }
    Ok(result)
}

/// 直接渲染已有纹理到文件（不重新加载源文件）
///
/// JS 侧已有纹理（通过 loadTexture / loadTextureFromPath 加载），
/// 此函数只做：render → encode → save，全部在 Rust 完成。
pub fn render_layers_to_file(
    ffmpeg: &str,
    output: &str,
    width: u32,
    height: u32,
    layers: &[RenderLayer],
    format: &str,
    quality: f64,
    c: &mut Compositor,
) -> Result<(), String> {
    crate::log!(
        "render_layers_to_file: out={} {}x{} layers={} fmt={} q={}",
        output,
        width,
        height,
        layers.len(),
        format,
        quality
    );

    let (render_width, render_height) = capped_image_export_size(width, height, c);
    let result = c.render(render_width, render_height, layers)?;

    // ── ffmpeg 编码 ──
    // JPEG: -q:v 2-31 (2=最高质量), PNG: 无损
    let q = format!("{:.0}", quality.clamp(1.0, 100.0));
    let mut args: Vec<String> = vec![
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "rgba".into(),
        "-s".into(),
        format!("{}x{}", render_width, render_height),
        "-i".into(),
        "pipe:0".into(),
        "-frames:v".into(),
        "1".into(),
        "-y".into(),
        "-loglevel".into(),
        "error".into(),
    ];

    match format {
        "jpeg" | "jpg" => {
            // ffmpeg -q:v 1-31，1=最高。将 quality(1-100)映射到 1-25
            let ffmpeg_q = ((100.0 - quality.clamp(1.0, 100.0)) * 24.0 / 99.0 + 1.0) as u32;
            args.extend_from_slice(&[
                "-c:v".into(),
                "mjpeg".into(),
                "-q:v".into(),
                ffmpeg_q.to_string(),
            ]);
        }
        "png" => {
            args.extend_from_slice(&["-c:v".into(), "png".into()]);
        }
        "webp" => {
            args.extend_from_slice(&["-c:v".into(), "libwebp".into(), "-quality".into(), q]);
        }
        _ => return Err(format!("unsupported export format: {}", format)),
    }
    args.push(output.into());

    let mut proc = Command::new(ffmpeg)
        .args(&args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("encode spawn: {}", e))?;

    proc.stdin
        .take()
        .ok_or("no encode stdin")?
        .write_all(&result)
        .map_err(|e| format!("encode write: {}", e))?;
    proc.wait().ok();

    crate::log!("  render_layers_to_file done: {}", output);
    Ok(())
}
/// 导出图片（单主图 + 静态叠加层）
fn export_image(
    ffmpeg: &str,
    ffprobe: &str,
    input: &str,
    output: &str,
    cw: u32,
    ch: u32,
    vl: &RenderLayer,
    sl: &[StaticLayer],
    c: &mut Compositor,
) -> Result<(), String> {
    let (render_width, render_height) = capped_image_export_size(cw, ch, c);
    let target_max = render_width.max(render_height);
    let (rgba, iw, ih) = decode_image_scaled(ffmpeg, ffprobe, input, target_max)?;
    let img_tex = c
        .load_texture(&rgba, iw, ih)
        .map_err(|e| format!("img: {}", e))?;
    crate::log!("  img tex={} {}x{}", img_tex, iw, ih);

    let mut layers = vec![RenderLayer {
        texture_id: img_tex,
        dst_x: vl.dst_x,
        dst_y: vl.dst_y,
        dst_w: vl.dst_w,
        dst_h: vl.dst_h,
        src_x: vl.src_x,
        src_y: vl.src_y,
        src_w: vl.src_w,
        src_h: vl.src_h,
        opacity: vl.opacity,
        z_index: vl.z_index,
        color: vl.color.clone(),
        transform: vl.transform.clone(),
    }];
    layers.extend(load_static_layers(ffmpeg, ffprobe, sl, c)?);

    let result = c
        .render(render_width, render_height, &layers)
        .map_err(|e| format!("render: {}", e))?;
    encode_to_file(ffmpeg, &result, render_width, render_height, output)?;

    // 清理
    c.release_texture(img_tex).ok();
    for l in &layers[1..] {
        c.release_texture(l.texture_id).ok();
    }
    crate::log!("  image done: {}", output);
    Ok(())
}

fn export_video(
    ffmpeg: &str,
    ffprobe: &str,
    input: &str,
    output: &str,
    cw: u32,
    ch: u32,
    fps: Option<f64>,
    hardware: bool,
    vl: &RenderLayer,
    sl: &[StaticLayer],
    c: &mut Compositor,
    preset: QualityPreset,
    task: Option<&TaskState>,
) -> Result<(), String> {
    let info = probe_video_info(ffprobe, input)?;
    let fps_val = fps.unwrap_or(info.fps);
    let frame_size = (info.width * info.height * 4) as usize;
    let out_size = (cw * ch * 4) as usize;
    let total = info
        .frame_count
        .unwrap_or_else(|| (info.duration_secs * fps_val).round() as u64);
    let output_duration = if total > 0 {
        total as f64 / fps_val
    } else {
        info.duration_secs
    };

    crate::log!(
        "  src={}x{} {}fps {}kbps audio={} {} → {}x{} frames={}",
        info.width,
        info.height,
        fps_val,
        info.src_bitrate / 1000,
        info.audio.has_audio,
        info.audio.codec,
        cw,
        ch,
        total
    );

    // ── 编码器选择 ──
    let encoder = choose_encoder(ffmpeg, hardware);
    let (enc_args, pix_fmt) = if encoder == "libx264" {
        (
            vec![
                "-preset".to_string(),
                "veryfast".to_string(),
                "-crf".to_string(),
                "18".to_string(),
            ],
            "yuv420p",
        )
    } else if encoder == "h264_videotoolbox" {
        (vec![], "yuv420p")
    } else if encoder == "h264_nvenc" {
        (
            vec![
                "-preset".to_string(),
                "p5".to_string(),
                "-rc".to_string(),
                "vbr".to_string(),
            ],
            "yuv420p",
        )
    } else {
        (vec![], "yuv420p")
    };
    crate::log!("  encoder={}", encoder);

    // ── 码率计算 ──
    let bitrate = choose_bitrate(cw, ch, fps_val, info.src_bitrate, preset);
    crate::log!("  bitrate={}kbps", bitrate / 1000);

    // ── 加载视频纹理 + 静态层 ──
    let dummy = vec![0u8; frame_size];
    let video_tex = c
        .load_texture(&dummy, info.width, info.height)
        .map_err(|e| format!("video tex: {}", e))?;
    let static_render = load_static_layers(ffmpeg, ffprobe, sl, c)?;

    let mut layers = vec![RenderLayer {
        texture_id: video_tex,
        dst_x: vl.dst_x,
        dst_y: vl.dst_y,
        dst_w: vl.dst_w,
        dst_h: vl.dst_h,
        src_x: vl.src_x,
        src_y: vl.src_y,
        src_w: vl.src_w,
        src_h: vl.src_h,
        opacity: vl.opacity,
        z_index: vl.z_index,
        color: vl.color.clone(),
        transform: vl.transform.clone(),
    }];
    layers.extend(static_render.clone());

    // ── FFmpeg 编码命令 ──
    // 输入 0: Rust pipe 渲染后的视频帧 rawvideo
    // 输入 1: 原始视频文件（用于读取音频流）
    let mut encode_cmd = Command::new(ffmpeg);
    encode_cmd
        .args(["-y", "-hide_banner", "-loglevel", "error"])
        .args([
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{}x{}", cw, ch),
            "-r",
            &format!("{}", fps_val),
            "-i",
            "pipe:0",
        ])
        .args(["-i", input])
        .args(["-map", "0:v:0", "-map", "1:a:0?"])
        .args(["-c:v", &encoder, "-b:v", &format!("{}k", bitrate / 1000)]);
    for arg in &enc_args {
        encode_cmd.arg(arg);
    }
    encode_cmd.args([
        "-pix_fmt",
        pix_fmt,
        "-c:a",
        "copy",
        "-t",
        &format!("{:.6}", output_duration),
        "-y",
        output,
    ]);

    // ── 解码 pipe ──
    let mut decode = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            input,
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{}x{}", info.width, info.height),
            "-r",
            &format!("{}", fps_val),
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("decode: {}", e))?;
    let mut dout = decode.stdout.take().ok_or("no decode stdout")?;

    // ── 编码 pipe ──
    let mut encode = encode_cmd
        .stdin(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("encode: {}", e))?;
    let mut ein = encode.stdin.take().ok_or("no encode stdin")?;

    // ── 存储进程句柄供取消 ──
    let mut decode_proc = Some(decode);
    let mut encode_proc = Some(encode);
    if let Some(t) = task {
        t.store_procs(decode_proc.take().unwrap(), encode_proc.take().unwrap());
    }

    // ── 逐帧循环 ──
    let mut in_buf = vec![0u8; frame_size];
    let t0 = std::time::Instant::now();
    let mut idx: u64 = 0;

    loop {
        if task.as_ref().map_or(false, |t| t.is_cancelled()) {
            return Err("导出已取消".to_string());
        }
        match dout.read_exact(&mut in_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("read {}: {}", idx, e)),
        }
        c.update_texture(video_tex, &in_buf)
            .map_err(|e| format!("update {}: {}", idx, e))?;
        let rendered = c
            .render(cw, ch, &layers)
            .map_err(|e| format!("render {}: {}", idx, e))?;
        ein.write_all(&rendered[..out_size])
            .map_err(|e| format!("write {}: {}", idx, e))?;
        idx += 1;
        if let Some(t) = task {
            t.current_frame.store(idx, Ordering::SeqCst);
        }
        if idx % 30 == 0 {
            let elapsed = t0.elapsed().as_secs_f64().max(0.001);
            crate::log!(
                "  {}/{} {:.1}fps {:.0}%",
                idx,
                total,
                idx as f64 / elapsed,
                (idx as f64 / total as f64) * 100.0
            );
        }
    }

    let (mut decode_out, mut encode_out) = if let Some(t) = task {
        t.take_procs()
    } else {
        (decode_proc, encode_proc)
    };
    drop(ein);
    if let Some(ref mut d) = decode_out {
        d.wait().ok();
    }
    if let Some(ref mut e) = encode_out {
        let exit = e.wait().map_err(|e2| format!("encode wait: {}", e2))?;
        if !exit.success() {
            return Err(format!("ffmpeg encode exit: {}", exit));
        }
    }

    c.release_texture(video_tex).ok();
    for l in &static_render {
        c.release_texture(l.texture_id).ok();
    }
    crate::log!(
        "  video done: {} frames {:.1}s out={}",
        idx,
        t0.elapsed().as_secs_f64(),
        output
    );
    Ok(())
}

fn encode_to_file(ffmpeg: &str, rgba: &[u8], w: u32, h: u32, output: &str) -> Result<(), String> {
    let mut proc = Command::new(ffmpeg)
        .args([
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{}x{}", w, h),
            "-i",
            "pipe:0",
            "-frames:v",
            "1",
            output,
            "-y",
            "-loglevel",
            "error",
        ])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("encode: {}", e))?;
    proc.stdin
        .take()
        .unwrap()
        .write_all(rgba)
        .map_err(|e| format!("write: {}", e))?;
    proc.wait().ok();
    Ok(())
}
