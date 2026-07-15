use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::composition::{composition_layers, mux_primary_audio, CompositionInput};
use crate::compositor::{Compositor, PreviewTextureInfo};
use crate::export::TaskState;
use crate::media::decode_static_image_scaled;

const ERROR_CAPACITY: usize = 1024;

fn is_procedural_layer(layer_type: Option<&str>) -> bool {
    layer_type.unwrap_or("media") != "media"
}

#[repr(C)]
#[derive(Default)]
struct LunaAvFrameRaw {
    handle: *mut c_void,
    metal_texture: *mut c_void,
    width: u32,
    height: u32,
    pts_seconds: f64,
}

unsafe extern "C" {
    fn luna_av_decoder_create(
        path: *const c_char,
        metal_device: *mut c_void,
        max_decode_edge: u32,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> *mut c_void;
    fn luna_av_decoder_destroy(decoder: *mut c_void);
    fn luna_av_decoder_get_rotation(decoder: *mut c_void) -> i32;
    fn luna_av_decoder_frame(
        decoder: *mut c_void,
        seconds: f64,
        out_frame: *mut LunaAvFrameRaw,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> bool;
    fn luna_av_writer_create(
        path: *const c_char,
        metal_device: *mut c_void,
        width: u32,
        height: u32,
        fps: f64,
        bitrate: u64,
        hevc: bool,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> *mut c_void;
    fn luna_av_writer_acquire_frame(
        writer: *mut c_void,
        out_frame: *mut LunaAvFrameRaw,
        error_buffer: *mut c_char,
        error_length: usize,
    ) -> bool;
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

struct Decoder {
    raw: *mut c_void,
}

impl Decoder {
    fn new(path: &str, metal_device: *mut c_void, max_decode_edge: u32) -> Result<Self, String> {
        let path = c_path(path)?;
        let mut error = error_buffer();
        let raw = unsafe {
            luna_av_decoder_create(path.as_ptr(), metal_device, max_decode_edge, error.as_mut_ptr(), error.len())
        };
        if raw.is_null() {
            Err(bridge_error(&error, "无法启动 macOS 视频解码"))
        } else {
            Ok(Self { raw })
        }
    }

    fn rotation_degrees(&self) -> i32 {
        unsafe { luna_av_decoder_get_rotation(self.raw) }
    }

    fn frame(&mut self, time: f64) -> Result<Option<Frame>, String> {
        let mut raw = LunaAvFrameRaw::default();
        let mut error = error_buffer();
        let success = unsafe {
            luna_av_decoder_frame(self.raw, time, &mut raw, error.as_mut_ptr(), error.len())
        };
        if success {
            Ok(Some(Frame { raw }))
        } else if error.first().copied().unwrap_or_default() == 0 {
            Ok(None)
        } else {
            Err(bridge_error(&error, "macOS 视频解码失败"))
        }
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe { luna_av_decoder_destroy(self.raw) };
    }
}

struct Frame {
    raw: LunaAvFrameRaw,
}

impl Drop for Frame {
    fn drop(&mut self) {
        unsafe { luna_av_frame_destroy(self.raw.handle) };
    }
}

struct Writer {
    raw: *mut c_void,
    finished: bool,
}

impl Writer {
    fn new(
        path: &str,
        metal_device: *mut c_void,
        width: u32,
        height: u32,
        fps: f64,
        bitrate: u64,
        hevc: bool,
    ) -> Result<Self, String> {
        let path = c_path(path)?;
        let mut error = error_buffer();
        let raw = unsafe {
            luna_av_writer_create(
                path.as_ptr(),
                metal_device,
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
            Err(bridge_error(&error, "无法启动 macOS 视频编码"))
        } else {
            Ok(Self {
                raw,
                finished: false,
            })
        }
    }

    fn acquire_frame(&mut self) -> Result<Frame, String> {
        let mut raw = LunaAvFrameRaw::default();
        let mut error = error_buffer();
        if unsafe {
            luna_av_writer_acquire_frame(self.raw, &mut raw, error.as_mut_ptr(), error.len())
        } {
            Ok(Frame { raw })
        } else {
            Err(bridge_error(&error, "无法取得编码画面缓冲区"))
        }
    }

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
            Err(bridge_error(&error, "macOS 视频编码失败"))
        }
    }

    fn finish(mut self) -> Result<(), String> {
        let mut error = error_buffer();
        if unsafe { luna_av_writer_finish(self.raw, error.as_mut_ptr(), error.len()) } {
            self.finished = true;
            Ok(())
        } else {
            Err(bridge_error(&error, "无法完成 macOS 视频导出"))
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

fn temporary_output_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.mac-gpu-partial.mp4"))
}

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
    let metal_device = compositor.metal_device_ptr()?;
    let temp_output = temporary_output_path(output_path);
    if let Some(parent) = temp_output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {e}"))?;
    }
    let temp_string = temp_output.to_string_lossy().into_owned();
    let mut writer = Writer::new(
        &temp_string,
        metal_device,
        composition.canvas.width,
        composition.canvas.height,
        fps,
        bitrate,
        false,
    )?;
    let mut decoders: HashMap<String, Decoder> = HashMap::new();
    let mut static_textures: HashMap<String, (u32, u32, u32)> = HashMap::new();

    let export_start = std::time::Instant::now();
    let mut cum_decode_us = 0u64;
    let mut cum_plan_us = 0u64;
    let mut cum_acquire_us = 0u64;
    let mut cum_render_us = 0u64;
    let mut cum_append_us = 0u64;
    let log_interval = (total_frames / 10).max(1);

    for frame_index in 0..total_frames {
        if task.is_some_and(|state| state.is_cancelled()) {
            return Err("导出已取消".to_string());
        }
        let frame_start = std::time::Instant::now();
        let time = frame_index as f64 / fps;
        let layer_inputs = composition_layers(composition, time);
        let mut source_layers = Vec::with_capacity(layer_inputs.len());
        let mut transient_texture_ids = Vec::new();
        let mut decoded_frames = Vec::new();

        // ── 解码 ──
        let t0 = std::time::Instant::now();
        for (layer_idx, mut layer) in layer_inputs.into_iter().enumerate() {
            // shape / text / logo 不对应媒体文件：保留图层进入 WGPU 合成，
            // 但跳过文件解码，使用 Compositor 内置的 1×1 程序纹理（texture 0）。
            let (texture_id, width, height) = if is_procedural_layer(layer.layer_type.as_deref()) {
                (0, 1, 1)
            } else if layer.is_video {
                // 每个槽位独立 Reader：用 file_path + 槽位索引作为 key，
                // 避免同一文件在不同槽位间共享 Reader 导致游标反复追帧/重启
                let decoder_key = format!("{}@slot{}", layer.file_path, layer_idx);
                let decoder = match decoders.entry(decoder_key) {
                    std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                    std::collections::hash_map::Entry::Vacant(entry) => {
                        // 计算此层在画布上的实际显示像素尺寸，作为解码上限
                        let display_w = (layer.dst_w.abs() * composition.canvas.width as f64).ceil() as u32;
                        let display_h = (layer.dst_h.abs() * composition.canvas.height as f64).ceil() as u32;
                        let decode_max_side = display_w.max(display_h).max(360); // 不低于 360px
                        entry.insert(Decoder::new(&layer.file_path, metal_device, decode_max_side)?)
                    }
                };

                // 将视频文件的旋转矩阵同步到 layer transform，GPU shader 据此旋转画面
                // AVAssetReader 不会像 ffmpeg 那样自动应用旋转，需由 shader 完成
                let rotation = decoder.rotation_degrees();
                if rotation != 0 && layer.transform.orientation == 0.0 {
                    layer.transform.orientation = rotation as f64;
                }
                let Some(decoded) = decoder.frame(layer.video_time)? else {
                    continue;
                };
                let texture = unsafe {
                    compositor.wrap_external_metal_texture(
                        decoded.raw.metal_texture,
                        decoded.raw.width,
                        decoded.raw.height,
                        wgpu::TextureUsages::TEXTURE_BINDING,
                        true,
                    )?
                };
                let texture_id = compositor.register_external_texture(
                    texture,
                    decoded.raw.width,
                    decoded.raw.height,
                );
                transient_texture_ids.push(texture_id);
                let result = (texture_id, decoded.raw.width, decoded.raw.height);
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
        let decode_us = t0.elapsed().as_micros() as u64;

        // ── 布局规划 ──
        let t0 = std::time::Instant::now();
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
        let plan_us = t0.elapsed().as_micros() as u64;

        // ── 获取编码器帧 + wrap ──
        let t0 = std::time::Instant::now();
        let output_frame = writer.acquire_frame()?;
        let output_texture = unsafe {
            compositor.wrap_external_metal_texture(
                output_frame.raw.metal_texture,
                output_frame.raw.width,
                output_frame.raw.height,
                wgpu::TextureUsages::RENDER_ATTACHMENT,
                false,
            )?
        };
        let acquire_us = t0.elapsed().as_micros() as u64;

        // ── GPU 合成 ──
        let t0 = std::time::Instant::now();
        compositor.render_into_external_texture(
            output_texture,
            composition.canvas.width,
            composition.canvas.height,
            &planned_layers,
        )?;
        let render_us = t0.elapsed().as_micros() as u64;

        // ── 清理 + append ──
        let t0 = std::time::Instant::now();
        for texture_id in transient_texture_ids {
            compositor.unregister_external_texture(texture_id);
        }
        drop(decoded_frames);
        writer.append(&output_frame, frame_index)?;
        let append_us = t0.elapsed().as_micros() as u64;

        let frame_us = frame_start.elapsed().as_micros() as u64;
        cum_decode_us += decode_us;
        cum_plan_us += plan_us;
        cum_acquire_us += acquire_us;
        cum_render_us += render_us;
        cum_append_us += append_us;


        if let Some(state) = task {
            state
                .current_frame
                .store(frame_index + 1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    let total_us = export_start.elapsed().as_micros() as u64;
    crate::logging::write(&format!(
        "[Export:MacGPU:Timing] SUMMARY total={:.0}ms | cum_decode={:.0}ms cum_plan={:.0}ms cum_acquire={:.0}ms cum_render={:.0}ms cum_append={:.0}ms",
        total_us as f64 / 1000.0,
        cum_decode_us as f64 / 1000.0,
        cum_plan_us as f64 / 1000.0,
        cum_acquire_us as f64 / 1000.0,
        cum_render_us as f64 / 1000.0,
        cum_append_us as f64 / 1000.0,
    ));

    writer.finish()?;
    for (texture_id, _, _) in static_textures.into_values() {
        let _ = compositor.release_texture(texture_id);
    }
    let duration = total_frames as f64 / fps;
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

#[cfg(test)]
mod tests {
    use super::is_procedural_layer;

    #[test]
    fn only_media_layers_require_file_decoding() {
        assert!(!is_procedural_layer(None));
        assert!(!is_procedural_layer(Some("media")));
        assert!(is_procedural_layer(Some("shape")));
        assert!(is_procedural_layer(Some("text")));
        assert!(is_procedural_layer(Some("logo")));
    }
}
