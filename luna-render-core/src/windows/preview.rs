use std::collections::{HashMap, VecDeque};

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;

use crate::composition::{composition_layers, CompositionInput};
use crate::compositor::{is_procedural_layer_type, Compositor, PreviewTextureInfo};
use crate::media::{decode_static_image_scaled, fit_output_size};

use super::converter::{D3d12TextureLease, VideoConverter};
use super::decoder::VideoDecoder;
use super::device::InteropDevice;
use super::preview_surface::{PreviewBounds, PreviewSurface};
use super::{ComGuard, MediaFoundationGuard};

pub(crate) struct NativePreviewRuntime {
    // 守卫必须覆盖整个会话；Media Foundation 必须在 COM 反初始化前关闭。
    _media_foundation: MediaFoundationGuard,
    _com: ComGuard,
    compositor: Compositor,
    surface: PreviewSurface,
    _interop: InteropDevice,
    converter: VideoConverter,
    ffmpeg_path: String,
    ffprobe_path: String,
    composition: CompositionInput,
    decoders: HashMap<String, VideoDecoder>,
    frame_cache: HashMap<String, VecDeque<CachedVideoFrame>>,
    static_textures: HashMap<String, (u32, u32, u32)>,
    mask_textures: HashMap<String, u32>,
    desired_visible: bool,
    has_presented: bool,
}

struct CachedVideoFrame {
    time: f64,
    texture: ID3D11Texture2D,
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
        let _ = log_path;
        let compositor = crate::new_shared_compositor()?;
        let (device, queue) = compositor.dx12_device_and_queue()?;
        let interop = InteropDevice::new(&device, &queue)?;
        let converter = VideoConverter::new(
            &interop.d3d11_device,
            &interop.d3d11_context,
            &interop.d3d11on12_device,
            &device,
            &queue,
        )?;
        let surface = PreviewSurface::new(HWND(parent as *mut _), &queue, bounds)?;
        Ok(Self {
            _media_foundation: media_foundation,
            _com: com,
            compositor,
            surface,
            _interop: interop,
            converter,
            ffmpeg_path,
            ffprobe_path,
            composition,
            decoders: HashMap::new(),
            frame_cache: HashMap::new(),
            static_textures: HashMap::new(),
            mask_textures: HashMap::new(),
            desired_visible: true,
            has_presented: false,
        })
    }

    pub(crate) fn set_bounds(&mut self, bounds: PreviewBounds) -> Result<(), String> {
        let previous_max_side = self.surface.width.max(self.surface.height);
        self.surface.set_bounds(&self.compositor, bounds)?;
        if self.surface.width.max(self.surface.height) != previous_max_side {
            self.frame_cache.clear();
        }
        self.surface
            .set_visible(self.desired_visible && self.has_presented);
        Ok(())
    }

    pub(crate) fn set_visible(&mut self, visible: bool) {
        self.desired_visible = visible;
        self.surface.set_visible(visible && self.has_presented);
    }

    pub(crate) fn update_composition(&mut self, composition: CompositionInput) {
        let active = composition
            .layers
            .iter()
            .map(|layer| layer.source.path.as_str())
            .collect::<std::collections::HashSet<_>>();
        self.decoders
            .retain(|key, _| active.iter().any(|path| key.starts_with(*path)));
        self.frame_cache
            .retain(|key, _| active.iter().any(|path| key.starts_with(*path)));
        self.composition = composition;
    }

    fn video_frame(
        &mut self,
        key: &str,
        path: &str,
        time: f64,
        max_side: u32,
    ) -> Result<Option<(ID3D11Texture2D, u32, u32, u32, bool)>, String> {
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
                frame.texture.clone(),
                frame.width,
                frame.height,
                rotation,
                true,
            )));
        }
        let decoder = match self.decoders.entry(key.to_string()) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(VideoDecoder::open(path, &self._interop.device_manager)?)
            }
        };
        let rotation = decoder.info().rotation_degrees;
        let Some(frame) = decoder.read_frame_at_seconds(time)? else {
            return Ok(None);
        };
        let (width, height) = fit_output_size(frame.width, frame.height, max_side.max(1));
        let texture = self
            .converter
            .decode_to_bgra_scaled(&frame, width, height)?;
        let frame_time = frame.timestamp_100ns as f64 / 10_000_000.0;
        let frames = self.frame_cache.entry(key.to_string()).or_default();
        frames.push_back(CachedVideoFrame {
            time: frame_time,
            texture: texture.clone(),
            width,
            height,
        });
        while frames.len() > 3 {
            frames.pop_front();
        }
        Ok(Some((texture, width, height, rotation, false)))
    }

    pub(crate) fn render(&mut self, time: f64) -> Result<NativePreviewRenderResult, String> {
        self.surface.pump_messages();
        let output_width = self.surface.width;
        let output_height = self.surface.height;
        let layer_inputs = composition_layers(&self.composition, time);
        let mut source_layers = Vec::with_capacity(layer_inputs.len());
        let mut texture_ids = Vec::new();
        let mut leases: Vec<D3d12TextureLease> = Vec::new();
        let mut hits = 0;
        let mut misses = 0;

        let result = (|| -> Result<(), String> {
            for (index, mut layer) in layer_inputs.into_iter().enumerate() {
                let (texture_id, width, height) =
                    if is_procedural_layer_type(layer.layer_type.as_deref()) {
                        (0, 1, 1)
                    } else if layer.is_video {
                        let key = format!("{}@slot{}", layer.file_path, index);
                        let Some((bgra, width, height, rotation, cache_hit)) = self.video_frame(
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
                        let lease = self.converter.unwrap_for_wgpu(&bgra)?;
                        let texture = unsafe {
                            self.compositor.wrap_external_dx12_texture(
                                lease.resource().clone(),
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
                        leases.push(lease);
                        (id, width, height)
                    } else if let Some(cached) = self.static_textures.get(&layer.file_path).copied()
                    {
                        cached
                    } else {
                        let (rgba, width, height) = decode_static_image_scaled(
                            &self.ffmpeg_path,
                            &self.ffprobe_path,
                            &layer.file_path,
                            output_width.max(output_height),
                        )?;
                        let id = self.compositor.load_texture(&rgba, width, height)?;
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
        let mut sync_error = None;
        for lease in leases {
            if let Err(error) = lease.finish() {
                sync_error.get_or_insert(error);
            }
        }
        result?;
        if let Some(error) = sync_error {
            return Err(error);
        }
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
