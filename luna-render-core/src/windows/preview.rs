use std::collections::{HashMap, HashSet, VecDeque};

use windows::Win32::Graphics::Direct3D12::ID3D12Resource;

use crate::composition::{composition_layers, retain_layer_mask_textures, CompositionInput};
use crate::compositor::{
    is_optional_positioned_asset, is_procedural_layer_type,
    tolerate_optional_positioned_asset_error, Compositor, PreviewTextureInfo,
};
use crate::media::{decode_static_image_scaled, fit_output_size};

use super::converter::VideoConverter;
use super::decoder::VideoDecoder;
use super::device::InteropDevice;
use super::preview_surface::{PreviewBounds, PreviewSurface};
use super::{ComGuard, MediaFoundationGuard};

const MAX_FRAME_CACHE_BYTES: u64 = 256 * 1024 * 1024;

pub(crate) struct NativePreviewRuntime {
    compositor: Compositor,
    surface: PreviewSurface,
    interop: InteropDevice,
    converter: VideoConverter,
    ffmpeg_path: String,
    ffprobe_path: String,
    composition: CompositionInput,
    decoders: HashMap<String, VideoDecoder>,
    frame_cache: HashMap<String, VecDeque<CachedVideoFrame>>,
    static_textures: HashMap<String, (u32, u32, u32)>,
    unavailable_optional_assets: HashSet<String>,
    mask_textures: HashMap<String, u32>,
    desired_visible: bool,
    has_presented: bool,
    _media_foundation: MediaFoundationGuard,
    _com: ComGuard,
}

struct CachedVideoFrame {
    time: f64,
    resource: ID3D12Resource,
    width: u32,
    height: u32,
}

pub(crate) struct NativePreviewRenderResult {
    pub(crate) presented: bool,
    pub(crate) cache_hits: u32,
    pub(crate) cache_misses: u32,
}

impl NativePreviewRuntime {
    pub(crate) fn new(
        parent: usize,
        bounds: PreviewBounds,
        ffmpeg_path: String,
        ffprobe_path: String,
        composition: CompositionInput,
        log_path: Option<&str>,
    ) -> Result<Self, String> {
        let com = ComGuard::start()?;
        let media_foundation = MediaFoundationGuard::start()?;
        let compositor = Compositor::new(log_path)?;
        let (device, queue) = compositor.dx12_device_and_queue()?;
        let interop = InteropDevice::new(&device)?;
        let converter = VideoConverter::new(&device, &interop.video_process_queue, &queue)?;
        let surface = PreviewSurface::new(
            windows::Win32::Foundation::HWND(parent as *mut _),
            &queue,
            bounds,
        )?;
        crate::logging::write(
            "[Preview:WinGPU] backend=d3d12-video pixel_transport=GPU bitstream_readback=CPU",
        );
        Ok(Self {
            compositor,
            surface,
            interop,
            converter,
            ffmpeg_path,
            ffprobe_path,
            composition,
            decoders: HashMap::new(),
            frame_cache: HashMap::new(),
            static_textures: HashMap::new(),
            unavailable_optional_assets: HashSet::new(),
            mask_textures: HashMap::new(),
            desired_visible: true,
            has_presented: false,
            _media_foundation: media_foundation,
            _com: com,
        })
    }

    pub(crate) fn set_bounds(&mut self, bounds: PreviewBounds) -> Result<(), String> {
        let previous_max_side = self.surface.width.max(self.surface.height);
        self.surface.set_bounds(&self.compositor, bounds)?;
        if self.surface.width.max(self.surface.height) != previous_max_side {
            self.clear_frame_cache();
        }
        self.surface
            .set_visible(self.desired_visible && self.has_presented);
        Ok(())
    }

    fn clear_frame_cache(&mut self) {
        let cached = std::mem::take(&mut self.frame_cache);
        for frames in cached.into_values() {
            for frame in frames {
                self.converter
                    .recycle_bgra_texture(frame.resource, frame.width, frame.height);
            }
        }
    }

    fn retain_active_resources(&mut self, active: &HashSet<&str>) {
        let stale_frame_keys = self
            .frame_cache
            .keys()
            .filter(|key| !active.iter().any(|path| key.starts_with(*path)))
            .cloned()
            .collect::<Vec<_>>();
        for key in stale_frame_keys {
            if let Some(frames) = self.frame_cache.remove(&key) {
                for frame in frames {
                    self.converter
                        .recycle_bgra_texture(frame.resource, frame.width, frame.height);
                }
            }
        }

        let stale_static_paths = self
            .static_textures
            .keys()
            .filter(|path| !active.contains(path.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        for path in stale_static_paths {
            if let Some((texture_id, _, _)) = self.static_textures.remove(&path) {
                let _ = self.compositor.release_texture(texture_id);
            }
        }
    }

    pub(crate) fn set_visible(&mut self, visible: bool) {
        self.desired_visible = visible;
        self.surface.set_visible(visible && self.has_presented);
    }

    pub(crate) fn pump_events(&self) {
        self.surface.pump_messages();
    }

    pub(crate) fn update_composition(&mut self, composition: CompositionInput) {
        let active = composition
            .layers
            .iter()
            .map(|layer| layer.source.path.as_str())
            .collect::<HashSet<_>>();
        let previous_active = self
            .composition
            .layers
            .iter()
            .map(|layer| layer.source.path.as_str())
            .collect::<HashSet<_>>();
        if active != previous_active {
            self.clear_frame_cache();
            self.decoders.clear();
        } else {
            self.decoders
                .retain(|key, _| active.iter().any(|path| key.starts_with(*path)));
        }
        self.retain_active_resources(&active);
        self.composition = composition;
    }

    fn video_frame(
        &mut self,
        key: &str,
        path: &str,
        time: f64,
        max_side: u32,
    ) -> Result<Option<(ID3D12Resource, u32, u32, u32, bool)>, String> {
        if let Some(frame) = self.frame_cache.get(key).and_then(|frames| {
            frames
                .iter()
                .min_by(|left, right| {
                    (left.time - time)
                        .abs()
                        .total_cmp(&(right.time - time).abs())
                })
                .filter(|frame| (frame.time - time).abs() <= 1.0 / 120.0)
        }) {
            let rotation = self
                .decoders
                .get(key)
                .map(|decoder| decoder.info().rotation_degrees)
                .unwrap_or(0);
            return Ok(Some((
                frame.resource.clone(),
                frame.width,
                frame.height,
                rotation,
                true,
            )));
        }

        let decoder = match self.decoders.entry(key.to_string()) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => entry.insert(VideoDecoder::open(
                path,
                self.interop
                    .decoder_device_manager
                    .as_ref()
                    .ok_or_else(|| "Media Foundation preview decoder is unavailable".to_string())?,
            )?),
        };
        let rotation = decoder.info().rotation_degrees;
        let Some(frame) = decoder.read_frame_at_seconds(time)? else {
            return Ok(None);
        };
        let (width, height) = fit_output_size(frame.width, frame.height, max_side.max(1));
        let resource = self
            .converter
            .decode_to_bgra_scaled(&frame, width, height)?;
        let frame_time = frame.timestamp_100ns as f64 / 10_000_000.0;
        let evicted = {
            let frames = self.frame_cache.entry(key.to_string()).or_default();
            frames.push_back(CachedVideoFrame {
                time: frame_time,
                resource: resource.clone(),
                width,
                height,
            });
            let mut evicted = Vec::new();
            while frames.len() > 3
                || frames
                    .iter()
                    .map(|frame| frame.width as u64 * frame.height as u64 * 4)
                    .sum::<u64>()
                    > MAX_FRAME_CACHE_BYTES
            {
                if let Some(frame) = frames.pop_front() {
                    evicted.push(frame);
                }
            }
            evicted
        };
        for frame in evicted {
            self.converter
                .recycle_bgra_texture(frame.resource, frame.width, frame.height);
        }
        Ok(Some((resource, width, height, rotation, false)))
    }

    pub(crate) fn render(&mut self, time: f64) -> Result<NativePreviewRenderResult, String> {
        self.surface.pump_messages();
        let output_width = self.surface.width;
        let output_height = self.surface.height;
        let layer_inputs = composition_layers(&self.composition, time);
        retain_layer_mask_textures(&mut self.compositor, &mut self.mask_textures, &layer_inputs);
        let mut source_layers = Vec::with_capacity(layer_inputs.len());
        let mut texture_ids = Vec::new();
        let mut hits = 0;
        let mut misses = 0;

        let result = (|| -> Result<(), String> {
            for (index, mut layer) in layer_inputs.into_iter().enumerate() {
                if is_optional_positioned_asset(
                    layer.layer_type.as_deref(),
                    layer.positioning.is_some(),
                ) && self.unavailable_optional_assets.contains(&layer.file_path)
                {
                    continue;
                }
                let (texture_id, width, height) =
                    if is_procedural_layer_type(layer.layer_type.as_deref()) {
                        (0, 1, 1)
                    } else if layer.is_video {
                        let key = format!("{}@slot{}", layer.file_path, index);
                        let Some((resource, width, height, rotation, cache_hit)) = self
                            .video_frame(
                                &key,
                                &layer.file_path,
                                layer.video_time,
                                output_width.max(output_height),
                            )?
                        else {
                            continue;
                        };
                        if rotation != 0 && layer.transform.orientation == 0.0 {
                            layer.transform.orientation = rotation as f64;
                        }
                        if cache_hit {
                            hits += 1;
                        } else {
                            misses += 1;
                        }
                        let texture = unsafe {
                            self.compositor.wrap_external_dx12_texture(
                                resource,
                                width,
                                height,
                                wgpu::TextureUsages::TEXTURE_BINDING,
                                true,
                            )?
                        };
                        let id = self
                            .compositor
                            .register_external_texture(texture, width, height);
                        texture_ids.push(id);
                        (id, width, height)
                    } else if let Some(cached) = self.static_textures.get(&layer.file_path).copied()
                    {
                        cached
                    } else {
                        let decoded = decode_static_image_scaled(
                            &self.ffmpeg_path,
                            &self.ffprobe_path,
                            &layer.file_path,
                            output_width.max(output_height),
                        );
                        let Some((rgba, width, height)) = tolerate_optional_positioned_asset_error(
                            layer.layer_type.as_deref(),
                            layer.positioning.is_some(),
                            &layer.file_path,
                            &mut self.unavailable_optional_assets,
                            decoded,
                        )?
                        else {
                            continue;
                        };
                        let uploaded = self.compositor.load_texture(&rgba, width, height);
                        let Some(id) = tolerate_optional_positioned_asset_error(
                            layer.layer_type.as_deref(),
                            layer.positioning.is_some(),
                            &layer.file_path,
                            &mut self.unavailable_optional_assets,
                            uploaded,
                        )?
                        else {
                            continue;
                        };
                        self.static_textures
                            .insert(layer.file_path.clone(), (id, width, height));
                        (id, width, height)
                    };

                if let Some(mask_path) = layer.mask_path.as_deref() {
                    let mask_id = if let Some(id) = self.mask_textures.get(mask_path).copied() {
                        id
                    } else {
                        let (rgba, width, height) = decode_static_image_scaled(
                            &self.ffmpeg_path,
                            &self.ffprobe_path,
                            mask_path,
                            output_width.max(output_height),
                        )?;
                        let id = self
                            .compositor
                            .load_external_mask_texture(&rgba, width, height)?;
                        self.mask_textures.insert(mask_path.to_string(), id);
                        id
                    };
                    layer.mask_texture_id = Some(mask_id);
                }
                source_layers.push((
                    layer,
                    PreviewTextureInfo {
                        texture_id,
                        width,
                        height,
                    },
                ));
            }

            let planned = self
                .compositor
                .plan_preview(
                    Some(self.composition.canvas.width),
                    Some(self.composition.canvas.height),
                    Some(output_width.max(output_height)),
                    &source_layers,
                )?
                .layers;
            let back_buffer = self.surface.acquire()?;
            let target = unsafe {
                self.compositor.wrap_external_dx12_texture(
                    back_buffer,
                    output_width,
                    output_height,
                    wgpu::TextureUsages::RENDER_ATTACHMENT,
                    false,
                )?
            };
            self.compositor.render_into_present_texture(
                target,
                output_width,
                output_height,
                &planned,
            )?;
            Ok(())
        })();

        for id in texture_ids {
            self.compositor.unregister_external_texture(id);
        }
        let cleanup_result = if result.is_err() {
            self.compositor.wait_for_gpu()
        } else {
            Ok(())
        };
        result?;
        cleanup_result?;
        self.surface.present()?;
        if !self.has_presented {
            self.has_presented = true;
            self.surface.set_visible(self.desired_visible);
        }
        self.surface.pump_messages();
        Ok(NativePreviewRenderResult {
            presented: true,
            cache_hits: hits,
            cache_misses: misses,
        })
    }
}
