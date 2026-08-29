use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use crate::composition::{
    bind_layer_mask_texture, composition_layers, mux_primary_audio, retain_layer_mask_textures,
    CompositionInput,
};
use crate::compositor::{
    is_optional_positioned_asset, tolerate_optional_positioned_asset_error, Compositor,
    PreviewTextureInfo,
};
use crate::export::TaskState;
use crate::media::decode_static_image_scaled;

use super::converter::{D3d12TextureLease, VideoConverter};
use super::decoder::VideoDecoder;
use super::device::InteropDevice;
use super::encoder::VideoEncoder;
use super::native_converter::{NativeSharedTexture, NativeTextureLease, NativeVideoConverter};

fn temporary_output_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.win-gpu-partial.mp4"))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    output_path: &str,
    composition: &CompositionInput,
    fps: f64,
    total_frames: u64,
    bitrate: u64,
    include_audio: bool,
    hevc: bool,
    task: Option<&Arc<TaskState>>,
    interop: &InteropDevice,
    d3d12_device: &windows::Win32::Graphics::Direct3D12::ID3D12Device,
    d3d12_queue: &windows::Win32::Graphics::Direct3D12::ID3D12CommandQueue,
    system_memory_decode: bool,
) -> Result<(), String> {
    if system_memory_decode {
        return Err("native Windows GPU export requires D3D11 video surfaces".to_string());
    }
    let temp_output = temporary_output_path(output_path);
    let mut temp_guard = TemporaryOutputGuard::new(temp_output.clone());
    let mut converter = NativeVideoConverter::new(
        &interop.native_d3d11_device,
        &interop.native_d3d11_context,
        d3d12_device,
        d3d12_queue,
    )?;
    let writer = VideoEncoder::new(
        &temp_output,
        &interop.native_device_manager,
        composition.canvas.width,
        composition.canvas.height,
        fps,
        bitrate,
        hevc,
    )?;
    crate::logging::write("[Export:WinGPU] decoder-manager=D3D11 native shared-texture bridge");
    export_frames(
        compositor,
        ffmpeg_path,
        ffprobe_path,
        composition,
        fps,
        total_frames,
        task,
        &mut converter,
        interop,
        &interop.native_device_manager,
        writer,
        system_memory_decode,
    )?;

    let completed_output = if include_audio {
        let duration = total_frames as f64 / fps;
        mux_primary_audio(
            ffmpeg_path,
            ffprobe_path,
            &temp_output,
            output_path,
            composition,
            duration,
        )?
    } else {
        crate::logging::write("[Export:WinGPU] 音频已关闭，跳过音频合并");
        temp_output
    };
    if Path::new(output_path).exists() {
        std::fs::remove_file(output_path)
            .map_err(|error| format!("替换旧导出文件失败: {error}"))?;
    }
    std::fs::rename(&completed_output, output_path)
        .map_err(|error| format!("保存导出文件失败: {error}"))?;
    temp_guard.disarm();
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_hardware_encoder(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    output_path: &str,
    composition: &CompositionInput,
    fps: f64,
    total_frames: u64,
    bitrate: &str,
    include_audio: bool,
    encoder: &str,
    task: Option<&Arc<TaskState>>,
    interop: &InteropDevice,
    d3d12_device: &windows::Win32::Graphics::Direct3D12::ID3D12Device,
    d3d12_queue: &windows::Win32::Graphics::Direct3D12::ID3D12CommandQueue,
    system_memory_decode: bool,
) -> Result<(), String> {
    let temp_output = temporary_output_path(output_path);
    let mut temp_guard = TemporaryOutputGuard::new(temp_output.clone());
    if let Some(parent) = temp_output.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建硬件编码临时目录: {error}"))?;
    }
    let _ = std::fs::remove_file(&temp_output);

    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pix_fmt".to_string(),
        "rgba".to_string(),
        "-s".to_string(),
        format!("{}x{}", composition.canvas.width, composition.canvas.height),
        "-r".to_string(),
        fps.to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
        "-c:v".to_string(),
        encoder.to_string(),
        "-b:v".to_string(),
        bitrate.to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        temp_output.to_string_lossy().into_owned(),
    ];
    if encoder == "libx264" {
        args.splice(
            args.len() - 5..args.len() - 5,
            ["-preset".to_string(), "veryfast".to_string()],
        );
    }

    crate::logging::write(&format!(
        "[Export:WinGPU] compatible path start output={} decoder=media-foundation compositor=wgpu encoder={} transport=cpu-readback input={}",
        output_path,
        encoder,
        if system_memory_decode {
            "system-memory-upload"
        } else {
            "d3d11on12-unwrap"
        },
    ));
    let mut child = crate::media::command(ffmpeg_path)
        .args(args)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动硬件编码器: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "硬件编码器输入管道不可用".to_string())?;

    export_frames_to_hardware_encoder(
        compositor,
        ffmpeg_path,
        ffprobe_path,
        composition,
        fps,
        total_frames,
        task,
        interop,
        d3d12_device,
        d3d12_queue,
        &mut stdin,
        system_memory_decode,
    )?;
    drop(stdin);
    let output = child
        .wait_with_output()
        .map_err(|error| format!("硬件编码器等待失败: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "硬件编码器退出 {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    let completed_output = if include_audio {
        let duration = total_frames as f64 / fps;
        crate::composition::mux_primary_audio(
            ffmpeg_path,
            ffprobe_path,
            &temp_output,
            output_path,
            composition,
            duration,
        )?
    } else {
        temp_output.clone()
    };
    if Path::new(output_path).exists() {
        std::fs::remove_file(output_path)
            .map_err(|error| format!("替换旧导出文件失败: {error}"))?;
    }
    std::fs::rename(&completed_output, output_path)
        .map_err(|error| format!("保存硬件导出文件失败: {error}"))?;
    temp_guard.disarm();
    crate::logging::write("[Export:WinGPU] compatible path completed");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn export_frames_to_hardware_encoder(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    composition: &CompositionInput,
    fps: f64,
    total_frames: u64,
    task: Option<&Arc<TaskState>>,
    interop: &InteropDevice,
    d3d12_device: &windows::Win32::Graphics::Direct3D12::ID3D12Device,
    d3d12_queue: &windows::Win32::Graphics::Direct3D12::ID3D12CommandQueue,
    stdin: &mut impl Write,
    system_memory_decode: bool,
) -> Result<(), String> {
    let mut decoders: HashMap<String, VideoDecoder> = HashMap::new();
    let mut static_textures: HashMap<String, (u32, u32, u32)> = HashMap::new();
    let mut unavailable_optional_assets = HashSet::new();
    let mut mask_textures: HashMap<String, u32> = HashMap::new();
    let started = std::time::Instant::now();
    let log_interval = (total_frames / 10).max(1);
    let mut first_frame_logged = false;
    let mut converter = VideoConverter::new(
        &interop.d3d11_device,
        &interop.d3d11_context,
        &interop.d3d11on12_device,
        d3d12_device,
        &interop.interop_queue,
        d3d12_queue,
    )?;

    for frame_index in 0..total_frames {
        if task.is_some_and(|state| state.is_cancelled()) {
            return Err("导出已取消".to_string());
        }
        let frame_started = std::time::Instant::now();
        let time = frame_index as f64 / fps;
        let layer_inputs = composition_layers(composition, time);
        retain_layer_mask_textures(compositor, &mut mask_textures, &layer_inputs);
        let mut source_layers = Vec::with_capacity(layer_inputs.len());
        let mut transient_texture_ids = Vec::new();
        let mut input_leases: Vec<D3d12TextureLease> = Vec::new();
        let mut input_bgra = Vec::new();

        let render_result = (|| -> Result<Vec<u8>, String> {
            for (layer_index, mut layer) in layer_inputs.into_iter().enumerate() {
                if is_optional_positioned_asset(
                    layer.layer_type.as_deref(),
                    layer.positioning.is_some(),
                ) && unavailable_optional_assets.contains(&layer.file_path)
                {
                    continue;
                }
                let (texture_id, width, height) =
                    if crate::compositor::is_procedural_layer_type(layer.layer_type.as_deref()) {
                        (0, 1, 1)
                    } else if layer.is_video {
                        let key = format!("{}@slot{}", layer.file_path, layer_index);
                        let decoder = match decoders.entry(key) {
                            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                            std::collections::hash_map::Entry::Vacant(entry) => {
                                entry.insert(if system_memory_decode {
                                    VideoDecoder::open_system_memory(
                                        &layer.file_path,
                                        &interop.d3d11_device,
                                        &interop.d3d11_context,
                                    )?
                                } else {
                                    VideoDecoder::open(&layer.file_path, &interop.device_manager)?
                                })
                            }
                        };
                        let rotation = decoder.info().rotation_degrees;
                        if rotation != 0 && layer.transform.orientation == 0.0 {
                            layer.transform.orientation = rotation as f64;
                        }
                        let Some(decoded) = decoder.read_frame_at_seconds(layer.video_time)? else {
                            continue;
                        };
                        let bgra = if system_memory_decode {
                            converter.decode_to_bgra_for_export(&decoded)?
                        } else {
                            converter.decode_to_bgra_for_export_synchronized(&decoded)?
                        };
                        let lease = converter.unwrap_for_wgpu(&bgra)?;
                        let resource = lease.resource().clone();
                        input_bgra.push((bgra, decoded.width, decoded.height));
                        input_leases.push(lease);
                        let texture = unsafe {
                            compositor.wrap_external_dx12_texture(
                                resource,
                                decoded.width,
                                decoded.height,
                                wgpu::TextureUsages::TEXTURE_BINDING,
                                true,
                            )?
                        };
                        let texture_id = compositor.register_external_texture(
                            texture,
                            decoded.width,
                            decoded.height,
                        );
                        transient_texture_ids.push(texture_id);
                        (texture_id, decoded.width, decoded.height)
                    } else if let Some(cached) = static_textures.get(&layer.file_path).copied() {
                        cached
                    } else {
                        let decoded = decode_static_image_scaled(
                            ffmpeg_path,
                            ffprobe_path,
                            &layer.file_path,
                            composition.canvas.width.max(composition.canvas.height),
                        );
                        let Some((rgba, width, height)) = tolerate_optional_positioned_asset_error(
                            layer.layer_type.as_deref(),
                            layer.positioning.is_some(),
                            &layer.file_path,
                            &mut unavailable_optional_assets,
                            decoded,
                        )?
                        else {
                            continue;
                        };
                        let uploaded = compositor.load_texture(&rgba, width, height);
                        let Some(texture_id) = tolerate_optional_positioned_asset_error(
                            layer.layer_type.as_deref(),
                            layer.positioning.is_some(),
                            &layer.file_path,
                            &mut unavailable_optional_assets,
                            uploaded,
                        )?
                        else {
                            continue;
                        };
                        let cached = (texture_id, width, height);
                        static_textures.insert(layer.file_path.clone(), cached);
                        cached
                    };
                bind_layer_mask_texture(
                    compositor,
                    ffmpeg_path,
                    ffprobe_path,
                    composition.canvas.width.max(composition.canvas.height),
                    &mut mask_textures,
                    &mut layer,
                )?;
                source_layers.push((
                    layer,
                    PreviewTextureInfo {
                        texture_id,
                        width,
                        height,
                    },
                ));
            }

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
            compositor.render(
                composition.canvas.width,
                composition.canvas.height,
                &planned_layers,
            )
        })();
        for texture_id in transient_texture_ids {
            compositor.unregister_external_texture(texture_id);
        }
        let cleanup_result = if render_result.is_err() {
            compositor.wait_for_gpu()
        } else {
            Ok(())
        };
        let mut sync_error = None;
        for lease in input_leases {
            if let Err(error) = lease.finish() {
                sync_error.get_or_insert(error);
            }
        }
        for (texture, width, height) in input_bgra {
            converter.recycle_bgra_texture(texture, width, height);
        }
        let rgba = match render_result {
            Ok(rgba) => rgba,
            Err(error) => {
                cleanup_result?;
                if let Some(sync_error) = sync_error.take() {
                    return Err(format!("{error}; 清理显卡画面失败: {sync_error}"));
                }
                return Err(error);
            }
        };
        if !first_frame_logged {
            let mut sums = [0u64; 4];
            for pixel in rgba.chunks_exact(4) {
                for (channel, value) in pixel.iter().enumerate() {
                    sums[channel] += u64::from(*value);
                }
            }
            let pixel_count = (rgba.len() / 4).max(1) as f64;
            crate::logging::write(&format!(
                "[Export:WinGPU] compatible first-frame RGBA bytes={} mean={:.2},{:.2},{:.2},{:.2} first={:?}",
                rgba.len(),
                sums[0] as f64 / pixel_count,
                sums[1] as f64 / pixel_count,
                sums[2] as f64 / pixel_count,
                sums[3] as f64 / pixel_count,
                &rgba[..rgba.len().min(16)],
            ));
            first_frame_logged = true;
        }
        cleanup_result?;
        if let Some(error) = sync_error {
            return Err(error);
        }
        stdin
            .write_all(&rgba)
            .map_err(|error| format!("硬件编码器输入失败: {error}"))?;

        if let Some(state) = task {
            state
                .current_frame
                .store(frame_index + 1, std::sync::atomic::Ordering::SeqCst);
        }
        if frame_index % log_interval == 0 || frame_index + 1 == total_frames {
            crate::logging::write(&format!(
                "[Export:WinGPU:Timing] compatible frame={}/{} frame_ms={:.1} elapsed_ms={:.0}",
                frame_index + 1,
                total_frames,
                frame_started.elapsed().as_secs_f64() * 1000.0,
                started.elapsed().as_secs_f64() * 1000.0,
            ));
        }
    }
    for (texture_id, _, _) in static_textures.into_values() {
        let _ = compositor.release_texture(texture_id);
    }
    crate::logging::write(&format!(
        "[Export:WinGPU:Timing] compatible summary frames={} total_ms={:.0}",
        total_frames,
        started.elapsed().as_secs_f64() * 1000.0,
    ));
    Ok(())
}

struct TemporaryOutputGuard {
    path: PathBuf,
    armed: bool,
}

impl TemporaryOutputGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TemporaryOutputGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn export_frames(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    composition: &CompositionInput,
    fps: f64,
    total_frames: u64,
    task: Option<&Arc<TaskState>>,
    converter: &mut NativeVideoConverter,
    _interop: &InteropDevice,
    decoder_device_manager: &windows::Win32::Media::MediaFoundation::IMFDXGIDeviceManager,
    mut writer: VideoEncoder,
    _system_memory_decode: bool,
) -> Result<(), String> {
    let mut decoders: HashMap<String, VideoDecoder> = HashMap::new();
    let mut static_textures: HashMap<String, (u32, u32, u32)> = HashMap::new();
    let mut unavailable_optional_assets = HashSet::new();
    let mut mask_textures: HashMap<String, u32> = HashMap::new();
    let started = std::time::Instant::now();
    let log_interval = (total_frames / 10).max(1);
    let mut decoder_logged = false;

    let export_result = (|| -> Result<(), String> {
        for frame_index in 0..total_frames {
            if task.is_some_and(|state| state.is_cancelled()) {
                return Err("导出已取消".to_string());
            }
            let frame_started = std::time::Instant::now();
            let time = frame_index as f64 / fps;
            let layer_inputs = composition_layers(composition, time);
            retain_layer_mask_textures(compositor, &mut mask_textures, &layer_inputs);
            let mut source_layers = Vec::with_capacity(layer_inputs.len());
            let mut transient_texture_ids = Vec::new();
            // Keep decoder samples alive until all asynchronous D3D11 video
            // processing and the downstream wgpu submission have completed.
            let mut decoded_frames = Vec::new();
            let mut input_leases: Vec<NativeTextureLease> = Vec::new();
            let mut input_bgra: Vec<NativeSharedTexture> = Vec::new();
            let mut output_bgra: Option<NativeSharedTexture> = None;
            let mut output_lease: Option<NativeTextureLease> = None;

            let render_result = (|| -> Result<(), String> {
                for (layer_index, mut layer) in layer_inputs.into_iter().enumerate() {
                    if is_optional_positioned_asset(
                        layer.layer_type.as_deref(),
                        layer.positioning.is_some(),
                    ) && unavailable_optional_assets.contains(&layer.file_path)
                    {
                        continue;
                    }
                    let (texture_id, width, height) = if crate::compositor::is_procedural_layer_type(
                        layer.layer_type.as_deref(),
                    ) {
                        (0, 1, 1)
                    } else if layer.is_video {
                        let key = format!("{}@slot{}", layer.file_path, layer_index);
                        let decoder = match decoders.entry(key) {
                            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                            std::collections::hash_map::Entry::Vacant(entry) => entry.insert(
                                VideoDecoder::open(&layer.file_path, decoder_device_manager)?,
                            ),
                        };
                        let rotation = decoder.info().rotation_degrees;
                        if rotation != 0 && layer.transform.orientation == 0.0 {
                            layer.transform.orientation = rotation as f64;
                        }
                        let Some(decoded) = decoder.read_frame_at_seconds(layer.video_time)? else {
                            continue;
                        };
                        let decoded_width = decoded.width;
                        let decoded_height = decoded.height;
                        if !decoder_logged {
                            crate::logging::write(&format!(
                                    "[Export:WinGPU] decoder=media-foundation output={} size={}x{} rotation={} subresource={} input={}",
                                    decoded.format.label(),
                                    decoded.width,
                                    decoded.height,
                                    decoder.info().rotation_degrees,
                                    decoded.subresource_index,
                                    "d3d11-native-shared-texture",
                                ));
                            decoder_logged = true;
                        }
                        let bgra = converter.decode_to_bgra_for_export(&decoded)?;
                        let lease = converter.wrap_for_wgpu(&bgra)?;
                        let resource = lease.resource().clone();
                        input_bgra.push(bgra);
                        input_leases.push(lease);
                        let texture = unsafe {
                            compositor.wrap_external_dx12_texture(
                                resource,
                                decoded.width,
                                decoded.height,
                                wgpu::TextureUsages::TEXTURE_BINDING,
                                true,
                            )?
                        };
                        let texture_id = compositor.register_external_texture(
                            texture,
                            decoded.width,
                            decoded.height,
                        );
                        transient_texture_ids.push(texture_id);
                        decoded_frames.push(decoded);
                        (texture_id, decoded_width, decoded_height)
                    } else if let Some(cached) = static_textures.get(&layer.file_path).copied() {
                        cached
                    } else {
                        let decoded = decode_static_image_scaled(
                            ffmpeg_path,
                            ffprobe_path,
                            &layer.file_path,
                            composition.canvas.width.max(composition.canvas.height),
                        );
                        let Some((rgba, width, height)) = tolerate_optional_positioned_asset_error(
                            layer.layer_type.as_deref(),
                            layer.positioning.is_some(),
                            &layer.file_path,
                            &mut unavailable_optional_assets,
                            decoded,
                        )?
                        else {
                            continue;
                        };
                        let uploaded = compositor.load_texture(&rgba, width, height);
                        let Some(texture_id) = tolerate_optional_positioned_asset_error(
                            layer.layer_type.as_deref(),
                            layer.positioning.is_some(),
                            &layer.file_path,
                            &mut unavailable_optional_assets,
                            uploaded,
                        )?
                        else {
                            continue;
                        };
                        let cached = (texture_id, width, height);
                        static_textures.insert(layer.file_path.clone(), cached);
                        cached
                    };
                    bind_layer_mask_texture(
                        compositor,
                        ffmpeg_path,
                        ffprobe_path,
                        composition.canvas.width.max(composition.canvas.height),
                        &mut mask_textures,
                        &mut layer,
                    )?;
                    source_layers.push((
                        layer,
                        PreviewTextureInfo {
                            texture_id,
                            width,
                            height,
                        },
                    ));
                }

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

                let target = converter.create_composition_target(
                    composition.canvas.width,
                    composition.canvas.height,
                )?;
                let lease = converter.wrap_for_wgpu(&target)?;
                let resource = lease.resource().clone();
                output_bgra = Some(target);
                output_lease = Some(lease);
                let output_texture = unsafe {
                    compositor.wrap_external_dx12_texture(
                        resource,
                        composition.canvas.width,
                        composition.canvas.height,
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
                Ok(())
            })();

            for texture_id in transient_texture_ids {
                compositor.unregister_external_texture(texture_id);
            }
            // render_into_external_texture already waits for its submission on success.
            // Only wait here when the render body failed and may have left work in flight.
            let cleanup_result = if render_result.is_err() {
                compositor.wait_for_gpu()
            } else {
                Ok(())
            };
            let mut sync_error = None;
            for lease in input_leases {
                if let Err(error) = lease.finish() {
                    sync_error.get_or_insert(error);
                }
            }
            if let Some(lease) = output_lease {
                if let Err(error) = lease.finish() {
                    sync_error.get_or_insert(error);
                }
            }
            if let Err(error) = render_result {
                return Err(match sync_error {
                    Some(sync) => format!("{error}; 清理显卡画面失败: {sync}"),
                    None => error,
                });
            }
            cleanup_result?;
            if let Some(error) = sync_error {
                return Err(error);
            }
            let output_bgra = output_bgra.ok_or_else(|| "合成画面没有生成".to_string())?;
            let nv12 = converter.bgra_to_nv12(
                output_bgra,
                composition.canvas.width,
                composition.canvas.height,
            )?;
            for texture in input_bgra {
                converter.recycle_bgra_texture(texture);
            }
            writer.append(&nv12, frame_index)?;

            if let Some(state) = task {
                state
                    .current_frame
                    .store(frame_index + 1, std::sync::atomic::Ordering::SeqCst);
            }
            if frame_index % log_interval == 0 || frame_index + 1 == total_frames {
                crate::logging::write(&format!(
                    "[Export:WinGPU:Timing] frame={}/{} frame_ms={:.1} elapsed_ms={:.0}",
                    frame_index + 1,
                    total_frames,
                    frame_started.elapsed().as_secs_f64() * 1000.0,
                    started.elapsed().as_secs_f64() * 1000.0,
                ));
            }
        }

        writer.finish()?;
        Ok(())
    })();
    for (texture_id, _, _) in static_textures.into_values() {
        let _ = compositor.release_texture(texture_id);
    }
    export_result?;
    crate::logging::write(&format!(
        "[Export:WinGPU:Timing] summary frames={} total_ms={:.0}",
        total_frames,
        started.elapsed().as_secs_f64() * 1000.0,
    ));
    Ok(())
}
