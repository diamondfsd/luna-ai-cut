//! 视频导出 — FFmpeg decode → wgpu render → FFmpeg encode

use std::io::{Read, Write};
use std::process::{Command, Stdio};

use crate::compositor::Compositor;
use crate::RenderLayer;

fn probe_video(ffprobe_path: &str, input: &str) -> Result<VideoInfo, String> {
    let output = Command::new(ffprobe_path)
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input])
        .output()
        .map_err(|e| format!("ffprobe failed: {}", e))?;
    if !output.status.success() { return Err(format!("ffprobe exit: {}", output.status)); }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| format!("ffprobe json: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;
    let video = streams.iter().find(|s| s["codec_type"].as_str() == Some("video")).ok_or("no video stream")?;
    let width = video["width"].as_u64().unwrap_or(1920) as u32;
    let height = video["height"].as_u64().unwrap_or(1080) as u32;
    let fps_str = video["r_frame_rate"].as_str().unwrap_or("30/1");
    let fps = {
        let parts: Vec<&str> = fps_str.split('/').collect();
        if parts.len() == 2 { let n: f64 = parts[0].parse().unwrap_or(30.0); let d: f64 = parts[1].parse().unwrap_or(1.0); if d > 0.0 { n / d } else { 30.0 } }
        else { fps_str.parse().unwrap_or(30.0) }
    };
    let duration = parsed["format"]["duration"].as_str().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
    Ok(VideoInfo { width, height, fps, duration_secs: duration })
}

pub struct VideoInfo {
    pub width: u32, pub height: u32, pub fps: f64, pub duration_secs: f64,
}

fn choose_encoder(_hw: bool) -> &'static str {
    if cfg!(target_os = "macos") { "h264_videotoolbox" }
    else if cfg!(target_os = "windows") { "h264_nvenc" }
    else { "libx264" }
}

/// 导出视频
///
/// video_layer 包含视频帧的 layout（dst_rect / src_rect / opacity / zIndex），
/// 纹理 ID 由本函数创建，覆盖 video_layer.texture_id。
pub fn export_video(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    input_path: &str,
    output_path: &str,
    canvas_width: u32,
    canvas_height: u32,
    fps: Option<f64>,
    hardware: bool,
    video_layer: &RenderLayer,         // 视频帧层（纹理 ID 将被替换）
    overlay_layers: &[RenderLayer],    // 静态叠加层（水印等，纹理已预加载）
    compositor: &mut Compositor,
) -> Result<(), String> {
    // ── 1. 探测 ──
    let info = probe_video(ffprobe_path, input_path)?;
    let fps_val = fps.unwrap_or(info.fps);
    let frame_size = (info.width * info.height * 4) as usize;
    let out_size = (canvas_width * canvas_height * 4) as usize;
    let total_frames = (info.duration_secs * fps_val).ceil() as u64;

    crate::log!(
        "export: src={}x{} {}fps dur={:.1}s → canvas={}x{} frames={}",
        info.width, info.height, fps_val, info.duration_secs,
        canvas_width, canvas_height, total_frames
    );

    // ── 2. 创建视频帧纹理 ──
    let dummy = vec![0u8; frame_size];
    let video_tex_id = compositor.load_texture(&dummy, info.width, info.height)
        .map_err(|e| format!("create video texture: {}", e))?;
    crate::log!("export: video texture id={}", video_tex_id);

    // ── 3. 组装完整 layers（视频帧 + 叠加层） ──
    let mut all_layers: Vec<RenderLayer> = vec![RenderLayer {
        texture_id: video_tex_id,
        ..video_layer.clone()
    }];
    all_layers.extend_from_slice(overlay_layers);

    for (i, l) in all_layers.iter().enumerate() {
        crate::log!(
            "  layer[{}] tex={} dst=({:.3},{:.3} {:.3}x{:.3})",
            i, l.texture_id, l.dst_x, l.dst_y, l.dst_w, l.dst_h
        );
    }

    // ── 4. Spawn FFmpeg decode ──
    let mut decode = Command::new(ffmpeg_path)
        .args([
            "-hide_banner", "-loglevel", "error",
            "-i", input_path,
            "-f", "rawvideo", "-pix_fmt", "rgba",
            "-s", &format!("{}x{}", info.width, info.height),
            "-r", &format!("{}", fps_val),
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn decode: {}", e))?;
    let mut decode_stdout = decode.stdout.take().ok_or("no decode stdout")?;

    // ── 5. Spawn FFmpeg encode ──
    let encoder = choose_encoder(hardware);
    crate::log!("export: encoder={}", encoder);

    let mut encode = Command::new(ffmpeg_path)
        .args([
            "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "rgba",
            "-s", &format!("{}x{}", canvas_width, canvas_height),
            "-r", &format!("{}", fps_val),
            "-i", "pipe:0",
            "-c:v", encoder,
            "-b:v", "12M", "-pix_fmt", "yuv420p", "-y",
            output_path,
        ])
        .stdin(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn encode: {}", e))?;
    let mut encode_stdin = encode.stdin.take().ok_or("no encode stdin")?;

    // ── 6. 逐帧循环 ──
    let mut in_buf = vec![0u8; frame_size];
    let t0 = std::time::Instant::now();
    let mut frame_idx: u64 = 0;

    loop {
        match decode_stdout.read_exact(&mut in_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("decode read frame {}: {}", frame_idx, e)),
        }

        compositor.update_texture(video_tex_id, &in_buf)
            .map_err(|e| format!("updateTexture: {}", e))?;

        let rendered = compositor.render(canvas_width, canvas_height, &all_layers)
            .map_err(|e| format!("render frame {}: {}", frame_idx, e))?;

        if rendered.len() < out_size {
            return Err(format!("render output {} < expected {}", rendered.len(), out_size));
        }
        encode_stdin.write_all(&rendered[..out_size])
            .map_err(|e| format!("encode write frame {}: {}", frame_idx, e))?;

        frame_idx += 1;
        if frame_idx % 30 == 0 {
            let elapsed = t0.elapsed().as_secs_f64();
            let fps_actual = frame_idx as f64 / elapsed.max(0.001);
            crate::log!(
                "export: frame {}/{} ({:.0}%) {:.1}fps",
                frame_idx, total_frames,
                (frame_idx as f64 / total_frames.max(1) as f64) * 100.0, fps_actual
            );
        }
    }

    // ── 7. 清理 ──
    drop(encode_stdin); drop(decode_stdout);
    let dec_status = decode.wait().map_err(|e| format!("decode wait: {}", e))?;
    let enc_status = encode.wait().map_err(|e| format!("encode wait: {}", e))?;
    compositor.release_texture(video_tex_id).ok();

    if !dec_status.success() { return Err(format!("decode exit: {}", dec_status)); }
    if !enc_status.success() { return Err(format!("encode exit: {}", enc_status)); }

    let elapsed = t0.elapsed().as_secs_f64();
    crate::log!("export done: {} frames in {:.1}s ({:.1}fps)", frame_idx, elapsed, frame_idx as f64 / elapsed.max(0.001));
    Ok(())
}
