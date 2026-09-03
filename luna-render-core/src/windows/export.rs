use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Stdio};
use std::sync::Arc;

use windows::Win32::Graphics::Direct3D12::{ID3D12CommandQueue, ID3D12Device, ID3D12Resource};

use crate::composition::{
    bind_layer_mask_texture, composition_layers, mux_primary_audio, retain_layer_mask_textures,
    CompositionInput,
};
use crate::compositor::{
    is_optional_positioned_asset, tolerate_optional_positioned_asset_error, Compositor,
    PreviewTextureInfo,
};
use crate::export::TaskState;
use crate::media::{command, decode_static_image_scaled, normalize_local_path, probe_video_info};

use super::converter::{D3d12TextureLease, VideoConverter};
use super::device::InteropDevice;
use super::encoder_backend::{EncoderConfig, EncoderManager, GpuFrame, VideoCodec};
use super::ffmpeg_d3d11::FfmpegD3d11Decoder;

fn temporary_bitstream_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.gpu-bitstream.partial"))
}

fn temporary_video_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.gpu-video.partial.mp4"))
}

fn remove_existing(path: &Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|error| format!("failed to remove {:?}: {error}", path))?;
    }
    Ok(())
}

struct TemporaryArtifacts {
    paths: Vec<PathBuf>,
    armed: bool,
}

impl TemporaryArtifacts {
    fn new(paths: impl IntoIterator<Item = PathBuf>) -> Self {
        Self {
            paths: paths.into_iter().collect(),
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TemporaryArtifacts {
    fn drop(&mut self) {
        if self.armed {
            for path in &self.paths {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

struct ExportVideoInput {
    resource: ID3D12Resource,
    width: u32,
    height: u32,
    lease: D3d12TextureLease,
    recycle: bool,
}

struct FfmpegVideoDecoder {
    process: Child,
    stdout: ChildStdout,
    ffmpeg_path: String,
    source_path: String,
    start_time: f64,
    fps: f64,
    hardware_download_format: String,
    hardware: bool,
    frames_read: u64,
    width: u32,
    height: u32,
    frame_bytes: usize,
}

impl FfmpegVideoDecoder {
    fn open(
        ffmpeg_path: &str,
        ffprobe_path: &str,
        source_path: &str,
        start_time: f64,
        fps: f64,
        max_side: u32,
    ) -> Result<Self, String> {
        let info = probe_video_info(ffprobe_path, source_path)?;
        let max_edge = info.width.max(info.height).max(1);
        let scale = (max_side as f64 / max_edge as f64).min(1.0);
        let width = ((info.width as f64 * scale).round() as u32).max(2) & !1;
        let height = ((info.height as f64 * scale).round() as u32).max(2) & !1;
        let hardware_download_format = if info.pixel_format.contains("10")
            || info.pixel_format.contains("12")
            || info.pixel_format.contains("16")
        {
            "p010le"
        } else {
            "nv12"
        }
        .to_string();
        let (process, stdout) = Self::spawn(
            ffmpeg_path,
            source_path,
            start_time,
            fps,
            width,
            height,
            true,
            &hardware_download_format,
        )?;
        crate::logging::write(&format!(
            "[Export:WinGPU] decoder=ffmpeg-d3d11va codec={} source_format={} download_format={}",
            info.codec_name, info.pixel_format, hardware_download_format,
        ));
        Ok(Self {
            process,
            stdout,
            ffmpeg_path: ffmpeg_path.to_string(),
            source_path: source_path.to_string(),
            start_time,
            fps,
            hardware_download_format,
            hardware: true,
            frames_read: 0,
            width,
            height,
            frame_bytes: (width * height * 4) as usize,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn(
        ffmpeg_path: &str,
        source_path: &str,
        start_time: f64,
        fps: f64,
        width: u32,
        height: u32,
        hardware: bool,
        hardware_download_format: &str,
    ) -> Result<(Child, ChildStdout), String> {
        let mut args = vec![
            "-loglevel".to_string(),
            "error".to_string(),
            "-ss".to_string(),
            format!("{start_time:.6}"),
        ];
        if hardware {
            args.extend([
                "-hwaccel".to_string(),
                "d3d11va".to_string(),
                "-hwaccel_output_format".to_string(),
                "d3d11".to_string(),
            ]);
        }
        args.extend([
            "-i".to_string(),
            normalize_local_path(source_path),
            "-vf".to_string(),
            if hardware {
                format!(
                    "hwdownload,format={hardware_download_format},scale={width}:{height}:flags=lanczos,format=rgba"
                )
            } else {
                format!("scale={width}:{height}:flags=lanczos,format=rgba")
            },
            "-r".to_string(),
            fps.to_string(),
            "-pix_fmt".to_string(),
            "rgba".to_string(),
            "-f".to_string(),
            "rawvideo".to_string(),
            "pipe:1".to_string(),
        ]);
        let mut process = command(ffmpeg_path)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("failed to start compatible video decoder: {error}"))?;
        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| "compatible video decoder did not provide output".to_string())?;
        Ok((process, stdout))
    }

    fn read(&mut self) -> Result<Option<Vec<u8>>, String> {
        let mut rgba = vec![0; self.frame_bytes];
        match self.stdout.read_exact(&mut rgba) {
            Ok(()) => {
                self.frames_read += 1;
                Ok(Some(rgba))
            }
            Err(error) => {
                let status = if error.kind() == std::io::ErrorKind::UnexpectedEof {
                    self.process.wait().ok()
                } else {
                    self.process.try_wait().ok().flatten()
                };
                if status.is_some_and(|status| status.success()) {
                    Ok(None)
                } else if self.hardware {
                    let _ = self.process.kill();
                    let _ = self.process.wait();
                    let resume_time = self.start_time + self.frames_read as f64 / self.fps.max(1.0);
                    crate::logging::write(&format!(
                        "[Export:WinGPU] decoder=ffmpeg-software fallback_reason={} status={status:?} resume={resume_time:.6}",
                        error,
                    ));
                    let (process, stdout) = Self::spawn(
                        &self.ffmpeg_path,
                        &self.source_path,
                        resume_time,
                        self.fps,
                        self.width,
                        self.height,
                        false,
                        &self.hardware_download_format,
                    )?;
                    self.process = process;
                    self.stdout = stdout;
                    self.hardware = false;
                    self.read()
                } else {
                    Err(format!(
                        "compatible video decoder stopped early: {error}; status={status:?}"
                    ))
                }
            }
        }
    }
}

impl Drop for FfmpegVideoDecoder {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}

fn finish_export_video_inputs(
    converter: &mut VideoConverter,
    inputs: Vec<ExportVideoInput>,
) -> Option<String> {
    let mut first_error = None;
    for input in inputs {
        match input.lease.finish() {
            Ok(()) if input.recycle => {
                converter.recycle_bgra_texture(input.resource, input.width, input.height)
            }
            Ok(()) => {}
            Err(error) => {
                first_error.get_or_insert(error);
            }
        };
    }
    first_error
}

fn register_d3d12_video_texture_with_lease(
    compositor: &mut Compositor,
    input_resources: &mut Vec<ExportVideoInput>,
    transient_texture_ids: &mut Vec<u32>,
    bgra: ID3D12Resource,
    width: u32,
    height: u32,
    lease: D3d12TextureLease,
    recycle: bool,
) -> Result<(u32, u32, u32), String> {
    let resource = lease.resource().clone();
    input_resources.push(ExportVideoInput {
        resource: bgra,
        width,
        height,
        lease,
        recycle,
    });
    let texture = unsafe {
        compositor.wrap_external_dx12_texture(
            resource,
            width,
            height,
            wgpu::TextureUsages::TEXTURE_BINDING,
            true,
        )?
    };
    let texture_id = compositor.register_external_texture(texture, width, height);
    transient_texture_ids.push(texture_id);
    Ok((texture_id, width, height))
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
    task: Option<&Arc<TaskState>>,
    interop: &InteropDevice,
    d3d12_device: &ID3D12Device,
    d3d12_queue: &ID3D12CommandQueue,
    _legacy_input_mode: bool,
) -> Result<(), String> {
    let bitstream_path = temporary_bitstream_path(output_path);
    let video_path = temporary_video_path(output_path);
    let mut artifacts = TemporaryArtifacts::new([bitstream_path.clone(), video_path.clone()]);

    let mut converter =
        VideoConverter::new(d3d12_device, &interop.video_process_queue, d3d12_queue)?;
    let config = EncoderConfig {
        width: composition.canvas.width,
        height: composition.canvas.height,
        fps,
        bitrate,
    };
    let mut encoder = EncoderManager::new(
        config,
        d3d12_device,
        d3d12_queue,
        interop.video_encode_queue.as_ref(),
    )?;
    let mut bitstream = File::create(&bitstream_path)
        .map_err(|error| format!("failed to create GPU bitstream output: {error}"))?;
    let headers = encoder.headers()?;
    bitstream
        .write_all(&headers.data)
        .map_err(|error| format!("failed to write codec headers: {error}"))?;

    crate::logging::write(&format!(
        "[Export:WinGPU] backend={} pixel_transport=GPU bitstream_readback=CPU codec={} output={}",
        encoder.backend_kind().label(),
        encoder.codec().label(),
        output_path,
    ));

    encode_frames(
        compositor,
        ffmpeg_path,
        ffprobe_path,
        composition,
        fps,
        total_frames,
        task,
        interop,
        &mut converter,
        &mut encoder,
        &mut bitstream,
    )?;
    for packet in encoder.flush()? {
        crate::logging::write(&format!(
            "[Export:WinGPU] flushed packet frame_index={} bytes={}",
            packet.frame_index,
            packet.data.len()
        ));
        bitstream
            .write_all(&packet.data)
            .map_err(|error| format!("failed to write flushed bitstream packet: {error}"))?;
    }
    bitstream
        .flush()
        .map_err(|error| format!("failed to flush GPU bitstream output: {error}"))?;

    package_bitstream(
        ffmpeg_path,
        &bitstream_path,
        &video_path,
        fps,
        encoder.codec() == VideoCodec::Hevc,
    )?;

    let completed_output = if include_audio {
        mux_primary_audio(
            ffmpeg_path,
            ffprobe_path,
            &video_path,
            output_path,
            composition,
            total_frames as f64 / fps.max(1.0),
        )?
    } else {
        video_path.clone()
    };
    finalize_output(&completed_output, output_path)?;
    artifacts.disarm();
    Ok(())
}

fn package_bitstream(
    ffmpeg_path: &str,
    bitstream_path: &Path,
    output_path: &Path,
    fps: f64,
    hevc: bool,
) -> Result<(), String> {
    remove_existing(output_path)?;
    let input_format = if hevc { "hevc" } else { "h264" };
    let args = [
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-f".to_string(),
        input_format.to_string(),
        "-r".to_string(),
        fps.to_string(),
        "-i".to_string(),
        bitstream_path.to_string_lossy().into_owned(),
        "-c:v".to_string(),
        "copy".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().into_owned(),
    ];
    let output = crate::media::command(ffmpeg_path)
        .args(args)
        .output()
        .map_err(|error| format!("failed to start MP4 packager: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "MP4 packaging failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    crate::logging::write(&format!(
        "[Export:WinGPU] ffmpeg=container-packaging format={} pixel_transport=GPU",
        input_format
    ));
    Ok(())
}

fn finalize_output(completed_output: &Path, output_path: &str) -> Result<(), String> {
    remove_existing(Path::new(output_path))?;
    std::fs::rename(completed_output, output_path)
        .map_err(|error| format!("failed to publish exported video: {error}"))
}

#[allow(clippy::too_many_arguments)]
fn encode_frames(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    composition: &CompositionInput,
    fps: f64,
    total_frames: u64,
    task: Option<&Arc<TaskState>>,
    interop: &InteropDevice,
    converter: &mut VideoConverter,
    encoder: &mut EncoderManager,
    bitstream: &mut File,
) -> Result<(), String> {
    let mut ffmpeg_gpu_decoders: HashMap<String, FfmpegD3d11Decoder> = HashMap::new();
    let mut unavailable_ffmpeg_gpu_decoders = HashSet::new();
    let mut ffmpeg_decoders: HashMap<String, FfmpegVideoDecoder> = HashMap::new();
    let mut static_textures: HashMap<String, (u32, u32, u32)> = HashMap::new();
    let mut unavailable_optional_assets = HashSet::new();
    let mut mask_textures: HashMap<String, u32> = HashMap::new();
    let started = std::time::Instant::now();
    let log_interval = (total_frames / 10).max(1);

    for frame_index in 0..total_frames {
        if task.is_some_and(|state| state.is_cancelled()) {
            return Err("export cancelled".to_string());
        }
        let frame_started = std::time::Instant::now();
        let time = frame_index as f64 / fps.max(1.0);
        let layer_inputs = composition_layers(composition, time);
        retain_layer_mask_textures(compositor, &mut mask_textures, &layer_inputs);
        let mut source_layers = Vec::with_capacity(layer_inputs.len());
        let mut decoded_video_textures: HashMap<(String, u64), (u32, u32, u32)> = HashMap::new();
        let mut transient_texture_ids = Vec::new();
        let mut input_resources = Vec::new();

        let render_result = (|| -> Result<ID3D12Resource, String> {
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
                    let frame_key = (layer.file_path.clone(), layer.video_time.to_bits());
                    if let Some(decoded) = decoded_video_textures.get(&frame_key).copied() {
                        decoded
                    } else {
                        let key = format!("{}@slot{}", layer.file_path, layer_index);
                        if !ffmpeg_gpu_decoders.contains_key(&key)
                            && !unavailable_ffmpeg_gpu_decoders.contains(&key)
                        {
                            match FfmpegD3d11Decoder::open(
                                ffmpeg_path,
                                &layer.file_path,
                                &interop.ffmpeg_d3d11_device,
                                &interop.d3d12_device,
                            ) {
                                Ok(decoder) => {
                                    crate::logging::write(
                                        "[Export:WinGPU] decoder=ffmpeg-in-process-d3d11va transport=D3D11-shared-to-D3D12",
                                    );
                                    ffmpeg_gpu_decoders.insert(key.clone(), decoder);
                                }
                                Err(error) => {
                                    crate::logging::write(&format!(
                                        "[Export:WinGPU] decoder=ffmpeg-d3d11va-subprocess reason=in-process-unavailable detail={error}",
                                    ));
                                    unavailable_ffmpeg_gpu_decoders.insert(key.clone());
                                }
                            }
                        }

                        let gpu_frame = if let Some(decoder) = ffmpeg_gpu_decoders.get_mut(&key) {
                            decoder
                                .read_frame_at_seconds(
                                    layer.video_time,
                                    composition.canvas.width.max(composition.canvas.height),
                                    interop,
                                )
                                .and_then(|frame| {
                                    frame
                                        .map(|frame| {
                                            if frame.format != super::decoder::SurfaceFormat::Bgra8
                                            {
                                                return Err(format!(
                                                    "FFmpeg returned unsupported D3D11 format {}",
                                                    frame.format.label()
                                                ));
                                            }
                                            converter.wait_for_external_surface(
                                                &interop.ffmpeg_d3d12_fence,
                                                frame.ready_fence_value,
                                            )?;
                                            Ok((
                                                frame.resource,
                                                frame.width,
                                                frame.height,
                                                frame.surface_index,
                                            ))
                                        })
                                        .transpose()
                                })
                        } else {
                            Ok(None)
                        };

                        let decoded = match gpu_frame {
                            Ok(Some((bgra, width, height, surface_index))) => {
                                let release_value = interop.reserve_ffmpeg_wgpu_release();
                                ffmpeg_gpu_decoders
                                    .get_mut(&key)
                                    .ok_or_else(|| "FFmpeg GPU decoder disappeared".to_string())?
                                    .set_surface_release(surface_index, release_value)?;
                                let lease = converter.wrap_external_for_wgpu(
                                    &bgra,
                                    &interop.ffmpeg_d3d12_fence,
                                    release_value,
                                )?;
                                register_d3d12_video_texture_with_lease(
                                    compositor,
                                    &mut input_resources,
                                    &mut transient_texture_ids,
                                    bgra,
                                    width,
                                    height,
                                    lease,
                                    false,
                                )?
                            }
                            Ok(None) if ffmpeg_gpu_decoders.contains_key(&key) => continue,
                            Err(error) => {
                                ffmpeg_gpu_decoders.remove(&key);
                                unavailable_ffmpeg_gpu_decoders.insert(key.clone());
                                crate::logging::write(&format!(
                                    "[Export:WinGPU] decoder=ffmpeg-d3d11va-subprocess reason=in-process-failed detail={error}",
                                ));
                                let decoder = FfmpegVideoDecoder::open(
                                    ffmpeg_path,
                                    ffprobe_path,
                                    &layer.file_path,
                                    layer.video_time,
                                    fps,
                                    composition.canvas.width.max(composition.canvas.height),
                                )?;
                                ffmpeg_decoders.insert(key.clone(), decoder);
                                let decoder = ffmpeg_decoders.get_mut(&key).unwrap();
                                let Some(rgba) = decoder.read()? else {
                                    continue;
                                };
                                let texture_id = compositor.load_texture(
                                    &rgba,
                                    decoder.width,
                                    decoder.height,
                                )?;
                                transient_texture_ids.push(texture_id);
                                (texture_id, decoder.width, decoder.height)
                            }
                            Ok(None) => {
                                if !ffmpeg_decoders.contains_key(&key) {
                                    crate::logging::write(
                                        "[Export:WinGPU] decoder=ffmpeg-rgba reason=in-process-unavailable pixel-upload=GPU",
                                    );
                                    ffmpeg_decoders.insert(
                                        key.clone(),
                                        FfmpegVideoDecoder::open(
                                            ffmpeg_path,
                                            ffprobe_path,
                                            &layer.file_path,
                                            layer.video_time,
                                            fps,
                                            composition.canvas.width.max(composition.canvas.height),
                                        )?,
                                    );
                                }
                                let decoder = ffmpeg_decoders.get_mut(&key).unwrap();
                                let Some(rgba) = decoder.read()? else {
                                    continue;
                                };
                                let texture_id = compositor.load_texture(
                                    &rgba,
                                    decoder.width,
                                    decoder.height,
                                )?;
                                transient_texture_ids.push(texture_id);
                                (texture_id, decoder.width, decoder.height)
                            }
                        };
                        decoded_video_textures.insert(frame_key, decoded);
                        decoded
                    }
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
            let render_resource = converter
                .create_composition_target(composition.canvas.width, composition.canvas.height)?;
            let render_texture = unsafe {
                compositor.wrap_external_dx12_texture(
                    render_resource.clone(),
                    composition.canvas.width,
                    composition.canvas.height,
                    wgpu::TextureUsages::RENDER_ATTACHMENT,
                    false,
                )?
            };
            compositor.render_into_external_texture(
                render_texture,
                composition.canvas.width,
                composition.canvas.height,
                &planned_layers,
            )?;
            Ok(render_resource)
        })();

        let cleanup_result = if render_result.is_err() {
            // Keep the external wrappers alive until any partially submitted
            // wgpu work has stopped using their D3D12 resources.
            compositor.wait_for_gpu()
        } else {
            Ok(())
        };
        for texture_id in transient_texture_ids {
            compositor.unregister_external_texture(texture_id);
        }
        let lease_error = finish_export_video_inputs(converter, input_resources);

        let render_resource = match render_result {
            Ok(resource) => resource,
            Err(error) => {
                cleanup_result?;
                if let Some(lease_error) = lease_error {
                    return Err(format!(
                        "{error}; GPU texture handoff failed: {lease_error}"
                    ));
                }
                return Err(error);
            }
        };
        cleanup_result?;
        if let Some(lease_error) = lease_error {
            return Err(lease_error);
        }
        let frame = GpuFrame::rgba8(
            render_resource.clone(),
            composition.canvas.width,
            composition.canvas.height,
        );
        let encoded_frame = converter.convert_for_encoder(&frame, encoder.input_format())?;
        for packet in encoder.encode(encoded_frame, frame_index)? {
            bitstream
                .write_all(&packet.data)
                .map_err(|error| format!("failed to write encoded bitstream packet: {error}"))?;
        }

        if let Some(state) = task {
            state
                .current_frame
                .store(frame_index + 1, std::sync::atomic::Ordering::SeqCst);
        }
        if frame_index % log_interval == 0 || frame_index + 1 == total_frames {
            crate::logging::write(&format!(
                "[Export:WinGPU:Timing] backend=vendor-gpu frame={}/{} frame_ms={:.1} elapsed_ms={:.0}",
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
        "[Export:WinGPU:Timing] backend=vendor-gpu frames={} total_ms={:.0}",
        total_frames,
        started.elapsed().as_secs_f64() * 1000.0,
    ));
    Ok(())
}
