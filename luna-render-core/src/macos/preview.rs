use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::c_void;

use super::{is_procedural_layer, Decoder, Frame};
use crate::composition::{composition_layers, retain_layer_mask_textures, CompositionInput};
use crate::compositor::is_optional_positioned_asset;
use crate::compositor::{tolerate_optional_positioned_asset_error, Compositor, PreviewTextureInfo};
use crate::media::decode_static_image_scaled;

#[repr(C)]
#[derive(Default)]
struct LunaPreviewDrawableRaw {
    handle: *mut c_void,
    metal_texture: *mut c_void,
    width: u32,
    height: u32,
}

unsafe extern "C" {
    fn luna_preview_surface_create(
        parent_view: *mut c_void,
        metal_device: *mut c_void,
    ) -> *mut c_void;
    fn luna_preview_surface_set_bounds(
        surface: *mut c_void,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale_factor: f64,
    );
    fn luna_preview_surface_set_visible(surface: *mut c_void, visible: bool);
    fn luna_preview_surface_acquire(
        surface: *mut c_void,
        output: *mut LunaPreviewDrawableRaw,
    ) -> bool;
    fn luna_preview_drawable_present(drawable: *mut c_void);
    fn luna_preview_drawable_discard(drawable: *mut c_void);
    fn luna_preview_surface_destroy(surface: *mut c_void);
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PreviewBounds {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) scale_factor: f64,
}

pub(crate) struct PreviewSurface {
    raw: *mut c_void,
}

impl PreviewSurface {
    pub(crate) fn new(compositor: &Compositor, parent_view: *mut c_void) -> Result<Self, String> {
        let metal_device = compositor.metal_device_ptr()?;
        let raw = unsafe { luna_preview_surface_create(parent_view, metal_device) };
        if raw.is_null() {
            Err("无法创建原生预览画面".to_string())
        } else {
            Ok(Self { raw })
        }
    }

    pub(crate) fn set_bounds(&mut self, bounds: PreviewBounds) {
        unsafe {
            luna_preview_surface_set_bounds(
                self.raw,
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                bounds.scale_factor,
            )
        };
    }

    pub(crate) fn set_visible(&mut self, visible: bool) {
        unsafe { luna_preview_surface_set_visible(self.raw, visible) };
    }

    pub(crate) fn acquire(&mut self) -> Option<PreviewDrawable> {
        let mut raw = LunaPreviewDrawableRaw::default();
        unsafe { luna_preview_surface_acquire(self.raw, &mut raw) }
            .then_some(PreviewDrawable { raw })
    }
}

impl Drop for PreviewSurface {
    fn drop(&mut self) {
        unsafe { luna_preview_surface_destroy(self.raw) };
    }
}

pub(crate) struct PreviewDrawable {
    raw: LunaPreviewDrawableRaw,
}

impl PreviewDrawable {
    pub(crate) fn width(&self) -> u32 {
        self.raw.width
    }

    pub(crate) fn height(&self) -> u32 {
        self.raw.height
    }

    pub(crate) unsafe fn wrap_texture(
        &self,
        compositor: &Compositor,
    ) -> Result<wgpu::Texture, String> {
        unsafe {
            compositor.wrap_external_metal_texture(
                self.raw.metal_texture,
                self.raw.width,
                self.raw.height,
                wgpu::TextureUsages::RENDER_ATTACHMENT,
                false,
            )
        }
    }

    pub(crate) fn present(mut self) {
        unsafe { luna_preview_drawable_present(self.raw.handle) };
        self.raw.handle = std::ptr::null_mut();
    }
}

impl Drop for PreviewDrawable {
    fn drop(&mut self) {
        if !self.raw.handle.is_null() {
            unsafe { luna_preview_drawable_discard(self.raw.handle) };
        }
    }
}

struct CachedVideoFrame {
    time: f64,
    bytes: u64,
    frame: Frame,
}

pub(crate) struct NativePreviewRuntime {
    compositor: Compositor,
    surface: PreviewSurface,
    ffmpeg_path: String,
    ffprobe_path: String,
    composition: CompositionInput,
    decoders: HashMap<String, Decoder>,
    frame_cache: HashMap<String, VecDeque<CachedVideoFrame>>,
    cached_frame_bytes: u64,
    max_frame_cache_bytes: u64,
    static_textures: HashMap<String, (u32, u32, u32)>,
    unavailable_optional_assets: HashSet<String>,
    mask_textures: HashMap<String, u32>,
}

pub(crate) struct NativePreviewRenderResult {
    pub(crate) presented: bool,
    pub(crate) cache_hits: u32,
    pub(crate) cache_misses: u32,
}

impl NativePreviewRuntime {
    pub(crate) fn new(
        parent_view: *mut c_void,
        bounds: PreviewBounds,
        ffmpeg_path: String,
        ffprobe_path: String,
        composition: CompositionInput,
        log_path: Option<&str>,
    ) -> Result<Self, String> {
        let compositor = Compositor::new(log_path)?;
        let mut surface = PreviewSurface::new(&compositor, parent_view)?;
        surface.set_bounds(bounds);
        surface.set_visible(true);
        Ok(Self {
            compositor,
            surface,
            ffmpeg_path,
            ffprobe_path,
            composition,
            decoders: HashMap::new(),
            frame_cache: HashMap::new(),
            cached_frame_bytes: 0,
            max_frame_cache_bytes: 256 * 1024 * 1024,
            static_textures: HashMap::new(),
            unavailable_optional_assets: HashSet::new(),
            mask_textures: HashMap::new(),
        })
    }

    pub(crate) fn set_bounds(&mut self, bounds: PreviewBounds) {
        self.surface.set_bounds(bounds);
    }

    pub(crate) fn set_visible(&mut self, visible: bool) {
        self.surface.set_visible(visible);
    }

    pub(crate) fn update_composition(&mut self, composition: CompositionInput) {
        let active_paths = composition
            .layers
            .iter()
            .map(|layer| layer.source.path.as_str())
            .collect::<std::collections::HashSet<_>>();
        self.decoders
            .retain(|key, _| active_paths.iter().any(|path| key.starts_with(*path)));
        self.frame_cache
            .retain(|key, _| active_paths.iter().any(|path| key.starts_with(*path)));
        self.composition = composition;
        self.recount_frame_cache();
    }

    fn recount_frame_cache(&mut self) {
        self.cached_frame_bytes = self
            .frame_cache
            .values()
            .flatten()
            .map(|entry| entry.bytes)
            .sum();
    }

    fn cached_frame_index(&self, key: &str, time: f64) -> Option<usize> {
        self.frame_cache.get(key).and_then(|frames| {
            frames
                .iter()
                .enumerate()
                .min_by(|(_, left), (_, right)| {
                    (left.time - time)
                        .abs()
                        .total_cmp(&(right.time - time).abs())
                })
                .and_then(|(index, frame)| {
                    ((frame.time - time).abs() <= 1.0 / 120.0).then_some(index)
                })
        })
    }

    fn frame_for_time(
        &mut self,
        key: &str,
        path: &str,
        time: f64,
        max_edge: u32,
    ) -> Result<Option<(usize, bool)>, String> {
        if let Some(index) = self.cached_frame_index(key, time) {
            return Ok(Some((index, true)));
        }
        let metal_device = self.compositor.metal_device_ptr()?;
        let decoder = match self.decoders.entry(key.to_string()) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(Decoder::new(path, metal_device, max_edge.max(360))?)
            }
        };
        let Some(frame) = decoder.frame(time)? else {
            return Ok(None);
        };
        let bytes = frame.raw.width as u64 * frame.raw.height as u64 * 4;
        let frame_time = frame.raw.pts_seconds;
        self.frame_cache
            .entry(key.to_string())
            .or_default()
            .push_back(CachedVideoFrame {
                time: frame_time,
                bytes,
                frame,
            });
        self.cached_frame_bytes += bytes;
        if let Some(frames) = self.frame_cache.get_mut(key) {
            while frames.len() > 8 {
                if let Some(frame) = frames.pop_front() {
                    self.cached_frame_bytes = self.cached_frame_bytes.saturating_sub(frame.bytes);
                }
            }
        }
        self.evict_frame_cache(key);
        let index = self
            .frame_cache
            .get(key)
            .and_then(|frames| frames.len().checked_sub(1))
            .ok_or_else(|| "视频缓存写入失败".to_string())?;
        Ok(Some((index, false)))
    }

    fn evict_frame_cache(&mut self, protected_key: &str) {
        while self.cached_frame_bytes > self.max_frame_cache_bytes {
            let oldest_key = self
                .frame_cache
                .iter()
                .filter_map(|(key, frames)| {
                    if key == protected_key && frames.len() <= 1 {
                        None
                    } else {
                        frames.front().map(|frame| (key.clone(), frame.time))
                    }
                })
                .min_by(|(_, left), (_, right)| left.total_cmp(right))
                .map(|(key, _)| key);
            let Some(key) = oldest_key else {
                break;
            };
            if let Some(frame) = self.frame_cache.get_mut(&key).and_then(VecDeque::pop_front) {
                self.cached_frame_bytes = self.cached_frame_bytes.saturating_sub(frame.bytes);
            }
            if self.frame_cache.get(&key).is_some_and(VecDeque::is_empty) {
                self.frame_cache.remove(&key);
            }
        }
    }

    pub(crate) fn render(&mut self, time: f64) -> Result<NativePreviewRenderResult, String> {
        let Some(drawable) = self.surface.acquire() else {
            return Ok(NativePreviewRenderResult {
                presented: false,
                cache_hits: 0,
                cache_misses: 0,
            });
        };
        let output_width = drawable.width().max(1);
        let output_height = drawable.height().max(1);
        let layer_inputs = composition_layers(&self.composition, time);
        retain_layer_mask_textures(&mut self.compositor, &mut self.mask_textures, &layer_inputs);
        let mut source_layers = Vec::with_capacity(layer_inputs.len());
        let mut transient_texture_ids = Vec::new();
        let mut cache_hits = 0u32;
        let mut cache_misses = 0u32;

        for (layer_index, mut layer) in layer_inputs.into_iter().enumerate() {
            if is_optional_positioned_asset(
                layer.layer_type.as_deref(),
                layer.positioning.is_some(),
            ) && self.unavailable_optional_assets.contains(&layer.file_path)
            {
                continue;
            }
            let (texture_id, width, height) = if is_procedural_layer(layer.layer_type.as_deref()) {
                (0, 1, 1)
            } else if layer.is_video {
                let decode_max_edge = ((layer.dst_w.abs() * output_width as f64).ceil() as u32)
                    .max((layer.dst_h.abs() * output_height as f64).ceil() as u32)
                    .max(360);
                let edge_bucket = decode_max_edge.div_ceil(64) * 64;
                let slot_prefix = format!("{}@slot{}@", layer.file_path, layer_index);
                let key = format!("{slot_prefix}edge{edge_bucket}");
                let stale_keys = self
                    .decoders
                    .keys()
                    .filter(|candidate| {
                        candidate.starts_with(&slot_prefix) && candidate.as_str() != key.as_str()
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                for stale_key in stale_keys {
                    self.decoders.remove(&stale_key);
                    if let Some(frames) = self.frame_cache.remove(&stale_key) {
                        for frame in frames {
                            self.cached_frame_bytes =
                                self.cached_frame_bytes.saturating_sub(frame.bytes);
                        }
                    }
                }
                let Some((cache_index, cache_hit)) =
                    self.frame_for_time(&key, &layer.file_path, layer.video_time, decode_max_edge)?
                else {
                    continue;
                };
                if cache_hit {
                    cache_hits += 1;
                } else {
                    cache_misses += 1;
                }
                let cached = &self.frame_cache[&key][cache_index];
                let decoder = self
                    .decoders
                    .get(&key)
                    .ok_or_else(|| "视频解码器不可用".to_string())?;
                let rotation = decoder.rotation_degrees();
                if rotation != 0 && layer.transform.orientation == 0.0 {
                    layer.transform.orientation = rotation as f64;
                }
                let texture = unsafe {
                    self.compositor.wrap_external_metal_texture(
                        cached.frame.raw.metal_texture,
                        cached.frame.raw.width,
                        cached.frame.raw.height,
                        wgpu::TextureUsages::TEXTURE_BINDING,
                        true,
                    )?
                };
                let texture_id = self.compositor.register_external_texture(
                    texture,
                    cached.frame.raw.width,
                    cached.frame.raw.height,
                );
                transient_texture_ids.push(texture_id);
                (texture_id, cached.frame.raw.width, cached.frame.raw.height)
            } else if let Some(cached) = self.static_textures.get(&layer.file_path).copied() {
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
                let Some(texture_id) = tolerate_optional_positioned_asset_error(
                    layer.layer_type.as_deref(),
                    layer.positioning.is_some(),
                    &layer.file_path,
                    &mut self.unavailable_optional_assets,
                    uploaded,
                )?
                else {
                    continue;
                };
                let cached = (texture_id, width, height);
                self.static_textures.insert(layer.file_path.clone(), cached);
                cached
            };

            if let Some(mask_path) = layer.mask_path.as_deref() {
                let mask_texture_id =
                    if let Some(cached) = self.mask_textures.get(mask_path).copied() {
                        cached
                    } else {
                        let (rgba, mask_width, mask_height) = decode_static_image_scaled(
                            &self.ffmpeg_path,
                            &self.ffprobe_path,
                            mask_path,
                            output_width.max(output_height),
                        )?;
                        let texture_id = self.compositor.load_external_mask_texture(
                            &rgba,
                            mask_width,
                            mask_height,
                        )?;
                        self.mask_textures.insert(mask_path.to_string(), texture_id);
                        texture_id
                    };
                layer.mask_texture_id = Some(mask_texture_id);
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

        let planned_layers = self
            .compositor
            .plan_preview(
                Some(self.composition.canvas.width),
                Some(self.composition.canvas.height),
                Some(output_width.max(output_height)),
                &source_layers,
            )?
            .layers;
        let target = unsafe { drawable.wrap_texture(&self.compositor)? };
        let render_result = self.compositor.render_into_external_texture(
            target,
            output_width,
            output_height,
            &planned_layers,
        );
        for texture_id in transient_texture_ids {
            self.compositor.unregister_external_texture(texture_id);
        }
        render_result?;
        drawable.present();
        Ok(NativePreviewRenderResult {
            presented: true,
            cache_hits,
            cache_misses,
        })
    }
}
