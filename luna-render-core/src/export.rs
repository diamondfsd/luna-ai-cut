//! 统一导出 — Rust 内部完成全部加载+渲染+编码

use std::io::{Read, Write};
use std::process::{Command, Stdio};

use crate::compositor::Compositor;
use crate::{RenderLayer, StaticLayer};

fn probe_video(ffprobe: &str, input: &str) -> Result<VideoInfo, String> {
    let output = Command::new(ffprobe)
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input])
        .output().map_err(|e| format!("ffprobe: {}", e))?;
    if !output.status.success() { return Err(format!("ffprobe exit: {}", output.status)); }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| format!("json: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;
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
    Ok(VideoInfo { width: w, height: h, fps, duration_secs: duration })
}

pub struct VideoInfo { pub width: u32, pub height: u32, pub fps: f64, pub duration_secs: f64 }

fn choose_encoder(_hw: bool) -> &'static str {
    if cfg!(target_os = "macos") { "h264_videotoolbox" }
    else if cfg!(target_os = "windows") { "h264_nvenc" }
    else { "libx264" }
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
    c: &mut Compositor,
) -> Result<(), String> {
    let is_img = input.to_lowercase().ends_with(".png")
        || input.to_lowercase().ends_with(".jpg")
        || input.to_lowercase().ends_with(".jpeg")
        || input.to_lowercase().ends_with(".webp");

    if is_img {
        crate::log!("export: image mode {} → {}", input, output);
        export_image(ffmpeg, ffprobe, input, output, canvas_w, canvas_h, video_layer, static_layers, c)
    } else {
        crate::log!("export: video mode {} → {}", input, output);
        export_video(ffmpeg, ffprobe, input, output, canvas_w, canvas_h, fps, hardware, video_layer, static_layers, c)
    }
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
) -> Result<(), String> {
    let info = probe_video(ffprobe, input)?;
    let fps_val = fps.unwrap_or(info.fps);
    let frame_size = (info.width * info.height * 4) as usize;
    let out_size = (cw * ch * 4) as usize;
    let total = (info.duration_secs * fps_val).ceil() as u64;

    crate::log!("  src={}x{} {}fps → {}x{} frames={}", info.width, info.height, fps_val, cw, ch, total);

    // 加载视频纹理 + 静态层
    let dummy = vec![0u8; frame_size];
    let video_tex = c.load_texture(&dummy, info.width, info.height).map_err(|e| format!("video tex: {}", e))?;
    let static_render = load_static_layers(ffmpeg, ffprobe, sl, c)?;

    let mut layers = vec![RenderLayer { texture_id: video_tex, dst_x: 0.0, dst_y: 0.0, dst_w: 1.0, dst_h: 1.0, src_x: 0.0, src_y: 0.0, src_w: 1.0, src_h: 1.0, opacity: 1.0, z_index: 0 }];
    layers.extend(static_render.clone());

    let encoder = choose_encoder(hardware);
    crate::log!("  encoder={}", encoder);

    let mut decode = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i", input, "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{}x{}", info.width, info.height), "-r", &format!("{}", fps_val), "pipe:1"])
        .stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().map_err(|e| format!("decode: {}", e))?;
    let mut dout = decode.stdout.take().ok_or("no decode stdout")?;

    let mut encode = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{}x{}", cw, ch), "-r", &format!("{}", fps_val), "-i", "pipe:0", "-c:v", encoder, "-b:v", "12M", "-pix_fmt", "yuv420p", "-y", output])
        .stdin(Stdio::piped()).stderr(Stdio::inherit()).spawn().map_err(|e| format!("encode: {}", e))?;
    let mut ein = encode.stdin.take().ok_or("no encode stdin")?;

    let mut in_buf = vec![0u8; frame_size];
    let t0 = std::time::Instant::now();
    let mut idx: u64 = 0;

    loop {
        match dout.read_exact(&mut in_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("read {}: {}", idx, e)),
        }
        c.update_texture(video_tex, &in_buf).map_err(|e| format!("update {}: {}", idx, e))?;
        let rendered = c.render(cw, ch, &layers).map_err(|e| format!("render {}: {}", idx, e))?;
        ein.write_all(&rendered[..out_size]).map_err(|e| format!("write {}: {}", idx, e))?;
        idx += 1;
        if idx % 30 == 0 {
            crate::log!("  {}/{} {:.1}fps", idx, total, idx as f64 / t0.elapsed().as_secs_f64().max(0.001));
        }
    }
    drop(ein); drop(dout);
    decode.wait().ok(); encode.wait().ok();

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
