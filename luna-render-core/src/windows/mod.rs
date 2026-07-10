use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use crate::composition::{composition_layers, is_video_source, CompositionInput};
use crate::compositor::{decode_static_image_scaled, Compositor, PreviewTextureInfo};
use crate::export::TaskState;
use crate::media::probe_video_info;

const ERROR_CAPACITY: usize = 1024;

/// Must match the C struct exactly
#[repr(C)]
#[derive(Default)]
struct LunaAvFrameRaw {
    handle: *mut c_void,
    d3d_texture: *mut c_void,
    rgba_data: *mut c_void,
    width: u32,
    height: u32,
    pts_seconds: f64,
}

// ── Windows native bridge FFI (mirrors macOS av_bridge.m interface) ──

unsafe extern "C" {
    fn luna_av_decoder_create(
        path: *const c_char,
        d3d12_device: *mut c_void,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> *mut c_void;

    fn luna_av_decoder_destroy(decoder: *mut c_void);

    fn luna_av_decoder_frame(
        decoder: *mut c_void,
        seconds: f64,
        out_frame: *mut LunaAvFrameRaw,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> bool;

    fn luna_av_writer_create(
        path: *const c_char,
        d3d12_device: *mut c_void,
        width: u32,
        height: u32,
        fps: f64,
        bitrate: u64,
        hevc: bool,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> *mut c_void;

    // v2 zero-copy: acquire a D3D12-backed output frame
    fn luna_av_writer_acquire_frame(
        writer: *mut c_void,
        out_frame: *mut LunaAvFrameRaw,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> bool;

    // v2 zero-copy: submit the rendered frame to the encoder
    fn luna_av_writer_append_frame(
        writer: *mut c_void,
        frame: *mut c_void,
        frame_index: u64,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> bool;

    fn luna_av_frame_destroy(frame: *mut c_void);
    fn luna_av_writer_finish(
        writer: *mut c_void,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> bool;
    fn luna_av_writer_cancel(writer: *mut c_void);
    fn luna_av_writer_destroy(writer: *mut c_void);
}

// ── Helpers ──

fn error_buffer() -> Vec<c_char> {
    vec![0; ERROR_CAPACITY]
}

fn bridge_error(buffer: &[c_char], fallback: &str) -> String {
    if buffer.first().copied().unwrap_or_default() == 0 {
        return fallback.to_string();
    }
    unsafe { CStr::from_ptr(buffer.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

fn c_path(path: &str) -> Result<CString, String> {
    CString::new(path).map_err(|_| "文件路径包含不支持的字符".to_string())
}

// ── Decoder (v1 CPU path — hardware decode on GPU, readback to CPU) ──

struct Decoder {
    raw: *mut c_void,
}

struct DecodedFrame {
    _holder: *mut c_void, // FrameHolder* — freed on drop via luna_av_frame_destroy
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

impl Decoder {
    fn new(path: &str, d3d12_device: *mut c_void) -> Result<Self, String> {
        let path_c = c_path(path)?;
        let mut error = error_buffer();
        let raw = unsafe {
            luna_av_decoder_create(
                path_c.as_ptr(),
                d3d12_device,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        if raw.is_null() {
            Err(bridge_error(&error, "无法启动 Windows 视频解码"))
        } else {
            Ok(Self { raw })
        }
    }

    fn frame(&mut self, time: f64) -> Result<Option<DecodedFrame>, String> {
        let mut raw = LunaAvFrameRaw::default();
        let mut error = error_buffer();
        let success = unsafe {
            luna_av_decoder_frame(self.raw, time, &mut raw, error.as_mut_ptr(), error.len())
        };
        if success {
            if raw.rgba_data.is_null() || raw.width == 0 || raw.height == 0 {
                if !raw.handle.is_null() {
                    unsafe { luna_av_frame_destroy(raw.handle) };
                }
                return Ok(None);
            }
            let len = (raw.width as usize)
                .checked_mul(raw.height as usize)
                .and_then(|p| p.checked_mul(4))
                .unwrap_or(0);
            let rgba = unsafe {
                std::slice::from_raw_parts(raw.rgba_data as *const u8, len).to_vec()
            };
            Ok(Some(DecodedFrame {
                _holder: raw.handle,
                rgba,
                width: raw.width,
                height: raw.height,
            }))
        } else if error.first().copied().unwrap_or_default() == 0 {
            Ok(None)
        } else {
            Err(bridge_error(&error, "Windows 视频解码失败"))
        }
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe { luna_av_decoder_destroy(self.raw) };
    }
}

impl Drop for DecodedFrame {
    fn drop(&mut self) {
        if !self._holder.is_null() {
            unsafe { luna_av_frame_destroy(self._holder) };
        }
    }
}

// ── Writer (v2 zero-copy via D3D12↔D3D11 shared textures) ──

struct Writer {
    raw: *mut c_void,
    finished: bool,
}

/// A frame acquired from the writer for zero-copy rendering.
/// The D3D12 texture is wrapped as a wgpu texture, rendered into,
/// then submitted back to the encoder via append().
struct Frame {
    raw: LunaAvFrameRaw,
}

impl Drop for Frame {
    fn drop(&mut self) {
        if !self.raw.handle.is_null() {
            unsafe { luna_av_frame_destroy(self.raw.handle) };
        }
    }
}

impl Writer {
    fn new(
        path: &str,
        d3d12_device: *mut c_void,
        width: u32,
        height: u32,
        fps: f64,
        bitrate: u64,
        hevc: bool,
    ) -> Result<Self, String> {
        let path_c = c_path(path)?;
        let mut error = error_buffer();
        let raw = unsafe {
            luna_av_writer_create(
                path_c.as_ptr(),
                d3d12_device,
                width,
                height,
                fps,
                bitrate,
                hevc,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        if raw.is_null() {
            Err(bridge_error(&error, "无法启动 Windows 视频编码"))
        } else {
            Ok(Self {
                raw,
                finished: false,
            })
        }
    }

    /// Acquire a D3D12-backed output frame for zero-copy rendering.
    /// The frame's d3d_texture field contains an ID3D12Resource* that
    /// can be wrapped as a wgpu texture via wrap_external_d3d12_texture().
    fn acquire_frame(&mut self) -> Result<Frame, String> {
        let mut raw = LunaAvFrameRaw::default();
        let mut error = error_buffer();
        if unsafe {
            luna_av_writer_acquire_frame(
                self.raw,
                &mut raw,
                error.as_mut_ptr(),
                error.len(),
            )
        } {
            Ok(Frame { raw })
        } else {
            Err(bridge_error(&error, "无法取得编码画面缓冲区"))
        }
    }

    /// Submit the rendered frame to the hardware encoder.
    /// The caller must ensure GPU rendering is complete before calling this.
    fn append(&mut self, frame: &Frame, frame_index: u64) -> Result<(), String> {
        let mut error = error_buffer();
        if unsafe {
            luna_av_writer_append_frame(
                self.raw,
                frame.raw.handle,
                frame_index,
                error.as_mut_ptr(),
                error.len(),
            )
        } {
            Ok(())
        } else {
            Err(bridge_error(&error, "Windows 视频编码失败"))
        }
    }

    fn finish(mut self) -> Result<(), String> {
        let mut error = error_buffer();
        if unsafe { luna_av_writer_finish(self.raw, error.as_mut_ptr(), error.len()) } {
            self.finished = true;
            Ok(())
        } else {
            Err(bridge_error(&error, "无法完成 Windows 视频导出"))
        }
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        unsafe {
            if !self.finished {
                luna_av_writer_cancel(self.raw);
            }
            luna_av_writer_destroy(self.raw);
        }
    }
}

// ── Path helpers ──

fn temporary_output_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.win-gpu-partial.mp4"))
}

fn audio_output_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.win-gpu-audio-partial.mp4"))
}

// ── Audio muxing (reuses ffmpeg, same as macOS) ──

fn mux_primary_audio(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    silent_video: &Path,
    output_path: &str,
    composition: &CompositionInput,
    duration: f64,
) -> Result<PathBuf, String> {
    let Some(layer) = composition
        .layers
        .iter()
        .find(|layer| is_video_source(&layer.source))
    else {
        return Ok(silent_video.to_path_buf());
    };
    let info = probe_video_info(ffprobe_path, &layer.source.path)?;
    if !info.audio.has_audio {
        return Ok(silent_video.to_path_buf());
    }

    let timing = layer.source.time.as_ref();
    let offset = timing.and_then(|time| time.offset).unwrap_or(0.0).max(0.0);
    if offset >= duration {
        return Ok(silent_video.to_path_buf());
    }
    let start = timing.and_then(|time| time.start).unwrap_or(0.0).max(0.0);
    let active_duration = timing
        .and_then(|time| time.duration)
        .unwrap_or(duration - offset)
        .min(duration - offset)
        .max(0.001);
    let mux_output = audio_output_path(output_path);
    let _ = std::fs::remove_file(&mux_output);
    let filter = format!("[1:a:0]asetpts=PTS-STARTPTS+{:.6}/TB[aout]", offset);
    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-i".to_string(),
        silent_video.to_string_lossy().into_owned(),
    ];
    if timing.and_then(|time| time.loop_enabled).unwrap_or(false) {
        args.extend(["-stream_loop".to_string(), "-1".to_string()]);
    }
    args.extend([
        "-ss".to_string(),
        format!("{start:.6}"),
        "-t".to_string(),
        format!("{active_duration:.6}"),
        "-i".to_string(),
        layer.source.path.clone(),
        "-filter_complex".to_string(),
        filter,
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "[aout]".to_string(),
        "-c:v".to_string(),
        "copy".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-t".to_string(),
        format!("{duration:.6}"),
        "-movflags".to_string(),
        "+faststart".to_string(),
        mux_output.to_string_lossy().into_owned(),
    ]);
    let result = Command::new(ffmpeg_path)
        .args(&args)
        .output()
        .map_err(|error| format!("启动音频合成失败: {error}"))?;
    if !result.status.success() {
        return Err(format!(
            "音频合成失败: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    std::fs::remove_file(silent_video).map_err(|error| format!("清理临时视频失败: {error}"))?;
    Ok(mux_output)
}

// ═══════════════════════════════════════════════════════
//  Main export — v2 zero-copy encoder path
// ═══════════════════════════════════════════════════════
//
//  Matches macOS flow:
//    1. MF Source Reader (D3D11VA HW decode) → CPU RGBA → upload to wgpu
//    2. wgpu compositing
//    3. MF Sink Writer ← D3D12↔D3D11 shared texture (ZERO-COPY from compositor)
//
//  Encoder output frames are D3D12 textures created by the C++ bridge,
//  wrapped as wgpu textures, rendered into directly, then submitted to
//  Media Foundation for hardware encoding — no CPU readback on the encode path.

pub(crate) fn export_video(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    output_path: &str,
    composition: &CompositionInput,
    fps: f64,
    total_frames: u64,
    bitrate: u64,
    task: Option<&Arc<TaskState>>,
) -> Result<(), String> {
    let d3d12_device = compositor.d3d12_device_ptr()?;
    let temp_output = temporary_output_path(output_path);
    if let Some(parent) = temp_output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {e}"))?;
    }
    let temp_string = temp_output.to_string_lossy().into_owned();

    // Create the hardware encoder writer
    let mut writer = Writer::new(
        &temp_string,
        d3d12_device,
        composition.canvas.width,
        composition.canvas.height,
        fps,
        bitrate,
        false, // hevc
    )?;

    let mut decoders: HashMap<String, Decoder> = HashMap::new();
    let mut static_textures: HashMap<String, (u32, u32, u32)> = HashMap::new();

    // ── Main frame loop ──
    for frame_index in 0..total_frames {
        if task.is_some_and(|state| state.is_cancelled()) {
            return Err("导出已取消".to_string());
        }
        let time = frame_index as f64 / fps;
        let layer_inputs = composition_layers(composition, time);
        let mut source_layers = Vec::with_capacity(layer_inputs.len());
        let mut transient_texture_ids = Vec::new();
        let mut decoded_frames: Vec<DecodedFrame> = Vec::new();

        // ── Decode & upload source layers ──
        for layer in layer_inputs {
            let (texture_id, width, height) = if layer.is_video {
                let decoder = match decoders.entry(layer.file_path.clone()) {
                    std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                    std::collections::hash_map::Entry::Vacant(entry) => {
                        entry.insert(Decoder::new(&layer.file_path, d3d12_device)?)
                    }
                };
                let Some(decoded) = decoder.frame(layer.video_time)? else {
                    continue;
                };
                let texture_id =
                    compositor.load_texture(&decoded.rgba, decoded.width, decoded.height)?;
                transient_texture_ids.push(texture_id);
                let result = (texture_id, decoded.width, decoded.height);
                decoded_frames.push(decoded);
                result
            } else if let Some(cached) = static_textures.get(&layer.file_path).copied() {
                cached
            } else {
                let (rgba, width, height) = decode_static_image_scaled(
                    ffmpeg_path,
                    ffprobe_path,
                    &layer.file_path,
                    composition.canvas.width.max(composition.canvas.height),
                )?;
                let texture_id = compositor.load_texture(&rgba, width, height)?;
                let cached = (texture_id, width, height);
                static_textures.insert(layer.file_path.clone(), cached);
                cached
            };
            source_layers.push((
                layer,
                PreviewTextureInfo {
                    texture_id,
                    width,
                    height,
                },
            ));
        }

        // ── Plan compositing layout ──
        let planned_layers = if source_layers.is_empty() {
            Vec::new()
        } else {
            compositor
                .plan_preview(
                    Some(composition.canvas.width),
                    Some(composition.canvas.height),
                    Some(composition.canvas.width.max(composition.canvas.height)),
                    &source_layers,
                )?
                .layers
        };

        // ── Acquire zero-copy output frame from encoder ──
        let output_frame = writer.acquire_frame()?;

        // Wrap the D3D12 texture as a wgpu texture and render into it
        let output_texture = unsafe {
            compositor.wrap_external_d3d12_texture(
                output_frame.raw.d3d_texture,
                output_frame.raw.width,
                output_frame.raw.height,
                wgpu::TextureUsages::RENDER_ATTACHMENT,
                false,
            )?
        };

        compositor.render_into_external_texture(
            output_texture,
            composition.canvas.width,
            composition.canvas.height,
            &planned_layers,
        )?;

        // Wait for GPU to finish before submitting to MF encoder
        compositor.wait_for_gpu()?;

        // Submit rendered frame to the hardware encoder
        writer.append(&output_frame, frame_index)?;

        // Cleanup transient textures & decoded frames
        for texture_id in transient_texture_ids {
            compositor.release_texture(texture_id);
        }
        drop(decoded_frames);

        if let Some(state) = task {
            state
                .current_frame
                .store(frame_index + 1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    // ── Finalize ──
    let duration = total_frames as f64 / fps;
    writer.finish()?;

    for (texture_id, _, _) in static_textures.into_values() {
        let _ = compositor.release_texture(texture_id);
    }

    let completed_output = mux_primary_audio(
        ffmpeg_path,
        ffprobe_path,
        &temp_output,
        output_path,
        composition,
        duration,
    )?;

    if Path::new(output_path).exists() {
        std::fs::remove_file(output_path).map_err(|e| format!("替换旧导出文件失败: {e}"))?;
    }
    std::fs::rename(&completed_output, output_path)
        .map_err(|e| format!("保存导出文件失败: {e}"))?;

    Ok(())
}
