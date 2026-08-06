use std::sync::{LazyLock, Mutex};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use opencut_compositor::{Compositor, FrameDescriptor};
use opencut_gpu::{wgpu, GpuContext};
use opencut_time::{FrameRate, MediaTime};

struct OpenCutRenderer {
    context: GpuContext,
    compositor: Compositor,
}

static OPEN_CUT_RENDERER: LazyLock<Mutex<Option<OpenCutRenderer>>> =
    LazyLock::new(|| Mutex::new(None));

fn lock_open_cut_renderer<T>(
    operation: impl FnOnce(&mut OpenCutRenderer) -> Result<T, String>,
) -> napi::Result<T> {
    let mut guard = OPEN_CUT_RENDERER
        .lock()
        .map_err(|error| napi::Error::from_reason(format!("OpenCut renderer lock: {error}")))?;
    let renderer = guard
        .as_mut()
        .ok_or_else(|| napi::Error::from_reason("OpenCut renderer is not initialized"))?;
    operation(renderer).map_err(napi::Error::from_reason)
}

#[napi(object)]
pub struct OpenCutNativeCapabilities {
    pub compositor: bool,
    pub effects: bool,
    pub masks: bool,
    pub media_time: bool,
    pub onnx_runtime: String,
    pub wasm: bool,
}

#[napi]
pub fn get_open_cut_native_capabilities() -> OpenCutNativeCapabilities {
    // Keep the imported compositor crate linked while its frame adapter is
    // introduced incrementally through the existing Luna preview sessions.
    let _ = std::mem::size_of::<opencut_compositor::FrameDescriptor>();

    OpenCutNativeCapabilities {
        compositor: true,
        effects: true,
        masks: true,
        media_time: true,
        onnx_runtime: "ort-rust".to_string(),
        wasm: false,
    }
}

#[napi]
pub fn init_open_cut_renderer() -> napi::Result<()> {
    let mut guard = OPEN_CUT_RENDERER
        .lock()
        .map_err(|error| napi::Error::from_reason(format!("OpenCut renderer lock: {error}")))?;
    if guard.is_some() {
        return Ok(());
    }

    let context = pollster::block_on(GpuContext::new())
        .map_err(|error| napi::Error::from_reason(format!("Initialize OpenCut GPU: {error}")))?;
    let compositor = Compositor::new(&context);
    *guard = Some(OpenCutRenderer {
        context,
        compositor,
    });
    Ok(())
}

#[napi]
pub fn open_cut_upsert_texture(
    id: String,
    data: Buffer,
    width: u32,
    height: u32,
) -> napi::Result<()> {
    let expected_len = width as usize * height as usize * 4;
    if data.len() != expected_len {
        return Err(napi::Error::from_reason(format!(
            "OpenCut texture '{id}' has {} bytes, expected {expected_len}",
            data.len()
        )));
    }

    lock_open_cut_renderer(|renderer| {
        let texture = renderer
            .context
            .create_render_texture(width, height, "opencut-uploaded-texture");
        let mut pixels = data.to_vec();
        if renderer.context.texture_format() == wgpu::TextureFormat::Bgra8Unorm {
            swap_red_blue(&mut pixels);
        }
        renderer.context.queue().write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        renderer.compositor.upsert_texture(id, texture);
        Ok(())
    })
}

#[napi]
pub fn open_cut_release_texture(id: String) -> napi::Result<()> {
    lock_open_cut_renderer(|renderer| {
        renderer.compositor.release_texture(&id);
        Ok(())
    })
}

#[napi]
pub fn open_cut_render_frame(frame_json: String) -> napi::Result<Buffer> {
    let frame: FrameDescriptor = serde_json::from_str(&frame_json)
        .map_err(|error| napi::Error::from_reason(format!("Invalid OpenCut frame: {error}")))?;
    lock_open_cut_renderer(|renderer| {
        let texture = renderer
            .compositor
            .render_frame_to_texture(&renderer.context, &frame)
            .map_err(|error| format!("Render OpenCut frame: {error}"))?;
        let mut pixels = read_texture(
            &renderer.context,
            &texture,
            frame.width,
            frame.height,
        )?;
        if renderer.context.texture_format() == wgpu::TextureFormat::Bgra8Unorm {
            swap_red_blue(&mut pixels);
        }
        Ok(pixels.into())
    })
}

fn read_texture(
    context: &GpuContext,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let row_bytes = width * 4;
    let padded_row_bytes = row_bytes.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
        * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let buffer = context.device().create_buffer(&wgpu::BufferDescriptor {
        label: Some("opencut-frame-readback"),
        size: u64::from(padded_row_bytes) * u64::from(height),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = context
        .device()
        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("opencut-frame-readback-encoder"),
        });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_row_bytes),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    context.queue().submit([encoder.finish()]);

    let slice = buffer.slice(..);
    let (sender, receiver) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    context
        .device()
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: None,
        })
        .map_err(|error| format!("Poll OpenCut frame readback: {error}"))?;
    receiver
        .recv()
        .map_err(|_| "OpenCut frame readback channel closed".to_string())?
        .map_err(|error| format!("Map OpenCut frame readback: {error}"))?;

    let mapped = slice
        .get_mapped_range()
        .map_err(|error| format!("Read OpenCut frame buffer: {error}"))?;
    let mut pixels = vec![0_u8; row_bytes as usize * height as usize];
    for row in 0..height as usize {
        let source_start = row * padded_row_bytes as usize;
        let target_start = row * row_bytes as usize;
        pixels[target_start..target_start + row_bytes as usize]
            .copy_from_slice(&mapped[source_start..source_start + row_bytes as usize]);
    }
    drop(mapped);
    buffer.unmap();
    Ok(pixels)
}

fn swap_red_blue(pixels: &mut [u8]) {
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
}

#[napi]
pub fn open_cut_media_time_from_seconds(seconds: f64) -> napi::Result<i64> {
    MediaTime::from_seconds_f64(seconds)
        .map(MediaTime::as_ticks)
        .ok_or_else(|| napi::Error::from_reason("Invalid OpenCut media time"))
}

#[napi]
pub fn open_cut_media_time_to_seconds(ticks: i64) -> f64 {
    MediaTime::from_ticks(ticks).to_seconds_f64()
}

#[napi]
pub fn open_cut_round_to_frame(
    ticks: i64,
    numerator: u32,
    denominator: u32,
) -> napi::Result<i64> {
    MediaTime::from_ticks(ticks)
        .round_to_frame(FrameRate::new(numerator, denominator))
        .map(MediaTime::as_ticks)
        .ok_or_else(|| napi::Error::from_reason("Invalid OpenCut frame rate"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_native_runtime_and_frame_aligned_time() {
        let capabilities = get_open_cut_native_capabilities();
        assert!(capabilities.compositor);
        assert!(capabilities.effects);
        assert!(capabilities.masks);
        assert!(!capabilities.wasm);
        assert_eq!(open_cut_media_time_from_seconds(1.5).unwrap(), 180_000);
        assert_eq!(open_cut_round_to_frame(181_000, 30, 1).unwrap(), 180_000);
    }
}
