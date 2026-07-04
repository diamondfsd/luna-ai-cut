//! 统一导出 — Rust 内部完成全部加载+渲染+编码

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use crate::compositor::Compositor;
use crate::{RenderLayer, StaticLayer};

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
            procs: Mutex::new(TaskProcs { decode: None, encode: None }),
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
                if let Some(ref mut p) = procs.decode { let _ = p.kill(); }
                if let Some(ref mut p) = procs.encode { let _ = p.kill(); }
            }
        }
    }
}

/// 查询任务进度
pub fn task_progress(task_id: &str) -> Option<(u64, u64)> {
    EXPORT_TASKS.lock().ok().and_then(|map| {
        map.get(task_id).map(|s| {
            (s.current_frame.load(Ordering::Relaxed), s.total_frames.load(Ordering::Relaxed))
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

// ── 音频信息 ──

pub struct AudioInfo {
    pub has_audio: bool,
    pub codec: String,
}

// ── 视频信息 ──

pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration_secs: f64,
    pub src_bitrate: u32,
    pub audio: AudioInfo,
}

fn probe_video(ffprobe: &str, input: &str) -> Result<VideoInfo, String> {
    let output = Command::new(ffprobe)
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input])
        .output().map_err(|e| format!("ffprobe: {}", e))?;
    if !output.status.success() { return Err(format!("ffprobe exit: {}", output.status)); }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| format!("json: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;

    // ── 视频流 ──
    let video = streams.iter().find(|s| s["codec_type"].as_str() == Some("video")).ok_or("no video stream")?;
    let w = video["width"].as_u64().unwrap_or(1920) as u32;
    let h = video["height"].as_u64().unwrap_or(1080) as u32;
    let fps_str = video["r_frame_rate"].as_str().unwrap_or("30/1");
    let fps = {
        let parts: Vec<&str> = fps_str.split('/').collect();
        if parts.len() == 2 { let n: f64 = parts[0].parse().unwrap_or(30.0); let d: f64 = parts[1].parse().unwrap_or(1.0); if d > 0.0 { n / d } else { 30.0 } }
        else { fps_str.parse().unwrap_or(30.0) }
    };
    let duration = parsed["format"]["duration"].as_str().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
    let src_bitrate = parsed["format"]["bit_rate"].as_str().and_then(|b| b.parse::<u32>().ok()).unwrap_or(0);

    // ── 音频流 ──
    let audio_stream = streams.iter().find(|s| s["codec_type"].as_str() == Some("audio"));
    let audio = AudioInfo {
        has_audio: audio_stream.is_some(),
        codec: audio_stream.and_then(|s| s["codec_name"].as_str().map(|c| c.to_string())).unwrap_or_default(),
    };

    Ok(VideoInfo { width: w, height: h, fps, duration_secs: duration, src_bitrate, audio })
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
    let hw_encoders = ["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf", "h264_vaapi"];
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
    if base < 5_000_000 { 5_000_000 }
    else if base > 100_000_000 { 100_000_000 }
    else { base as u32 }
}

/// 按质量预设计算目标码率
fn choose_bitrate(width: u32, height: u32, fps: f64, src_bitrate: u32, preset: QualityPreset) -> u32 {
    let default = default_bitrate(width, height, fps);
    match preset {
        QualityPreset::Small => default / 2,
        QualityPreset::Standard => default,
        QualityPreset::High => (default * 15) / 10,
        QualityPreset::OriginalLike => {
            if src_bitrate > 0 { src_bitrate.max(default) }
            else { default * 2 }
        }
    }
}

/// 用 FFmpeg 解码图片到 RGBA
fn decode_image(ffmpeg: &str, ffprobe: &str, path: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let output = Command::new(ffprobe)
        .args(["-v", "quiet", "-print_format", "json", "-show_streams", path])
        .output().map_err(|e| format!("ffprobe: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| format!("json: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;
    let vs = streams.iter().find(|s| s["codec_type"].as_str() == Some("video")).ok_or("no video stream")?;
    let w = vs["width"].as_u64().unwrap_or(1920) as u32;
    let h = vs["height"].as_u64().unwrap_or(1080) as u32;

    let mut proc = Command::new(ffmpeg)
        .args(["-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{}x{}", w, h), "-vframes", "1", "pipe:1", "-loglevel", "error"])
        .stdout(Stdio::piped()).spawn().map_err(|e| format!("spawn decode: {}", e))?;
    let mut buf = vec![];
    proc.stdout.take().unwrap().read_to_end(&mut buf).map_err(|e| format!("read: {}", e))?;
    proc.wait().ok();
    Ok((buf, w, h))
}

/// 预览一帧 — 和 export_file 同样的加载+渲染，返回 RGBA Buffer
pub fn preview_file(
    ffmpeg: &str, ffprobe: &str,
    input: &str, cw: u32, ch: u32,
    static_layers: &[StaticLayer],
    c: &mut Compositor,
) -> Result<Vec<u8>, String> {
    crate::log!("preview: {} {}x{} static={}", input, cw, ch, static_layers.len());

    let (rgba, iw, ih) = decode_image(ffmpeg, ffprobe, input)?;
    let img_tex = c.load_texture(&rgba, iw, ih).map_err(|e| format!("img: {}", e))?;

    let mut layers = vec![RenderLayer {
        texture_id: img_tex,
        dst_x: 0.0, dst_y: 0.0, dst_w: 1.0, dst_h: 1.0,
        src_x: 0.0, src_y: 0.0, src_w: 1.0, src_h: 1.0,
        opacity: 1.0, z_index: 0,
    }];
    layers.extend(load_static_layers(ffmpeg, ffprobe, static_layers, c)?);

    let result = c.render(cw, ch, &layers).map_err(|e| format!("render: {}", e))?;

    c.release_texture(img_tex).ok();
    for l in &layers[1..] { c.release_texture(l.texture_id).ok(); }
    Ok(result)
}

/// 统一导出入口
pub fn export_file(
    ffmpeg: &str, ffprobe: &str,
    input: &str, output: &str,
    canvas_w: u32, canvas_h: u32,
    fps: Option<f64>, hardware: bool,
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
        export_image(ffmpeg, ffprobe, input, output, canvas_w, canvas_h, video_layer, static_layers, c)
    } else {
        crate::log!("export: video mode {} → {} preset={:?}", input, output, preset);
        export_video(ffmpeg, ffprobe, input, output, canvas_w, canvas_h, fps, hardware, video_layer, static_layers, c, preset, task.as_deref())
    };

    // 清理任务状态
    if let Some(id) = task_id { cleanup_task(id); }
    result
}

/// 加载所有静态层（内部 FFmpeg decode + 上传 wgpu）
fn load_static_layers(ffmpeg: &str, ffprobe: &str, layers: &[StaticLayer], c: &mut Compositor) -> Result<Vec<RenderLayer>, String> {
    let mut result = vec![];
    for sl in layers {
        crate::log!("  load static: {}", sl.image_path);
        let (rgba, _w, _h) = decode_image(ffmpeg, ffprobe, &sl.image_path)?;
        let tex = c.load_texture(&rgba, _w, _h).map_err(|e| format!("load {}: {}", sl.image_path, e))?;
        crate::log!("    tex={} {}x{}", tex, _w, _h);
        result.push(RenderLayer {
            texture_id: tex,
            dst_x: sl.dst_x, dst_y: sl.dst_y, dst_w: sl.dst_w, dst_h: sl.dst_h,
            src_x: sl.src_x, src_y: sl.src_y, src_w: sl.src_w, src_h: sl.src_h,
            opacity: sl.opacity, z_index: sl.z_index,
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
        output, width, height, layers.len(), format, quality
    );

    let result = c.render(width, height, layers)?;

    // ── ffmpeg 编码 ──
    // JPEG: -q:v 2-31 (2=最高质量), PNG: 无损
    let q = format!("{:.0}", quality.clamp(1.0, 100.0));
    let mut args: Vec<String> = vec![
        "-f".into(), "rawvideo".into(),
        "-pix_fmt".into(), "rgba".into(),
        "-s".into(), format!("{}x{}", width, height),
        "-i".into(), "pipe:0".into(),
        "-frames:v".into(), "1".into(),
        "-y".into(),
        "-loglevel".into(), "error".into(),
    ];

    match format {
        "jpeg" | "jpg" => {
            // ffmpeg JPEG 质量：1-31，数值越低质量越高。将 quality(1-100)映射到 2-25
            let ffmpeg_q = ((100.0 - quality.clamp(1.0, 100.0)) * 23.0 / 99.0 + 2.0) as u32;
            args.extend_from_slice(&["-c:v".into(), "mjpeg".into(), "-q:v".into(), ffmpeg_q.to_string()]);
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
    ffmpeg: &str, ffprobe: &str,
    input: &str, output: &str,
    cw: u32, ch: u32,
    _vl: &RenderLayer,
    sl: &[StaticLayer], c: &mut Compositor,
) -> Result<(), String> {
    let (rgba, iw, ih) = decode_image(ffmpeg, ffprobe, input)?;
    let img_tex = c.load_texture(&rgba, iw, ih).map_err(|e| format!("img: {}", e))?;
    crate::log!("  img tex={} {}x{}", img_tex, iw, ih);

    let mut layers = vec![RenderLayer {
        texture_id: img_tex,
        dst_x: 0.0, dst_y: 0.0, dst_w: 1.0, dst_h: 1.0,
        src_x: 0.0, src_y: 0.0, src_w: 1.0, src_h: 1.0,
        opacity: 1.0, z_index: 0,
    }];
    layers.extend(load_static_layers(ffmpeg, ffprobe, sl, c)?);

    let result = c.render(cw, ch, &layers).map_err(|e| format!("render: {}", e))?;
    encode_to_file(ffmpeg, &result, cw, ch, output)?;

    // 清理
    c.release_texture(img_tex).ok();
    for l in &layers[1..] { c.release_texture(l.texture_id).ok(); }
    crate::log!("  image done: {}", output);
    Ok(())
}

fn export_video(
    ffmpeg: &str, ffprobe: &str,
    input: &str, output: &str,
    cw: u32, ch: u32,
    fps: Option<f64>, hardware: bool,
    _vl: &RenderLayer,
    sl: &[StaticLayer], c: &mut Compositor,
    preset: QualityPreset,
    task: Option<&TaskState>,
) -> Result<(), String> {
    let info = probe_video(ffprobe, input)?;
    let fps_val = fps.unwrap_or(info.fps);
    let frame_size = (info.width * info.height * 4) as usize;
    let out_size = (cw * ch * 4) as usize;
    let total = (info.duration_secs * fps_val).ceil() as u64;

    crate::log!("  src={}x{} {}fps {}kbps audio={} {} → {}x{} frames={}",
        info.width, info.height, fps_val,
        info.src_bitrate / 1000, info.audio.has_audio, info.audio.codec,
        cw, ch, total);

    // ── 编码器选择 ──
    let encoder = choose_encoder(ffmpeg, hardware);
    let (enc_args, pix_fmt) = if encoder == "libx264" {
        (vec!["-preset".to_string(), "veryfast".to_string(), "-crf".to_string(), "18".to_string()], "yuv420p")
    } else if encoder == "h264_videotoolbox" {
        (vec![], "yuv420p")
    } else if encoder == "h264_nvenc" {
        (vec!["-preset".to_string(), "p5".to_string(), "-rc".to_string(), "vbr".to_string()], "yuv420p")
    } else {
        (vec![], "yuv420p")
    };
    crate::log!("  encoder={}", encoder);

    // ── 码率计算 ──
    let bitrate = choose_bitrate(cw, ch, fps_val, info.src_bitrate, preset);
    crate::log!("  bitrate={}kbps", bitrate / 1000);

    // ── 加载视频纹理 + 静态层 ──
    let dummy = vec![0u8; frame_size];
    let video_tex = c.load_texture(&dummy, info.width, info.height).map_err(|e| format!("video tex: {}", e))?;
    let static_render = load_static_layers(ffmpeg, ffprobe, sl, c)?;

    let mut layers = vec![RenderLayer {
        texture_id: video_tex,
        dst_x: 0.0, dst_y: 0.0, dst_w: 1.0, dst_h: 1.0,
        src_x: 0.0, src_y: 0.0, src_w: 1.0, src_h: 1.0,
        opacity: 1.0, z_index: 0,
    }];
    layers.extend(static_render.clone());

    // ── FFmpeg 编码命令 ──
    // 输入 0: Rust pipe 渲染后的视频帧 rawvideo
    // 输入 1: 原始视频文件（用于读取音频流）
    let mut encode_cmd = Command::new(ffmpeg);
    encode_cmd
        .args(["-y", "-hide_banner", "-loglevel", "error"])
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{}x{}", cw, ch), "-r", &format!("{}", fps_val), "-i", "pipe:0"])
        .args(["-i", input])
        .args(["-map", "0:v:0", "-map", "1:a:0?"])
        .args(["-c:v", &encoder, "-b:v", &format!("{}k", bitrate / 1000)]);
    for arg in &enc_args {
        encode_cmd.arg(arg);
    }
    encode_cmd
        .args(["-pix_fmt", pix_fmt, "-c:a", "copy", "-shortest", "-y", output]);

    // ── 解码 pipe ──
    let mut decode = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i", input,
            "-f", "rawvideo", "-pix_fmt", "rgba",
            "-s", &format!("{}x{}", info.width, info.height),
            "-r", &format!("{}", fps_val), "pipe:1"])
        .stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()
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
    if let Some(t) = task { t.store_procs(decode, encode); }

    // ── 逐帧循环 ──
    let mut in_buf = vec![0u8; frame_size];
    let t0 = std::time::Instant::now();
    let mut idx: u64 = 0;

    loop {
        if task.as_ref().map_or(false, |t| t.is_cancelled()) { return Err("导出已取消".to_string()); }
        match dout.read_exact(&mut in_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("read {}: {}", idx, e)),
        }
        c.update_texture(video_tex, &in_buf).map_err(|e| format!("update {}: {}", idx, e))?;
        let rendered = c.render(cw, ch, &layers).map_err(|e| format!("render {}: {}", idx, e))?;
        ein.write_all(&rendered[..out_size]).map_err(|e| format!("write {}: {}", idx, e))?;
        idx += 1;
        if let Some(t) = task { t.current_frame.store(idx, Ordering::SeqCst); }
        if idx % 30 == 0 {
            let elapsed = t0.elapsed().as_secs_f64().max(0.001);
            crate::log!("  {}/{} {:.1}fps {:.0}%", idx, total, idx as f64 / elapsed, (idx as f64 / total as f64) * 100.0);
        }
    }

    let (mut decode_out, mut encode_out) = if let Some(t) = task { t.take_procs() } else { (None, None) };
    drop(ein);
    if let Some(ref mut d) = decode_out { d.wait().ok(); }
    if let Some(ref mut e) = encode_out {
        let exit = e.wait().map_err(|e2| format!("encode wait: {}", e2))?;
        if !exit.success() { return Err(format!("ffmpeg encode exit: {}", exit)); }
    }

    c.release_texture(video_tex).ok();
    for l in &static_render { c.release_texture(l.texture_id).ok(); }
    crate::log!("  video done: {} frames {:.1}s", idx, t0.elapsed().as_secs_f64());
    Ok(())
}

fn encode_to_file(ffmpeg: &str, rgba: &[u8], w: u32, h: u32, output: &str) -> Result<(), String> {
    let mut proc = Command::new(ffmpeg)
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{}x{}", w, h), "-i", "pipe:0", "-frames:v", "1", output, "-y", "-loglevel", "error"])
        .stdin(Stdio::piped()).spawn().map_err(|e| format!("encode: {}", e))?;
    proc.stdin.take().unwrap().write_all(rgba).map_err(|e| format!("write: {}", e))?;
    proc.wait().ok();
    Ok(())
}
