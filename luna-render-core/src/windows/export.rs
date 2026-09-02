use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
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
use crate::media::decode_static_image_scaled;

use super::converter::{D3d12TextureLease, VideoConverter};
use super::decoder::VideoDecoder;
use super::device::InteropDevice;
use super::encoder_backend::{EncoderConfig, EncoderManager, GpuFrame, VideoCodec};

fn temporary_bitstream_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.d3d12-bitstream.partial"))
}

fn temporary_video_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.d3d12-video.partial.mp4"))
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
}

fn finish_export_video_inputs(
    converter: &mut VideoConverter,
    inputs: Vec<ExportVideoInput>,
) -> Option<String> {
    let mut first_error = None;
    for input in inputs {
        match input.lease.finish() {
            Ok(()) => converter.recycle_bgra_texture(input.resource, input.width, input.height),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        };
    }
    first_error
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
    capabilities: super::capabilities::EncoderCapabilities,
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
        capabilities,
        d3d12_device,
        &interop.video_encode_queue,
    )?;
    let mut bitstream = File::create(&bitstream_path)
        .map_err(|error| format!("failed to create D3D12 bitstream output: {error}"))?;
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
        .map_err(|error| format!("failed to flush D3D12 bitstream output: {error}"))?;

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
    let mut decoders: HashMap<String, VideoDecoder> = HashMap::new();
    let mut static_textures: HashMap<String, (u32, u32, u32)> = HashMap::new();
    let mut unavailable_optional_assets = HashSet::new();
    let mut mask_textures: HashMap<String, u32> = HashMap::new();
    let started = std::time::Instant::now();
    let log_interval = (total_frames / 10).max(1);
    let mut decoder_logged = false;

    for frame_index in 0..total_frames {
        if task.is_some_and(|state| state.is_cancelled()) {
            return Err("export cancelled".to_string());
        }
        let frame_started = std::time::Instant::now();
        let time = frame_index as f64 / fps.max(1.0);
        let layer_inputs = composition_layers(composition, time);
        retain_layer_mask_textures(compositor, &mut mask_textures, &layer_inputs);
        let mut source_layers = Vec::with_capacity(layer_inputs.len());
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
                    let key = format!("{}@slot{}", layer.file_path, layer_index);
                    let decoder = match decoders.entry(key) {
                        std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                        std::collections::hash_map::Entry::Vacant(entry) => entry.insert(
                            VideoDecoder::open(&layer.file_path, &interop.decoder_device_manager)?,
                        ),
                    };
                    let rotation = decoder.info().rotation_degrees;
                    if rotation != 0 && layer.transform.orientation == 0.0 {
                        layer.transform.orientation = rotation as f64;
                    }
                    let Some(decoded) = decoder.read_frame_at_seconds(layer.video_time)? else {
                        continue;
                    };
                    if !decoder_logged {
                        crate::logging::write(&format!(
                                "[Export:WinGPU] decoder=media-foundation format={} size={}x{} transport=GPU",
                                decoded.format.label(),
                                decoded.width,
                                decoded.height,
                            ));
                        decoder_logged = true;
                    }
                    let bgra = converter.decode_to_bgra_for_export(&decoded)?;
                    // The video-process queue may still be writing this texture. Keep
                    // the GPU-only lease until the compositor submission has finished.
                    let lease = converter.wrap_for_wgpu(&bgra)?;
                    let resource = lease.resource().clone();
                    input_resources.push(ExportVideoInput {
                        resource: bgra,
                        width: decoded.width,
                        height: decoded.height,
                        lease,
                    });
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
            compositor.render_for_native_export(
                composition.canvas.width,
                composition.canvas.height,
                &planned_layers,
            )
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
            render_resource,
            composition.canvas.width,
            composition.canvas.height,
        );
        let encoded_frame = converter.convert_for_encoder(&frame, encoder.input_format())?;
        let packet = encoder.encode(encoded_frame, frame_index)?;
        bitstream
            .write_all(&packet.data)
            .map_err(|error| format!("failed to write encoded bitstream packet: {error}"))?;

        if let Some(state) = task {
            state
                .current_frame
                .store(frame_index + 1, std::sync::atomic::Ordering::SeqCst);
        }
        if frame_index % log_interval == 0 || frame_index + 1 == total_frames {
            crate::logging::write(&format!(
                "[Export:WinGPU:Timing] backend=d3d12-video frame={}/{} frame_ms={:.1} elapsed_ms={:.0}",
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
        "[Export:WinGPU:Timing] backend=d3d12-video frames={} total_ms={:.0}",
        total_frames,
        started.elapsed().as_secs_f64() * 1000.0,
    ));
    Ok(())
}
