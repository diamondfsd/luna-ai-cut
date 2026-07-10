use crate::media::{fit_output_size, probe_video_dimensions};
use crate::RenderLayer;
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use wgpu::TexelCopyBufferInfo;
use wgpu::TexelCopyBufferLayout;
use wgpu::TexelCopyTextureInfo;

/// 静态图纹理 LRU 缓存上限
const MAX_TEXTURE_CACHE: usize = 10;
/// 预览纹理最大边长
const PREVIEW_MAX_SIZE: u32 = 1280; // 从 1920 降低到 1280，减少 56% 数据量

// ── 文件日志 ──
static LOG_FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);

fn log_init(log_path: &str) {
    // 全局 panic hook — 崩溃时写入日志
    std::panic::set_hook(Box::new(|info| {
        let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        log_write(&format!("PANIC at {} — {}", loc, msg));
    }));

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "\n=== LunaRC started at {} ===", ts);
        let _ = file.flush();
        *LOG_FILE.lock().unwrap() = Some(file);
    }
}

pub fn log_write(msg: &str) {
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] {}", ts, msg);
    eprintln!("[LunaRC] {}", line);
    if let Ok(mut guard) = LOG_FILE.lock() {
        if let Some(ref mut file) = *guard {
            let _ = writeln!(file, "{}", line);
            let _ = file.flush();
        }
    }
}

macro_rules! log {
    ($($arg:tt)*) => {
        log_write(&format!($($arg)*))
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        log_write(&format!("ERROR: {}", format!($($arg)*)))
    };
}

pub fn log_error(msg: &str) {
    log_write(&format!("ERROR: {}", msg));
}

// ── WGSL 着色器 ──

const SHADER: &str = concat!(
    include_str!("shaders/vertex.wgsl"),
    include_str!("shaders/params.wgsl"),
    include_str!("shaders/common.wgsl"),
    include_str!("shaders/detail.wgsl"),
    include_str!("shaders/curve.wgsl"),
    include_str!("shaders/color.wgsl"),
    include_str!("shaders/fragment.wgsl"),
);

// ── GPU 数据结构 ──

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuLayerParams {
    dst_x: f32,
    dst_y: f32,
    dst_w: f32,
    dst_h: f32,
    src_x: f32,
    src_y: f32,
    src_w: f32,
    src_h: f32,
    crop_x: f32,
    crop_y: f32,
    crop_w: f32,
    crop_h: f32,
    source_aspect: f32,
    frame_w: f32,
    frame_h: f32,
    opacity: f32,
    exposure: f32,
    black: f32,
    brightness: f32,
    contrast: f32,
    saturation: f32,
    vibrance: f32,
    temperature: f32,
    tint: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    clarity: f32,
    texture: f32,
    sharpen: f32,
    denoise: f32,
    grade_shadows_hue: f32,
    grade_shadows_amount: f32,
    grade_mid_hue: f32,
    grade_mid_amount: f32,
    grade_highlights_hue: f32,
    grade_highlights_amount: f32,
    curve_lift: f32,
    curve_contrast: f32,
    levels_black: f32,
    levels_gray: f32,
    levels_white: f32,
    curve_rgb_count: f32,
    curve_luminance_count: f32,
    curve_red_count: f32,
    curve_green_count: f32,
    curve_blue_count: f32,
    texel_x: f32,
    texel_y: f32,
    orientation: f32,
    rotate: f32,
    flip_h: f32,
    flip_v: f32,
    scale: f32,
    translate_x: f32,
    translate_y: f32,
    lut_size: f32,
    lut_intensity: f32,
    _pad: [f32; 1],
    curve_data: [[f32; 4]; 30],
    hsl_data: [[f32; 4]; 8],
}

struct LutEntry {
    texture: wgpu::Texture,
    size: u32,
}

struct TextureEntry {
    texture: wgpu::Texture,
    width: u32,
    height: u32,
}

fn pack_curve_points(
    curve_data: &mut [[f32; 4]; 30],
    base: usize,
    points: &[crate::RenderCurvePoint],
) -> f32 {
    let count = points.len().min(12);
    for (index, point) in points.iter().take(count).enumerate() {
        let packed = base + index / 2;
        let offset = if index % 2 == 0 { 0 } else { 2 };
        curve_data[packed][offset] = point.x.clamp(0.0, 1.0) as f32;
        curve_data[packed][offset + 1] = point.y.clamp(0.0, 1.0) as f32;
    }
    count as f32
}

fn pack_hsl_channels(channels: &[crate::RenderHslChannelAdjust]) -> [[f32; 4]; 8] {
    let defaults = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 285.0, 320.0];
    let mut data = [[0.0; 4]; 8];
    for (index, default_hue) in defaults.iter().enumerate() {
        let channel = channels.get(index);
        data[index] = [
            channel
                .map(|c| c.hue)
                .unwrap_or(*default_hue)
                .clamp(0.0, 360.0) as f32,
            channel
                .map(|c| c.hue_shift)
                .unwrap_or(0.0)
                .clamp(-180.0, 180.0) as f32,
            channel
                .map(|c| c.saturation)
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0) as f32,
            channel
                .map(|c| c.luminance)
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0) as f32,
        ];
    }
    data
}

// ── render_preview 层输入 ──

/// 单个渲染层描述（静态图或视频帧）
#[derive(Clone)]
pub struct PreviewLayerInput {
    pub file_path: String,
    pub is_video: bool,
    pub video_time: f64,
    pub fit: String,
    pub dst_x: f64,
    pub dst_y: f64,
    pub dst_w: f64,
    pub dst_h: f64,
    pub src_x: f64,
    pub src_y: f64,
    pub src_w: f64,
    pub src_h: f64,
    pub opacity: f64,
    pub z_index: i32,
    pub color: crate::RenderColorAdjustments,
    pub transform: crate::RenderLayerTransform,
    pub positioning: Option<crate::LayerPositioning>,
    pub lut_id: Option<String>,
    pub lut_intensity: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct PreviewTextureInfo {
    pub texture_id: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone)]
pub struct PlannedPreview {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<crate::RenderLayer>,
}

fn plan_layer_rect(
    layer: &PreviewLayerInput,
    _texture: &PreviewTextureInfo,
    _output_width: u32,
    _output_height: u32,
) -> (f64, f64, f64, f64) {
    (layer.dst_x, layer.dst_y, layer.dst_w, layer.dst_h)
}

fn should_swap_orientation(orientation: f64) -> bool {
    let normalized = ((orientation % 180.0) + 180.0) % 180.0;
    (45.0..=135.0).contains(&normalized)
}

fn frame_aspect(texture: &PreviewTextureInfo, orientation: f64) -> f64 {
    let source_aspect = texture.width as f64 / texture.height.max(1) as f64;
    if should_swap_orientation(orientation) {
        1.0 / source_aspect.max(0.001)
    } else {
        source_aspect.max(0.001)
    }
}

fn plan_cover_scale(
    texture: &PreviewTextureInfo,
    target_aspect: f64,
    transform: &mut crate::RenderLayerTransform,
) -> (f64, f64) {
    let source_aspect = texture.width as f64 / texture.height.max(1) as f64;
    let (crop_x, crop_y, crop_w, crop_h) = match transform.crop.as_ref() {
        Some(crop) => {
            let w = crop.w.clamp(0.001, 1.0);
            let h = crop.h.clamp(0.001, 1.0);
            (crop.x.clamp(0.0, 1.0 - w), crop.y.clamp(0.0, 1.0 - h), w, h)
        }
        None => (0.0, 0.0, 1.0, 1.0),
    };
    let frame_w = target_aspect * crop_h / crop_w;
    let frame_h = 1.0;
    let swaps_axes = should_swap_orientation(transform.orientation);
    let (original_frame_w, original_frame_h) = if swaps_axes {
        (1.0, source_aspect)
    } else {
        (source_aspect, 1.0)
    };
    let base_scale = if swaps_axes {
        frame_w.max(frame_h / source_aspect.max(0.001))
    } else {
        (frame_w / source_aspect.max(0.001)).max(frame_h)
    };

    let crop_center_x = crop_x + crop_w / 2.0;
    let crop_center_y = crop_y + crop_h / 2.0;
    let base_translate_x =
        (crop_center_x - 0.5) * frame_w / base_scale - (crop_center_x - 0.5) * original_frame_w;
    let base_translate_y =
        (crop_center_y - 0.5) * frame_h / base_scale - (crop_center_y - 0.5) * original_frame_h;

    transform.scale *= base_scale;
    transform.translate_x = Some(transform.translate_x.unwrap_or(0.0) + base_translate_x);
    transform.translate_y = Some(transform.translate_y.unwrap_or(0.0) + base_translate_y);
    (frame_w, frame_h)
}

fn plan_layer_source_rect(
    layer: &PreviewLayerInput,
    _texture: &PreviewTextureInfo,
    _output_width: u32,
    _output_height: u32,
) -> (f64, f64, f64, f64) {
    (layer.src_x, layer.src_y, layer.src_w, layer.src_h)
}

fn plan_layer_transform(
    layer: &PreviewLayerInput,
    texture: &PreviewTextureInfo,
    output_width: u32,
    output_height: u32,
) -> crate::RenderLayerTransform {
    plan_cover_transform(
        &layer.fit,
        layer.positioning.is_some(),
        layer.dst_w,
        layer.dst_h,
        &layer.transform,
        texture,
        output_width,
        output_height,
    )
}

fn plan_cover_transform(
    fit: &str,
    has_positioning: bool,
    dst_w: f64,
    dst_h: f64,
    source_transform: &crate::RenderLayerTransform,
    texture: &PreviewTextureInfo,
    output_width: u32,
    output_height: u32,
) -> crate::RenderLayerTransform {
    let mut transform = source_transform.clone();
    if fit != "cover" || has_positioning {
        return transform;
    }
    let (crop_x, crop_y, crop_w, crop_h) = match transform.crop.as_ref() {
        Some(crop) => {
            let w = crop.w.clamp(0.001, 1.0);
            let h = crop.h.clamp(0.001, 1.0);
            (crop.x.clamp(0.0, 1.0 - w), crop.y.clamp(0.0, 1.0 - h), w, h)
        }
        None => (0.0, 0.0, 1.0, 1.0),
    };
    let visible_aspect = frame_aspect(texture, transform.orientation) * crop_w / crop_h.max(0.001);
    let layer_pixel_w = (dst_w * output_width as f64).abs().max(1.0);
    let layer_pixel_h = (dst_h * output_height as f64).abs().max(1.0);
    let target_aspect = layer_pixel_w / layer_pixel_h;

    if visible_aspect > target_aspect {
        let next_w = (crop_w * target_aspect / visible_aspect).clamp(0.001, crop_w);
        transform.crop = Some(crate::RenderCropRect {
            x: crop_x + (crop_w - next_w) / 2.0,
            y: crop_y,
            w: next_w,
            h: crop_h,
        });
    } else {
        let next_h = (crop_h * visible_aspect / target_aspect).clamp(0.001, crop_h);
        transform.crop = Some(crate::RenderCropRect {
            x: crop_x,
            y: crop_y + (crop_h - next_h) / 2.0,
            w: crop_w,
            h: next_h,
        });
    }
    transform
}

fn layer_visible_pixel_size(
    texture: &PreviewTextureInfo,
    transform: &crate::RenderLayerTransform,
) -> (u32, u32) {
    let (frame_w, frame_h) = if should_swap_orientation(transform.orientation) {
        (texture.height as f64, texture.width as f64)
    } else {
        (texture.width as f64, texture.height as f64)
    };
    let crop = transform.crop.as_ref();
    let crop_w = crop.map(|c| c.w).unwrap_or(1.0).clamp(0.001, 1.0);
    let crop_h = crop.map(|c| c.h).unwrap_or(1.0).clamp(0.001, 1.0);
    (
        (frame_w * crop_w).round().max(1.0) as u32,
        (frame_h * crop_h).round().max(1.0) as u32,
    )
}

/// 根据相对定位重算 dst，保持纹理比例不变形
fn resolve_positioning(
    positioning: &Option<crate::LayerPositioning>,
    default_x: f64,
    default_y: f64,
    default_w: f64,
    default_h: f64,
    canvas_w: f64,
    canvas_h: f64,
    tex_w: f64,
    tex_h: f64,
) -> (f64, f64, f64, f64) {
    let pos = match positioning {
        Some(p) => p,
        None => return (default_x, default_y, default_w, default_h),
    };

    let canvas_aspect = canvas_w / canvas_h.max(1.0);
    let tex_aspect = tex_w / tex_h.max(1.0);

    // target_width 作为输出画布 UV [0,1] 直接使用
    let dst_w = pos.target_width;
    let dst_h = dst_w * canvas_aspect / tex_aspect;
    let margin_x = pos.margin_x;
    let margin_y = pos.margin_y;

    let (dst_x, dst_y) = match pos.anchor.as_str() {
        "top-left" => (margin_x, margin_y),
        "top-center" => ((1.0 - dst_w) / 2.0, margin_y),
        "top-right" => (1.0 - dst_w - margin_x, margin_y),
        "bottom-left" => (margin_x, 1.0 - dst_h - margin_y),
        "bottom-center" => ((1.0 - dst_w) / 2.0, 1.0 - dst_h - margin_y),
        "bottom-right" => (1.0 - dst_w - margin_x, 1.0 - dst_h - margin_y),
        "center" => ((1.0 - dst_w) / 2.0, (1.0 - dst_h) / 2.0),
        _ => (default_x, default_y),
    };

    (dst_x, dst_y, dst_w, dst_h)
}

// ── Compositor ──

pub struct Compositor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    /// BGRA 格式渲染管线（macOS Metal External / Windows D3D12 Shared）
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pipeline_bgra: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    bind_group_layout: wgpu::BindGroupLayout,

    textures: HashMap<u32, TextureEntry>,
    next_texture_id: u32,
    pub max_texture_size: u32,

    output_texture: Option<(wgpu::Texture, u32, u32)>,

    // ── render_preview 内部状态 ──
    /// 静态图路径→纹理ID LRU 缓存
    texture_cache: HashMap<String, u32>,
    /// LRU 顺序（前=最旧，后=最新）
    cache_order: VecDeque<String>,
    /// 已探测过的静态图片显示尺寸（已应用 EXIF 旋转）
    static_image_probed: HashMap<String, (u32, u32)>,
    /// 已探测过的视频文件信息 <path → (width, height)>
    video_probed: HashMap<String, (u32, u32)>,
    /// 持久 ffmpeg pipe 解码器 <path → VideoDecoder>
    video_decoders: HashMap<String, VideoDecoder>,
    /// 已结束解码的视频路径（EOF / 解码失败 → 该层永久跳过）
    video_decoding_ended: std::collections::HashSet<String>,
    /// 是否禁用重启（export 模式：EOF 永不重启，仅标记结束）
    pub no_video_decoder_restart: bool,
    last_preview_log: Option<(u32, u32, u32, u32, std::time::Instant)>,

    /// 缓存 staging buffer，避免每帧创建/销毁 33MB
    staging_buffer: Option<(wgpu::Buffer, u64)>,

    // ── LUT 3D LUT ──
    /// identity LUT（未启用 LUT 时的默认 3D texture 绑定）
    identity_lut: wgpu::Texture,
    /// 用户加载的 LUT <file_path → LutEntry>
    luts: HashMap<String, LutEntry>,
}

/// 持久 ffmpeg pipe 视频解码器，保持进程存活按序读帧
///
/// 字段顺序重要：stdout 必须在 process 之前 drop，
/// 否则 process.wait() 因 pipe 未关闭而阻塞。
struct VideoDecoder {
    stdout: std::process::ChildStdout,
    #[allow(dead_code)]
    process: std::process::Child,
    scaled_w: u32,
    scaled_h: u32,
    frame_bytes: usize,
    current_time: f64,
    texture_id: Option<u32>,
    /// pipe 已结束或无帧可读，后续不再尝试读取
    decoding_finished: bool,
}

/// 创建 bind group layout（每个 layer 一个，含 LUT 3D texture 可选绑定）
fn layer_bind_group_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("layer bgl"),
        entries: &[
            // binding 0: source texture
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            // binding 1: source sampler
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            // binding 2: uniform params
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: Some(
                        std::num::NonZeroU64::new(std::mem::size_of::<GpuLayerParams>() as u64)
                            .unwrap(),
                    ),
                },
                count: None,
            },
            // binding 3: LUT 3D texture (optional, identity fallback when no LUT)
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D3,
                    multisampled: false,
                },
                count: None,
            },
            // binding 4: LUT sampler (reuses the same sampler)
            wgpu::BindGroupLayoutEntry {
                binding: 4,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    })
}

fn create_compositor_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
    label: &str,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fs_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleStrip,
            ..Default::default()
        },
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        depth_stencil: None,
        cache: None,
    })
}

/// 创建 RGBA8 纹理
/// - `srgb=true`：用于源图纹理和输出帧缓冲（sRGB 编码），GPU 自动做 sRGB↔linear 转换
/// - `srgb=false`：用于 LUT 等数据纹理（线性空间数据）
fn create_rgba_texture(
    device: &wgpu::Device,
    label: &str,
    width: u32,
    height: u32,
    usage: wgpu::TextureUsages,
    mip_level_count: u32,
    srgb: bool,
) -> wgpu::Texture {
    let format = if srgb {
        wgpu::TextureFormat::Rgba8UnormSrgb
    } else {
        wgpu::TextureFormat::Rgba8Unorm
    };
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}

/// 上传 RGBA 数据到纹理（可指定 mip_level）
fn upload_rgba_ex(
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    data: &[u8],
    width: u32,
    height: u32,
    mip_level: u32,
) {
    queue.write_texture(
        TexelCopyTextureInfo {
            texture,
            mip_level,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        data,
        TexelCopyBufferLayout {
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
}

/// 上传 RGBA 数据到纹理 mip 0
fn upload_rgba(queue: &wgpu::Queue, texture: &wgpu::Texture, data: &[u8], width: u32, height: u32) {
    upload_rgba_ex(queue, texture, data, width, height, 0);
}

/// 创建 2×2×2 identity LUT（未启用 LUT 时的默认绑定，采样原值）
fn create_identity_lut(device: &wgpu::Device, queue: &wgpu::Queue) -> wgpu::Texture {
    let size = 2u32;
    let mut data = vec![0u8; (size * size * size * 4) as usize];
    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                let offset = (z * size * size + y * size + x) as usize * 4;
                data[offset] = (x * 255) as u8;
                data[offset + 1] = (y * 255) as u8;
                data[offset + 2] = (z * 255) as u8;
                data[offset + 3] = 255;
            }
        }
    }
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("identity_lut"),
        size: wgpu::Extent3d {
            width: size,
            height: size,
            depth_or_array_layers: size,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D3,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(size * 4),
            rows_per_image: Some(size),
        },
        wgpu::Extent3d {
            width: size,
            height: size,
            depth_or_array_layers: size,
        },
    );
    texture
}

/// 从 .cube 文件内容创建 3D LUT 纹理
fn create_lut_3d_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    size: u32,
    cube_values: &[f32],
) -> wgpu::Texture {
    let n = size as usize;
    let mut rgba = vec![0u8; n * n * n * 4];

    // .cube 文件实际格式：col1=B_out, col2=G_out, col3=R_out（多数 LUT 生成器用 BGR 顺序）
    // wgpu 3D texture 布局：x=R fast, y=G mid, z=B slow → offset = (b*n*n + g*n + r) * 4
    // 重排：.cube col3(R_out) → R, col2(G_out) → G, col1(B_out) → B
    for r in 0..n {
        for g in 0..n {
            for b in 0..n {
                let cube_idx = (r * n * n + g * n + b) * 3;
                let wgpu_offset = (b * n * n + g * n + r) * 4;
                rgba[wgpu_offset] =
                    (cube_values[cube_idx + 2].clamp(0.0, 1.0) * 255.0).round() as u8;
                rgba[wgpu_offset + 1] =
                    (cube_values[cube_idx + 1].clamp(0.0, 1.0) * 255.0).round() as u8;
                rgba[wgpu_offset + 2] =
                    (cube_values[cube_idx].clamp(0.0, 1.0) * 255.0).round() as u8;
                rgba[wgpu_offset + 3] = 255;
            }
        }
    }

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("lut_3d"),
        size: wgpu::Extent3d {
            width: size,
            height: size,
            depth_or_array_layers: size,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D3,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });

    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(size * 4),
            rows_per_image: Some(size),
        },
        wgpu::Extent3d {
            width: size,
            height: size,
            depth_or_array_layers: size,
        },
    );

    texture
}

/// 解析 .cube 格式 LUT 文件内容
fn parse_cube_lut(data: &[u8]) -> Result<(u32, Vec<f32>), String> {
    let text = std::str::from_utf8(data).map_err(|e| format!("not valid utf-8: {}", e))?;
    let mut size: u32 = 0;
    let mut values = Vec::new();

    for line_raw in text.lines() {
        let line = line_raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("LUT_3D_SIZE") {
            size = rest
                .trim()
                .parse::<u32>()
                .map_err(|e| format!("invalid LUT_3D_SIZE: {}", e))?;
            continue;
        }
        if line.starts_with("TITLE")
            || line.starts_with("DOMAIN_MIN")
            || line.starts_with("DOMAIN_MAX")
            || line.starts_with("LUT_1D_SIZE")
        {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let r: f32 = parts[0]
                .parse()
                .map_err(|e| format!("parse float '{}': {}", parts[0], e))?;
            let g: f32 = parts[1]
                .parse()
                .map_err(|e| format!("parse float '{}': {}", parts[1], e))?;
            let b: f32 = parts[2]
                .parse()
                .map_err(|e| format!("parse float '{}': {}", parts[2], e))?;
            values.push(r);
            values.push(g);
            values.push(b);
        }
    }

    if size == 0 {
        return Err("no LUT_3D_SIZE found in .cube data".to_string());
    }
    let expected = (size as usize).pow(3) * 3;
    if values.len() != expected {
        return Err(format!(
            "expected {} RGB values for LUT_3D_SIZE {}, got {}",
            expected,
            size,
            values.len()
        ));
    }

    Ok((size, values))
}

/// 对齐
fn align_to(v: u32, align: u32) -> u32 {
    ((v + align - 1) / align) * align
}

impl Compositor {
    #[cfg(target_os = "macos")]
    pub(crate) fn metal_device_ptr(&self) -> Result<*mut std::ffi::c_void, String> {
        use objc2::rc::Retained;

        let hal_device = unsafe { self.device.as_hal::<wgpu::hal::api::Metal>() }
            .ok_or_else(|| "wgpu 当前没有使用 Metal 后端".to_string())?;
        Ok(Retained::as_ptr(hal_device.raw_device()) as *mut std::ffi::c_void)
    }

    /// 将 CoreVideo 创建的 MTLTexture 包装成同一 Device 下的 wgpu Texture。
    /// 调用方必须确保关联的 CVPixelBuffer 在返回纹理使用结束前保持存活。
    #[cfg(target_os = "macos")]
    pub(crate) unsafe fn wrap_external_metal_texture(
        &self,
        metal_texture: *mut std::ffi::c_void,
        width: u32,
        height: u32,
        usage: wgpu::TextureUsages,
        initialized: bool,
    ) -> Result<wgpu::Texture, String> {
        use objc2::rc::Retained;
        use objc2::runtime::ProtocolObject;
        use objc2_metal::{MTLTexture, MTLTextureType};

        let raw = Retained::<ProtocolObject<dyn MTLTexture>>::retain(metal_texture.cast())
            .ok_or_else(|| "Metal 视频纹理为空".to_string())?;
        let hal_texture = unsafe {
            wgpu::hal::metal::Device::texture_from_raw(
                raw,
                wgpu::TextureFormat::Bgra8UnormSrgb,
                MTLTextureType::Type2D,
                1,
                1,
                wgpu::hal::CopyExtent {
                    width,
                    height,
                    depth: 1,
                },
                None,
            )
        };
        let descriptor = wgpu::TextureDescriptor {
            label: Some("CoreVideo Metal texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8UnormSrgb,
            usage,
            view_formats: &[],
        };
        Ok(unsafe {
            self.device
                .create_texture_from_hal::<wgpu::hal::api::Metal>(
                    hal_texture,
                    &descriptor,
                    if initialized {
                        wgpu::wgt::TextureUses::RESOURCE
                    } else {
                        wgpu::wgt::TextureUses::UNINITIALIZED
                    },
                )
        })
    }

    /// 获取当前 wgpu D3D12 后端的原始 ID3D12Device 指针，供 Media Foundation 桥接使用。
    #[cfg(target_os = "windows")]
    pub(crate) fn d3d12_device_ptr(&self) -> Result<*mut std::ffi::c_void, String> {
        let hal_device = unsafe { self.device.as_hal::<wgpu::hal::api::Dx12>() }
            .ok_or_else(|| "wgpu 当前没有使用 D3D12 后端".to_string())?;
        use windows::core::Interface;
        Ok(hal_device.raw_device().as_raw())
    }

    /// 将外部 D3D12 资源包装成同一 Device 下的 wgpu Texture。
    /// 用于 D3D11On12 零拷贝管线（v2）。
    #[cfg(target_os = "windows")]
    #[allow(dead_code)]
    pub(crate) unsafe fn wrap_external_d3d12_texture(
        &self,
        d3d12_resource: *mut std::ffi::c_void,
        width: u32,
        height: u32,
        usage: wgpu::TextureUsages,
        _initialized: bool,
    ) -> Result<wgpu::Texture, String> {
        use windows::Win32::Graphics::Direct3D12::ID3D12Resource;
        use windows::core::Interface;

        let resource = unsafe { ID3D12Resource::from_raw(d3d12_resource) };
        let hal_texture = unsafe {
            wgpu::hal::dx12::Device::texture_from_raw(
                resource,
                wgpu::TextureFormat::Bgra8UnormSrgb,
                wgpu::TextureDimension::D2,
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                1,
                1,
            )
        };
        let descriptor = wgpu::TextureDescriptor {
            label: Some("D3D12 external texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8UnormSrgb,
            usage,
            view_formats: &[],
        };
        Ok(unsafe {
            self.device
                .create_texture_from_hal::<wgpu::hal::api::Dx12>(
                    hal_texture,
                    &descriptor,
                    wgpu::wgt::TextureUses::RESOURCE,
                )
        })
    }

    pub fn new(log_path: Option<&str>) -> Result<Self, String> {
        // 初始化文件日志
        let path = log_path.unwrap_or("luna-rc.log");
        log_init(path);
        log!("Creating wgpu instance...");
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());

        log!("Requesting GPU adapter (LowPower, no surface)...");
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::LowPower,
            compatible_surface: None,
            force_fallback_adapter: false,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("No suitable GPU adapter: {}", e))?;

        let info = adapter.get_info();
        log!(
            "GPU adapter: name={} vendor={} device={} backend={:?}",
            info.name,
            info.vendor,
            info.device,
            info.backend
        );

        log!("Requesting GPU device...");
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("Luna Render Core"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            ..Default::default()
        }))
        .map_err(|e| format!("Failed to create device: {}", e))?;
        let max_texture_size = device.limits().max_texture_dimension_2d;
        log!(
            "GPU device created OK max_texture_dimension_2d={}",
            max_texture_size
        );

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compositor"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(SHADER)),
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("linear clamp"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        let bgl = layer_bind_group_layout(&device);

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("compositor layout"),
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });

        let pipeline = create_compositor_pipeline(
            &device,
            &pipeline_layout,
            &shader,
            wgpu::TextureFormat::Rgba8UnormSrgb,
            "compositor pipeline",
        );
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let pipeline_bgra = create_compositor_pipeline(
            &device,
            &pipeline_layout,
            &shader,
            wgpu::TextureFormat::Bgra8UnormSrgb,
            "compositor pipeline BGRA",
        );

        // ── identity LUT（2×2×2，采样输出 = 输入） ──
        let identity_lut = create_identity_lut(&device, &queue);
        log!("identity_lut created size=2x2x2 format=Rgba8Unorm");

        Ok(Self {
            device,
            queue,
            pipeline,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            pipeline_bgra,
            sampler,
            bind_group_layout: bgl,
            textures: HashMap::new(),
            next_texture_id: 1,
            max_texture_size,
            output_texture: None,
            texture_cache: HashMap::new(),
            cache_order: VecDeque::new(),
            static_image_probed: HashMap::new(),
            video_probed: HashMap::new(),
            video_decoders: HashMap::new(),
            video_decoding_ended: std::collections::HashSet::new(),
            no_video_decoder_restart: false,
            last_preview_log: None,
            staging_buffer: None,
            identity_lut,
            luts: HashMap::new(),
        })
    }

    // ── 纹理管理 ──

    pub fn load_texture(&mut self, data: &[u8], width: u32, height: u32) -> Result<u32, String> {
        if width == 0 || height == 0 {
            return Err("texture size must be greater than 0".to_string());
        }
        if width > self.max_texture_size || height > self.max_texture_size {
            let msg = format!(
                "texture size {}x{} exceeds GPU limit {}",
                width, height, self.max_texture_size
            );
            log_error!("{}", msg);
            return Err(msg);
        }
        let expected = width
            .checked_mul(height)
            .and_then(|v| v.checked_mul(4))
            .ok_or_else(|| format!("texture size overflow: {}x{}", width, height))?
            as usize;
        if data.len() < expected {
            log_error!("load_texture data too small: {} < {}", data.len(), expected);
            return Err(format!("data too small: {} < {}", data.len(), expected));
        }

        let id = self.next_texture_id;
        self.next_texture_id += 1;
        log!(
            "load_texture id={} size={}x{} data={}bytes",
            id,
            width,
            height,
            expected
        );

        // 单 level + bilinear，Lanczos 预缩到接近渲染尺寸
        // sRGB 格式：GPU 自动做 sRGB→linear 转换，使双线性插值和色彩混合在正确的色彩空间进行
        let texture = create_rgba_texture(
            &self.device,
            "layer",
            width,
            height,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            1,
            true,
        );
        upload_rgba(&self.queue, &texture, &data[..expected], width, height);

        self.textures.insert(
            id,
            TextureEntry {
                texture,
                width,
                height,
            },
        );
        Ok(id)
    }

    pub fn load_texture_from_path(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        path: &str,
        max_size: u32,
    ) -> Result<(u32, u32, u32), String> {
        let max_size = max_size.max(1).min(self.max_texture_size);

        // ── LRU 缓存命中 → 验证纹理仍存在，直接返回 ──
        if let Some(tex_id) = self.get_cached_texture(path) {
            if let Some(entry) = self.textures.get(&tex_id) {
                log!(
                    "load_texture_from_path [CACHE HIT] {} tex_id={} {}x{}",
                    path,
                    tex_id,
                    entry.width,
                    entry.height
                );
                return Ok((tex_id, entry.width, entry.height));
            } else {
                log!(
                    "load_texture_from_path [CACHE MISS:texture_gone] {} tex_id={}",
                    path,
                    tex_id
                );
            }
        } else {
            log!("load_texture_from_path [CACHE MISS] {}", path);
        }

        // ── ffprobe 获取原始尺寸 + EXIF 旋转 ──
        let probe_output = Command::new(ffprobe)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                "-show_frames",
                "-read_intervals",
                "%+#1",
                path,
            ])
            .output()
            .map_err(|e| format!("ffprobe {}: {}", path, e))?;
        let probe_stdout = String::from_utf8_lossy(&probe_output.stdout);
        let parsed: serde_json::Value =
            serde_json::from_str(&probe_stdout).map_err(|e| format!("ffprobe json: {}", e))?;
        log!("load_texture_from_path ffprobe stdout={}", probe_stdout);
        // 从 frames[0] 取宽高
        let frames = parsed["frames"]
            .as_array()
            .ok_or_else(|| format!("ffprobe: no frames in {}", path))?;
        let frame = frames
            .iter()
            .find(|f| f["media_type"].as_str() == Some("video"))
            .ok_or_else(|| format!("ffprobe: no video frame in {}", path))?;
        let source_w = frame["width"].as_u64().unwrap_or(0) as u32;
        let source_h = frame["height"].as_u64().unwrap_or(0) as u32;
        if source_w == 0 || source_h == 0 {
            return Err(format!("ffprobe: invalid image size in {}", path));
        }
        // ── 从 side_data_list.displaymatrix.rotation 提取旋转角度 ──
        let displaymatrix_rotation = frame["side_data_list"]
            .as_array()
            .and_then(|list| {
                list.iter()
                    .filter_map(|sd| sd["rotation"].as_f64())
                    .map(|r| r as i32)
                    .find(|&r| r == 90 || r == 270)
            })
            .unwrap_or(0);
        // ── 从 EXIF tags.Orientation 提取（值 6=90°CW, 8=270°CW/90°CCW）──
        let exif_orientation = frame["tags"]["Orientation"]
            .as_str()
            .and_then(|s| s.trim().parse::<i32>().ok())
            .unwrap_or(0);
        let exif_rotate = match exif_orientation {
            6 => 90,  // Rotate 90° CW
            8 => 270, // Rotate 270° CW (90° CCW)
            _ => 0,
        };
        let rotate_raw = frame["side_data_list"]
            .as_array()
            .map(|list| {
                let vals: Vec<String> = list
                    .iter()
                    .map(|sd| {
                        format!(
                            "{} r={}",
                            sd["side_data_type"].as_str().unwrap_or("?"),
                            sd["rotation"]
                        )
                    })
                    .collect();
                vals.join(" | ")
            })
            .unwrap_or_default();
        let rotate = if displaymatrix_rotation != 0 {
            displaymatrix_rotation
        } else {
            exif_rotate
        };
        log!(
            "load_texture_from_path side_data=[{}] orientation={} rotate={}",
            rotate_raw,
            exif_orientation,
            rotate
        );
        let (source_w, source_h) = if rotate == 90 || rotate == 270 {
            log!(
                "load_texture_from_path SWAP {}x{} -> {}x{}",
                source_w,
                source_h,
                source_h,
                source_w
            );
            (source_h, source_w)
        } else {
            (source_w, source_h)
        };

        // ── HDR / 宽色域 自动 normalize → SDR sRGB ──
        fn contains_any(s: &str, keys: &[&str]) -> bool {
            let lower = s.to_lowercase();
            keys.iter().any(|k| lower.contains(k))
        }
        // color_primaries/transfer 在 stream 级别更可靠，frame 级别可能为空
        let stream = parsed["streams"].as_array().and_then(|ss| {
            ss.iter()
                .find(|s| s["codec_type"].as_str() == Some("video"))
        });
        let primaries = stream
            .and_then(|s| s["color_primaries"].as_str())
            .or_else(|| frame["color_primaries"].as_str())
            .unwrap_or("");
        let transfer = stream
            .and_then(|s| s["color_transfer"].as_str())
            .or_else(|| frame["color_transfer"].as_str())
            .unwrap_or("");
        let bit_depth = frame["bits_per_raw_sample"].as_u64().unwrap_or(8) as u32;
        let is_pq = contains_any(
            transfer,
            &[
                "2084",
                "smpte2084",
                "smpte st 2084",
                "pq",
                "perceptual quantizer",
            ],
        );
        let is_hlg = contains_any(transfer, &["hlg", "arib", "b67", "arib-std-b67"]);
        let is_bt2020 = contains_any(primaries, &["2020", "bt2020", "bt.2020", "rec.2020"]);
        let is_display_p3 = contains_any(primaries, &["p3", "display-p3", "display p3", "dcip3"]);
        let is_hdr_transfer = is_pq || is_hlg;
        let is_wide_gamut = is_bt2020 || is_display_p3;
        let is_high_bit_depth = bit_depth > 8;
        log!("load_texture_from_path color_info: primaries={} transfer={} bit_depth={} is_hdr={} is_wide_gamut={} is_high_bit_depth={}",
            primaries, transfer, bit_depth, is_hdr_transfer || is_wide_gamut, is_wide_gamut, is_high_bit_depth);

        let use_path = if is_hdr_transfer || is_wide_gamut {
            let cache_dir = std::env::temp_dir().join("luna-rc/color-normalized");
            let _ = std::fs::create_dir_all(&cache_dir);
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            path.hash(&mut hasher);
            let hash = hasher.finish();
            let cache_path = cache_dir.join(format!("{:016x}_sdr_srgb.png", hash));
            let cache_str = cache_path.to_string_lossy().to_string();
            if !cache_path.exists() {
                log!(
                    "load_texture_from_path: normalizing {} → {}",
                    path,
                    cache_str
                );
                let zscale_avail = Command::new(ffmpeg)
                    .args(["-filters"])
                    .stderr(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::null())
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stderr).contains("zscale"))
                    .unwrap_or(false);
                let mut norm = Command::new(ffmpeg);
                norm.args(["-y", "-i", path]);
                if is_hdr_transfer && zscale_avail {
                    norm.args(["-vf", "zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709:p=bt709:m=bt709,format=rgb24"]);
                } else if zscale_avail {
                    norm.args(["-vf", "zscale=p=bt709:t=bt709:m=bt709,format=rgb24"]);
                } else {
                    norm.args([
                        "-vf",
                        "setparams=color_primaries=bt709:color_trc=bt709,format=rgb24",
                    ]);
                }
                norm.args([&cache_str])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::piped());
                let norm_out = norm.output().map_err(|e| format!("normalize: {}", e))?;
                if !norm_out.status.success() {
                    let stderr = String::from_utf8_lossy(&norm_out.stderr);
                    log!(
                        "load_texture_from_path: normalize FAILED, using original: {}",
                        stderr
                    );
                    path.to_string()
                } else {
                    log!("load_texture_from_path: normalize OK → {}", cache_str);
                    cache_str
                }
            } else {
                log!("load_texture_from_path: normalize cache HIT: {}", cache_str);
                cache_str
            }
        } else {
            path.to_string()
        };

        // ── 计算缩放后尺寸 ──
        let (width, height) = {
            let max_edge = source_w.max(source_h);
            if max_edge > max_size {
                let scale = max_size as f64 / max_edge as f64;
                (
                    (source_w as f64 * scale).round().max(1.0) as u32,
                    (source_h as f64 * scale).round().max(1.0) as u32,
                )
            } else {
                (source_w, source_h)
            }
        };

        // ── ffmpeg 解码 + resize → rawvideo ──
        let mut proc = Command::new(ffmpeg)
            .args([
                "-i",
                &use_path,
                "-vf",
                &format!("scale={}:{}:flags=lanczos", width, height),
                "-pix_fmt",
                "rgba",
                "-f",
                "rawvideo",
                "-vframes",
                "1",
                "-loglevel",
                "error",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ffmpeg spawn {}: {}", path, e))?;

        let mut rgba = vec![];
        proc.stdout
            .take()
            .ok_or_else(|| "ffmpeg: no stdout".to_string())?
            .read_to_end(&mut rgba)
            .map_err(|e| format!("ffmpeg read {}: {}", use_path, e))?;
        let status = proc
            .wait()
            .map_err(|e| format!("ffmpeg wait {}: {}", path, e))?;
        if !status.success() {
            return Err(format!("ffmpeg exit {} for {}", status, use_path));
        }

        log!(
            "load_texture_from_path ffmpeg path={} source={}x{} texture={}x{} rgba={}bytes",
            path,
            source_w,
            source_h,
            width,
            height,
            rgba.len(),
        );
        let id = self.load_texture(&rgba, width, height)?;
        self.cache_static_texture(path.to_string(), id)?;
        log!(
            "load_texture_from_path RETURN id={} {}x{}",
            id,
            width,
            height
        );
        Ok((id, width, height))
    }

    pub fn update_texture(&mut self, texture_id: u32, data: &[u8]) -> Result<(), String> {
        let entry = self
            .textures
            .get(&texture_id)
            .ok_or_else(|| format!("texture {} not found", texture_id))?;
        let expected = (entry.width * entry.height * 4) as usize;
        if data.len() < expected {
            log_error!(
                "update_texture data too small: {} < {}",
                data.len(),
                expected
            );
            return Err(format!("data too small: {} < {}", data.len(), expected));
        }
        upload_rgba(
            &self.queue,
            &entry.texture,
            &data[..expected],
            entry.width,
            entry.height,
        );
        Ok(())
    }

    pub fn release_texture(&mut self, texture_id: u32) -> Result<(), String> {
        self.textures
            .remove(&texture_id)
            .ok_or_else(|| format!("texture {} not found", texture_id))?;
        // 同步清理缓存中的条目
        if let Some(path) = self
            .texture_cache
            .iter()
            .find(|(_, &tid)| tid == texture_id)
            .map(|(p, _)| p.clone())
        {
            self.texture_cache.remove(&path);
            self.cache_order.retain(|k| k != &path);
        }
        log!("release_texture id={}", texture_id);
        Ok(())
    }

    // ── LUT 管理 ──

    /// 从文件路径加载 .cube LUT，缓存并返回 LutEntry
    fn ensure_lut_loaded(&mut self, path: &str) -> Result<&LutEntry, String> {
        use std::collections::hash_map::Entry;
        match self.luts.entry(path.to_string()) {
            Entry::Occupied(entry) => Ok(entry.into_mut()),
            Entry::Vacant(entry) => {
                let mut file = std::fs::File::open(path)
                    .map_err(|e| format!("打开 LUT 文件失败 {}: {}", path, e))?;
                let mut data = Vec::new();
                file.read_to_end(&mut data)
                    .map_err(|e| format!("读取 LUT 文件失败 {}: {}", path, e))?;
                let (size, values) = parse_cube_lut(&data)?;
                if size < 2 || size > self.device.limits().max_texture_dimension_3d {
                    return Err(format!(
                        "LUT size {} out of range [2, {}]",
                        size,
                        self.device.limits().max_texture_dimension_3d
                    ));
                }
                let texture = create_lut_3d_texture(&self.device, &self.queue, size, &values);
                log!(
                    "load_lut_file path={} size={}x{}x{}",
                    path,
                    size,
                    size,
                    size
                );
                Ok(entry.insert(LutEntry { texture, size }))
            }
        }
    }

    // ── 渲染 ──

    fn render_impl(
        &mut self,
        mut canvas_width: u32,
        mut canvas_height: u32,
        layers: &[RenderLayer],
        readback: bool,
    ) -> Result<Vec<u8>, String> {
        // 限制画布尺寸不超过 GPU 上限，保持宽高比
        let max_dim = canvas_width.max(canvas_height);
        if max_dim > self.max_texture_size {
            log!(
                "render: canvas {}x{} exceeds GPU limit {}, clamping",
                canvas_width,
                canvas_height,
                self.max_texture_size
            );
            let scale = self.max_texture_size as f64 / max_dim as f64;
            canvas_width = (canvas_width as f64 * scale).round() as u32;
            canvas_height = (canvas_height as f64 * scale).round() as u32;
        }
        let pixel_count = (canvas_width * canvas_height * 4) as usize;

        // sort by z_index
        let mut sorted: Vec<&RenderLayer> = layers.iter().collect();
        sorted.sort_by_key(|l| l.z_index);

        // 预加载所有层需要的 LUT（在借用 self.output_texture 之前）
        for layer in &sorted {
            if let Some(path) = &layer.lut_id {
                if let Err(e) = self.ensure_lut_loaded(path) {
                    log!("LUT 加载失败 {}: {}", path, e);
                }
            }
        }

        // ensure output texture
        let recreate = match &self.output_texture {
            Some((_, w, h)) => *w != canvas_width || *h != canvas_height,
            None => true,
        };
        if recreate {
            self.output_texture = Some((
                create_rgba_texture(
                    &self.device,
                    "output",
                    canvas_width,
                    canvas_height,
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                    1,
                    true,
                ),
                canvas_width,
                canvas_height,
            ));
        }
        let (output_tex, _, _) = self.output_texture.as_ref().unwrap();
        let output_view = output_tex.create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("encoder"),
            });

        {
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("compositor pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &output_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });

            #[cfg(any(target_os = "macos", target_os = "windows"))]
            let render_pipeline = if output_tex.format() == wgpu::TextureFormat::Bgra8UnormSrgb {
                &self.pipeline_bgra
            } else {
                &self.pipeline
            };
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let render_pipeline = &self.pipeline;
            rpass.set_pipeline(render_pipeline);

            for layer in &sorted {
                let tex_entry = self.textures.get(&layer.texture_id).ok_or_else(|| {
                    log_error!("render: texture {} not found", layer.texture_id);
                    format!("texture {} not found", layer.texture_id)
                })?;
                let texture_info = PreviewTextureInfo {
                    texture_id: layer.texture_id,
                    width: tex_entry.width,
                    height: tex_entry.height,
                };
                let planned_transform = plan_cover_transform(
                    layer.fit.as_deref().unwrap_or("stretch"),
                    layer.positioning.is_some(),
                    layer.dst_w,
                    layer.dst_h,
                    &layer.transform.clone().unwrap_or_default(),
                    &texture_info,
                    canvas_width,
                    canvas_height,
                );
                let fit_mode = layer.fit.as_deref().unwrap_or("stretch");
                let target_aspect = ((layer.dst_w * canvas_width as f64).abs().max(1.0)
                    / (layer.dst_h * canvas_height as f64).abs().max(1.0))
                .max(0.001);
                let mut planned_transform = planned_transform;
                let cover_scale_frame = (fit_mode == "cover-scale").then(|| {
                    plan_cover_scale(&texture_info, target_aspect, &mut planned_transform)
                });
                let mut effective_layer = (**layer).clone();
                effective_layer.transform = Some(planned_transform);
                let layer = &effective_layer;
                let source_aspect =
                    (tex_entry.width as f32 / tex_entry.height.max(1) as f32).max(0.0001);
                let orientation = layer
                    .transform
                    .as_ref()
                    .map(|t| t.orientation as f32)
                    .unwrap_or(0.0);
                let normalized_orientation = ((orientation % 180.0) + 180.0) % 180.0;
                let swap_orientation =
                    normalized_orientation >= 45.0 && normalized_orientation <= 135.0;
                let (frame_w, frame_h) = if let Some((frame_w, frame_h)) = cover_scale_frame {
                    (frame_w as f32, frame_h as f32)
                } else if swap_orientation {
                    (1.0, source_aspect)
                } else {
                    (source_aspect, 1.0)
                };
                let color = layer.color.clone().unwrap_or_default();
                let mut curve_data = [[0.0; 4]; 30];
                let curve_rgb_count = pack_curve_points(&mut curve_data, 0, &color.curve.rgb);
                let curve_luminance_count =
                    pack_curve_points(&mut curve_data, 6, &color.curve.luminance);
                let curve_red_count = pack_curve_points(&mut curve_data, 12, &color.curve.red);
                let curve_green_count = pack_curve_points(&mut curve_data, 18, &color.curve.green);
                let curve_blue_count = pack_curve_points(&mut curve_data, 24, &color.curve.blue);
                let hsl_data = pack_hsl_channels(&color.hsl_channels);

                // ── 相对定位覆盖 dst ──
                let (pos_dst_x, pos_dst_y, pos_dst_w, pos_dst_h) = resolve_positioning(
                    &layer.positioning,
                    layer.dst_x,
                    layer.dst_y,
                    layer.dst_w,
                    layer.dst_h,
                    canvas_width as f64,
                    canvas_height as f64,
                    tex_entry.width as f64,
                    tex_entry.height as f64,
                );

                // ── 确定当前层的 LUT（已在 render loop 前预加载） ──
                let (lut_texture, lut_size) = match &layer.lut_id {
                    Some(path) => self.luts.get(path.as_str()).map_or_else(
                        || (&self.identity_lut, 0.0),
                        |entry| (&entry.texture, entry.size as f32),
                    ),
                    None => (&self.identity_lut, 0.0),
                };

                let params = GpuLayerParams {
                    // dst_* 转像素坐标（用于像素级命中检测）
                    dst_x: (pos_dst_x * canvas_width as f64) as f32,
                    dst_y: (pos_dst_y * canvas_height as f64) as f32,
                    dst_w: (pos_dst_w * canvas_width as f64) as f32,
                    dst_h: (pos_dst_h * canvas_height as f64) as f32,
                    // src_* 保持归一化 0-1（WGSL textureSample 需要归一化坐标）
                    src_x: layer.src_x as f32,
                    src_y: layer.src_y as f32,
                    src_w: layer.src_w as f32,
                    src_h: layer.src_h as f32,
                    crop_x: layer
                        .transform
                        .as_ref()
                        .and_then(|t| t.crop.as_ref())
                        .map(|c| c.x as f32)
                        .unwrap_or(0.0),
                    crop_y: layer
                        .transform
                        .as_ref()
                        .and_then(|t| t.crop.as_ref())
                        .map(|c| c.y as f32)
                        .unwrap_or(0.0),
                    crop_w: layer
                        .transform
                        .as_ref()
                        .and_then(|t| t.crop.as_ref())
                        .map(|c| c.w as f32)
                        .unwrap_or(1.0),
                    crop_h: layer
                        .transform
                        .as_ref()
                        .and_then(|t| t.crop.as_ref())
                        .map(|c| c.h as f32)
                        .unwrap_or(1.0),
                    source_aspect,
                    frame_w,
                    frame_h,
                    opacity: layer.opacity as f32,
                    exposure: color.exposure as f32,
                    black: color.black as f32,
                    brightness: color.brightness as f32,
                    contrast: color.contrast as f32,
                    saturation: color.saturation as f32,
                    vibrance: color.vibrance as f32,
                    temperature: color.temperature as f32,
                    tint: color.tint as f32,
                    highlights: color.highlights as f32,
                    shadows: color.shadows as f32,
                    whites: color.whites as f32,
                    blacks: color.blacks as f32,
                    clarity: color.clarity as f32,
                    texture: color.texture as f32,
                    sharpen: color.sharpen as f32,
                    denoise: color.denoise as f32,
                    grade_shadows_hue: color.grade_shadows_hue as f32,
                    grade_shadows_amount: color.grade_shadows_amount as f32,
                    grade_mid_hue: color.grade_mid_hue as f32,
                    grade_mid_amount: color.grade_mid_amount as f32,
                    grade_highlights_hue: color.grade_highlights_hue as f32,
                    grade_highlights_amount: color.grade_highlights_amount as f32,
                    curve_lift: color.curve_lift as f32,
                    curve_contrast: color.curve_contrast as f32,
                    levels_black: color.levels_black as f32,
                    levels_gray: color.levels_gray as f32,
                    levels_white: color.levels_white as f32,
                    curve_rgb_count,
                    curve_luminance_count,
                    curve_red_count,
                    curve_green_count,
                    curve_blue_count,
                    texel_x: 1.0 / (tex_entry.width.max(1) as f32),
                    texel_y: 1.0 / (tex_entry.height.max(1) as f32),
                    orientation,
                    rotate: layer
                        .transform
                        .as_ref()
                        .map(|t| t.rotate as f32)
                        .unwrap_or(0.0),
                    flip_h: layer
                        .transform
                        .as_ref()
                        .map(|t| if t.flip_h { 1.0 } else { 0.0 })
                        .unwrap_or(0.0),
                    flip_v: layer
                        .transform
                        .as_ref()
                        .map(|t| if t.flip_v { 1.0 } else { 0.0 })
                        .unwrap_or(0.0),
                    scale: layer
                        .transform
                        .as_ref()
                        .map(|t| t.scale.max(0.0001) as f32)
                        .unwrap_or(1.0),
                    translate_x: layer
                        .transform
                        .as_ref()
                        .and_then(|t| t.translate_x)
                        .unwrap_or(0.0) as f32,
                    translate_y: layer
                        .transform
                        .as_ref()
                        .and_then(|t| t.translate_y)
                        .unwrap_or(0.0) as f32,
                    lut_size,
                    lut_intensity: layer.lut_intensity.unwrap_or(100.0) as f32,
                    _pad: [0.0; 1],
                    curve_data,
                    hsl_data,
                };

                let params_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("params"),
                    size: std::mem::size_of::<GpuLayerParams>() as u64,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                self.queue
                    .write_buffer(&params_buf, 0, bytemuck::bytes_of(&params));

                let tex_view = tex_entry
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());

                let lut_view = lut_texture.create_view(&wgpu::TextureViewDescriptor::default());

                let bg_entries = [
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&tex_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: params_buf.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::TextureView(&lut_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                ];

                let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("layer bg"),
                    layout: &self.bind_group_layout,
                    entries: &bg_entries,
                });

                rpass.set_bind_group(0, &bind_group, &[]);
                rpass.draw(0..4, 0..1);
            }
        }

        if !readback {
            self.queue.submit(Some(encoder.finish()));
            self.device
                .poll(wgpu::PollType::Wait {
                    submission_index: None,
                    timeout: None,
                })
                .map_err(|e| format!("GPU render wait: {}", e))?;
            return Ok(Vec::new());
        }

        // copy output → staging buffer
        let row_bytes = canvas_width * 4;
        let row_padded = align_to(row_bytes, 256);
        let buf_size = (row_padded * canvas_height) as u64;

        // 复用 staging buffer，避免每帧创建/销毁 33MB GPU 内存
        let reuse_staging = self.staging_buffer.as_ref().map(|(_, s)| *s) == Some(buf_size);
        if !reuse_staging {
            let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("staging"),
                size: buf_size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            self.staging_buffer = Some((buf, buf_size));
        }

        encoder.copy_texture_to_buffer(
            TexelCopyTextureInfo {
                texture: output_tex,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            TexelCopyBufferInfo {
                buffer: &self.staging_buffer.as_ref().unwrap().0,
                layout: TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row_padded),
                    rows_per_image: Some(canvas_height),
                },
            },
            wgpu::Extent3d {
                width: canvas_width,
                height: canvas_height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));

        // read back
        let staging_buf = &self.staging_buffer.as_ref().unwrap().0;
        let slice = staging_buf.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        let _ = self.device.poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: None,
        });

        rx.recv()
            .map_err(|_| "channel closed".to_string())?
            .map_err(|e| format!("map_async: {}", e))?;

        let mapped = slice
            .get_mapped_range()
            .map_err(|e| format!("get_mapped_range: {}", e))?;

        let mut result = vec![0u8; pixel_count];
        if row_padded == row_bytes {
            result.copy_from_slice(&mapped[..pixel_count]);
        } else {
            for row in 0..canvas_height as usize {
                let src_start = row * row_padded as usize;
                let dst_start = row * row_bytes as usize;
                result[dst_start..dst_start + row_bytes as usize]
                    .copy_from_slice(&mapped[src_start..src_start + row_bytes as usize]);
            }
        }
        drop(mapped);
        staging_buf.unmap();

        Ok(result)
    }

    /// 渲染并回读 RGBA。预览和跨平台 FFmpeg 回退路径继续使用此入口。
    pub fn render(
        &mut self,
        canvas_width: u32,
        canvas_height: u32,
        layers: &[RenderLayer],
    ) -> Result<Vec<u8>, String> {
        self.render_impl(canvas_width, canvas_height, layers, true)
    }

    /// 直接渲染到外部 wgpu 纹理，不经过 staging buffer，也不回读 CPU。
    ///
    /// macOS 导出会把 CoreVideo PixelBuffer 对应的 Metal Texture 包装为
    /// wgpu::Texture 后传入这里。GPU 完成后，调用方可把原 PixelBuffer
    /// 直接提交给 VideoToolbox 编码。
    /// 渲染到外部 wgpu 纹理（macOS Metal / Windows D3D12 共享纹理），
    /// 不经过 staging buffer，也不回读 CPU。
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn render_into_external_texture(
        &mut self,
        target: wgpu::Texture,
        canvas_width: u32,
        canvas_height: u32,
        layers: &[RenderLayer],
    ) -> Result<(), String> {
        let previous = self
            .output_texture
            .replace((target, canvas_width, canvas_height));
        let result = self
            .render_impl(canvas_width, canvas_height, layers, false)
            .map(|_| ());
        self.output_texture.take();
        self.output_texture = previous;
        result
    }

    /// 注册一个外部输入纹理（macOS Metal / Windows D3D12）。
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn register_external_texture(
        &mut self,
        texture: wgpu::Texture,
        width: u32,
        height: u32,
    ) -> u32 {
        let texture_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(
            texture_id,
            TextureEntry {
                texture,
                width,
                height,
            },
        );
        texture_id
    }

    /// 移除逐帧外部纹理。
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn unregister_external_texture(&mut self, texture_id: u32) {
        self.textures.remove(&texture_id);
    }

    /// 等待 GPU 完成所有已提交的工作（用于跨 API 同步，如 D3D12→D3D11 共享纹理）。
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn wait_for_gpu(&self) -> Result<(), String> {
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: None,
            })
            .map_err(|e| format!("GPU wait failed: {e}"))?;
        Ok(())
    }

    // ───────────── render_preview 统一入口 ─────────────

    /// 从 LRU 缓存中取静态纹理，命中后移到 MRU 位置
    fn get_cached_texture(&mut self, path: &str) -> Option<u32> {
        let tex_id = self.texture_cache.get(path).copied()?;
        // 移到 cache_order 末尾（最近使用）
        if let Some(pos) = self.cache_order.iter().position(|k| k == path) {
            let key = self.cache_order.remove(pos).unwrap();
            self.cache_order.push_back(key);
        }
        Some(tex_id)
    }

    /// 仅复用分辨率足够的静态纹理；缩略图缓存不能用于更大的工作台预览。
    fn get_cached_texture_at_least(&mut self, path: &str, required_max_edge: u32) -> Option<u32> {
        let tex_id = self.get_cached_texture(path)?;
        let cached_size = self
            .textures
            .get(&tex_id)
            .map(|entry| (entry.width, entry.height));
        if cached_size
            .map(|(width, height)| cached_texture_is_sufficient(width, height, required_max_edge))
            .unwrap_or(false)
        {
            return Some(tex_id);
        }

        if let Some((width, height)) = cached_size {
            log!(
                "static texture cache upgrade path={} cached={}x{} required_max_edge={}",
                path,
                width,
                height,
                required_max_edge,
            );
        } else {
            log!("static texture cache stale path={} tex_id={}", path, tex_id,);
        }

        // release_texture 会同步清理 texture_cache 和 cache_order。
        if self.textures.contains_key(&tex_id) {
            let _ = self.release_texture(tex_id);
        } else {
            self.texture_cache.remove(path);
            self.cache_order.retain(|key| key != path);
        }
        None
    }

    /// 将静态纹理加入 LRU 缓存，超出上限时淘汰最旧的
    fn cache_static_texture(&mut self, path: String, tex_id: u32) -> Result<(), String> {
        self.texture_cache.insert(path.clone(), tex_id);
        self.cache_order.push_back(path);
        while self.cache_order.len() > MAX_TEXTURE_CACHE {
            let oldest = self.cache_order.pop_front().unwrap();
            self.static_image_probed.remove(&oldest);
            if let Some(tid) = self.texture_cache.remove(&oldest) {
                self.release_texture(tid)?;
            }
        }
        Ok(())
    }

    fn probe_static_image(&mut self, ffprobe: &str, path: &str) -> Result<(u32, u32), String> {
        if let Some(&dims) = self.static_image_probed.get(path) {
            return Ok(dims);
        }
        let dims = probe_static_image_dimensions(ffprobe, path)?;
        self.static_image_probed.insert(path.to_string(), dims);
        Ok(dims)
    }

    /// 探测视频文件尺寸（结果缓存，避免重复 ffprobe）
    fn probe_video(&mut self, ffprobe: &str, path: &str) -> Result<(u32, u32), String> {
        if let Some(&dims) = self.video_probed.get(path) {
            return Ok(dims);
        }
        let dims = probe_video_dimensions(ffprobe, path)?;
        self.video_probed.insert(path.to_string(), dims);
        Ok(dims)
    }

    fn remove_video_decoder(&mut self, path: &str) {
        if let Some(decoder) = self.video_decoders.remove(path) {
            if let Some(texture_id) = decoder.texture_id {
                let _ = self.release_texture(texture_id);
            }
        }
    }

    pub fn clear_video_decoders(&mut self) {
        let paths: Vec<String> = self.video_decoders.keys().cloned().collect();
        for path in paths {
            self.remove_video_decoder(&path);
        }
        self.video_decoding_ended.clear();
    }

    /// 获取视频帧：保持 ffmpeg pipe 存活，逐帧顺序读取。
    /// 初次 spawn + `-ss {time}` 定位起始位置，之后每次只读 pipe 的下一帧。
    /// 重新 spawn 只在预览模式（no_video_decoder_restart=false）下因 seek 或 pipe 异常时发生。
    /// 导出模式（no_video_decoder_restart=true）：EOF / 解码失败 → 标记结束，返回 Ok(None)，永不重启。
    ///
    /// 返回 Ok(Some(rgba, w, h)) = 正常帧,
    ///       Ok(None)            = 该视频层已结束（EOF / 解码失败 / seek 越界）,
    ///       Err(msg)            = 致命错误（ffmpeg 未找到等）。
    fn read_video_frame(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        file_path: &str,
        video_time: f64,
        fps: Option<f64>,
    ) -> Result<Option<(Vec<u8>, u32, u32)>, String> {
        // ── 已标记结束的视频 → 直接跳过 ──
        if self.video_decoding_ended.contains(file_path) {
            return Ok(None);
        }

        // ── 已有 decoder → 从 pipe 顺序读下一帧 ──
        if let Some(dec) = self.video_decoders.get_mut(file_path) {
            // 该 decoder 已标记结束
            if dec.decoding_finished {
                return Ok(None);
            }

            // 检测 seek 跳转：只在 non-export 模式下重启
            if video_time + 0.1 < dec.current_time || (video_time - dec.current_time).abs() > 2.0 {
                if self.no_video_decoder_restart {
                    log!(
                        "read_video_frame [{}] seek jump {:.3} -> {:.3}, finishing decoder",
                        file_path,
                        dec.current_time,
                        video_time,
                    );
                    dec.decoding_finished = true;
                    self.video_decoding_ended.insert(file_path.to_string());
                    return Ok(None);
                } else {
                    log!(
                        "read_video_frame [{}] seek jump {:.3} -> {:.3}, restarting",
                        file_path,
                        dec.current_time,
                        video_time,
                    );
                    self.remove_video_decoder(file_path);
                    return self.read_video_frame(ffmpeg, ffprobe, file_path, video_time, fps);
                }
            }

            // 正常读取下一帧
            let mut rgba = vec![0u8; dec.frame_bytes];
            if dec.stdout.read_exact(&mut rgba).is_err() {
                if self.no_video_decoder_restart {
                    log!(
                        "read_video_frame [{}] pipe EOF, finishing decoder",
                        file_path
                    );
                    dec.decoding_finished = true;
                    self.video_decoding_ended.insert(file_path.to_string());
                    return Ok(None);
                } else {
                    log!("read_video_frame [{}] pipe EOF, restarting", file_path);
                    self.remove_video_decoder(file_path);
                    return self.read_video_frame(ffmpeg, ffprobe, file_path, video_time, fps);
                }
            }
            dec.current_time = video_time;
            return Ok(Some((rgba, dec.scaled_w, dec.scaled_h)));
        }

        // ── 首次或换文件：spawn 持久 pipe ──
        let (vw, vh) = self.probe_video(ffprobe, file_path)?;
        let max_edge = vw.max(vh);
        let (dw, dh) = if max_edge > PREVIEW_MAX_SIZE {
            let s = PREVIEW_MAX_SIZE as f64 / max_edge as f64;
            (
                (vw as f64 * s).round().max(1.0) as u32,
                (vh as f64 * s).round().max(1.0) as u32,
            )
        } else {
            (vw, vh)
        };
        let frame_bytes = (dw * dh * 4) as usize;

        // 组装 ffmpeg 参数
        let mut args = vec![
            "-ss".to_string(),
            format!("{:.3}", video_time),
            "-i".to_string(),
            normalize_local_path(file_path),
            "-vf".to_string(),
            format!("scale={}:{}:flags=lanczos", dw, dh),
        ];
        // 导出模式下指定 -r 确保解码 fps 与导出 fps 一致
        if let Some(export_fps) = fps {
            args.extend(["-r".to_string(), export_fps.to_string()]);
        }
        args.extend([
            "-pix_fmt".to_string(),
            "rgba".to_string(),
            "-f".to_string(),
            "rawvideo".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "pipe:1".to_string(),
        ]);

        let mut proc = Command::new(ffmpeg)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ffmpeg spawn {}: {}", file_path, e))?;

        let stdout = proc.stdout.take().ok_or_else(|| "no stdout".to_string())?;
        let stderr_buf = proc.stderr.take();

        // 读第1帧
        let mut rgba = vec![0u8; frame_bytes];
        let mut child_stdout = stdout;
        if let Err(e) = child_stdout.read_exact(&mut rgba) {
            let stderr_msg = stderr_buf
                .and_then(|mut s| {
                    let mut buf = String::new();
                    s.read_to_string(&mut buf).ok().map(|_| buf)
                })
                .unwrap_or_default();
            log!(
                "read_first_frame FAIL [{}] time={:.3} expected={}x{} frame_bytes={} stderr=[{}]",
                file_path,
                video_time,
                dw,
                dh,
                frame_bytes,
                stderr_msg
            );
            if self.no_video_decoder_restart {
                // 导出模式：首次解码失败 → 标记结束，不中断导出
                self.video_decoding_ended.insert(file_path.to_string());
                return Ok(None);
            } else {
                return Err(format!(
                    "read first frame {}: {}  stderr={}",
                    file_path, e, stderr_msg
                ));
            }
        }

        self.video_decoders.insert(
            file_path.to_string(),
            VideoDecoder {
                process: proc,
                stdout: child_stdout,
                scaled_w: dw,
                scaled_h: dh,
                frame_bytes,
                current_time: video_time,
                texture_id: None,
                decoding_finished: false,
            },
        );

        log!(
            "read_video_frame [{}] started at {:.3}s {}x{}",
            file_path,
            video_time,
            dw,
            dh,
        );
        Ok(Some((rgba, dw, dh)))
    }

    /// 获取或更新视频层纹理。返回：
    ///   Ok(Some(texture_id)) = 正常帧
    ///   Ok(None)             = 视频层已结束（跳过该层）
    ///   Err(msg)             = 致命错误
    fn video_texture_for_layer(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        layer: &PreviewLayerInput,
        _decode_max_side: u32,
        fps: Option<f64>,
    ) -> Result<Option<u32>, String> {
        // ── 有 pipe 解码器：直接读下一帧（顺序读取最可靠） ──
        if let Some((texture_id, current_time)) = self
            .video_decoders
            .get(&layer.file_path)
            .and_then(|decoder| {
                decoder
                    .texture_id
                    .map(|texture_id| (texture_id, decoder.current_time))
            })
        {
            if (layer.video_time - current_time).abs() < 0.001 {
                log!(
                    "read_video_frame [{}] reuse paused frame at {:.3}s tex={}",
                    layer.file_path,
                    current_time,
                    texture_id,
                );
                return Ok(Some(texture_id));
            }
            match self.read_video_frame(ffmpeg, ffprobe, &layer.file_path, layer.video_time, fps)? {
                Some((rgba, dw, dh)) => {
                    // seek 跳转时 read_video_frame 内部可能已释放旧纹理（remove_video_decoder → release_texture）
                    if self.textures.contains_key(&texture_id) {
                        self.update_texture(texture_id, &rgba)?;
                        return Ok(Some(texture_id));
                    } else {
                        let new_texture_id = self.load_texture(&rgba, dw, dh)?;
                        if let Some(decoder) = self.video_decoders.get_mut(&layer.file_path) {
                            decoder.texture_id = Some(new_texture_id);
                        }
                        return Ok(Some(new_texture_id));
                    }
                }
                None => return Ok(None), // 视频层已结束
            }
        }

        // ── 无 pipe 解码器：优先创建 pipe + 读第1帧 ──
        match self.read_video_frame(ffmpeg, ffprobe, &layer.file_path, layer.video_time, fps)? {
            Some((rgba, dw, dh)) => {
                let texture_id = self.load_texture(&rgba, dw, dh)?;
                if let Some(decoder) = self.video_decoders.get_mut(&layer.file_path) {
                    decoder.texture_id = Some(texture_id);
                }
                log!(
                    "read_video_frame [{}] pipe started at {:.3}s tex={} {}x{}",
                    layer.file_path,
                    layer.video_time,
                    texture_id,
                    dw,
                    dh,
                );
                return Ok(Some(texture_id));
            }
            None => {
                log!(
                    "read_video_frame [{}] pipe failed at {:.3}s — layer discarded",
                    layer.file_path,
                    layer.video_time,
                );
                return Ok(None);
            }
        }
    }

    /// 统一渲染预览帧：静态图走 LRU 缓存，视频帧保持 ffmpeg pipe 持续读
    ///
    /// 导出模式下（fps=Some）：EOF/解码失败标记该层结束永不重启，`-r {fps}` 确保解码帧率匹配。
    /// 预览模式下（fps=None）：保持向后兼容，seek/EOF 时重启 pipe。
    pub fn render_preview(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        width: Option<u32>,
        height: Option<u32>,
        max_side: Option<u32>,
        layers: &[PreviewLayerInput],
        fps: Option<f64>,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        // ── 清理已不再使用的视频 decoder ──
        let active_video_paths: std::collections::HashSet<&str> = layers
            .iter()
            .filter(|l| l.is_video)
            .map(|l| l.file_path.as_str())
            .collect();
        let inactive_video_paths: Vec<String> = self
            .video_decoders
            .keys()
            .filter(|path| !active_video_paths.contains(path.as_str()))
            .cloned()
            .collect();
        for path in inactive_video_paths {
            self.remove_video_decoder(&path);
        }

        let mut source_layers = Vec::with_capacity(layers.len());
        // 解码最大边长：export 时传入了有效 max_side（如 8192），
        // preview 时 max_side 为 None 或较小的值（如 2560），fallback 到 PREVIEW_MAX_SIZE
        let decode_max_side = max_side.unwrap_or(PREVIEW_MAX_SIZE).max(1);

        for layer in layers {
            let tex_id = if layer.is_video {
                match self.video_texture_for_layer(ffmpeg, ffprobe, layer, decode_max_side, fps)? {
                    Some(id) => id,
                    None => continue, // 视频层已结束，跳过该层
                }
            } else {
                // ── 静态图：LRU 缓存 ──
                // 缓存以路径为单位保留当前最高分辨率版本。缩略图、工作台和导出
                // 共用 Compositor，因此命中时必须校验纹理尺寸，避免放大低清纹理。
                let (source_width, source_height) =
                    self.probe_static_image(ffprobe, &layer.file_path)?;
                let layer_decode_max = calc_optimal_decode_max_edge(
                    &layer.positioning,
                    width,
                    height,
                    source_width,
                    source_height,
                    decode_max_side,
                );
                let required_max_edge = source_width.max(source_height).min(layer_decode_max);
                let cached = self.get_cached_texture_at_least(&layer.file_path, required_max_edge);
                if let Some(tid) = cached {
                    tid
                } else {
                    // 对带 positioning 的层，先探测源图尺寸，计算最优解码尺寸
                    // 用 ffmpeg Lanczos 预降采样到接近显示尺寸，减少 GPU 双线性降采样导致的锯齿
                    let (rgba, w, h) = decode_static_image_scaled(
                        ffmpeg,
                        ffprobe,
                        &layer.file_path,
                        layer_decode_max,
                    )?;
                    let tid = self.load_texture(&rgba, w, h)?;
                    self.cache_static_texture(layer.file_path.clone(), tid)?;
                    tid
                }
            };

            let entry = self
                .textures
                .get(&tex_id)
                .ok_or_else(|| format!("texture {} not found", tex_id))?;
            source_layers.push((
                (*layer).clone(),
                PreviewTextureInfo {
                    texture_id: tex_id,
                    width: entry.width,
                    height: entry.height,
                },
            ));
        }

        // 所有视频层都已结束 → 输出空白帧
        if source_layers.is_empty() {
            let (cw, ch) = match (width, height) {
                (Some(w), Some(h)) => (w.max(1), h.max(1)),
                _ => return Err("no valid layers for preview".to_string()),
            };
            let (ow, oh) = fit_output_size(cw, ch, max_side.unwrap_or(PREVIEW_MAX_SIZE));
            log!(
                "render_preview all layers ended, output blank {}x{}",
                ow,
                oh,
            );
            return Ok((vec![0u8; (ow * oh * 4) as usize], ow, oh));
        }

        let planned = self.plan_preview(width, height, max_side, &source_layers)?;
        let (src_w, src_h) = source_layers
            .first()
            .map(|(_, ti)| (ti.width, ti.height))
            .unwrap_or((0, 0));
        let now = std::time::Instant::now();
        let should_log = match self.last_preview_log {
            Some((last_src_w, last_src_h, last_out_w, last_out_h, last_at)) => {
                last_src_w != src_w
                    || last_src_h != src_h
                    || last_out_w != planned.width
                    || last_out_h != planned.height
                    || now.duration_since(last_at).as_millis() >= 1000
            }
            None => true,
        };
        if should_log {
            self.last_preview_log = Some((src_w, src_h, planned.width, planned.height, now));
            log!(
                "render_preview output source={}x{} requested={:?}x{:?} max_side={:?} -> {}x{} layers={}",
                src_w, src_h, width, height, max_side, planned.width, planned.height, source_layers.len()
            );
        }
        let result = self.render(planned.width, planned.height, &planned.layers)?;

        Ok((result, planned.width, planned.height))
    }

    pub fn plan_preview(
        &mut self,
        width: Option<u32>,
        height: Option<u32>,
        max_side: Option<u32>,
        layers: &[(PreviewLayerInput, PreviewTextureInfo)],
    ) -> Result<PlannedPreview, String> {
        let (first_layer, first_texture) = layers
            .first()
            .ok_or_else(|| "no valid layers for preview plan".to_string())?;

        // 有 transform.crop 时，按裁剪框像素尺寸作为基础输出尺寸
        let (base_w, base_h) = match &first_layer.transform.crop {
            Some(_) => {
                let (cw, ch) = layer_visible_pixel_size(first_texture, &first_layer.transform);
                (cw, ch)
            }
            None => {
                let (frame_w, frame_h) =
                    layer_visible_pixel_size(first_texture, &first_layer.transform);
                (frame_w, frame_h)
            }
        };

        let (output_width, output_height) = fit_output_size(
            width.unwrap_or(base_w).max(1),
            height.unwrap_or(base_h).max(1),
            max_side.unwrap_or(PREVIEW_MAX_SIZE),
        );
        let result_layers = layers
            .iter()
            .map(|(layer, texture)| {
                let (dst_x, dst_y, dst_w, dst_h) =
                    plan_layer_rect(layer, texture, output_width, output_height);
                let (src_x, src_y, src_w, src_h) =
                    plan_layer_source_rect(layer, texture, output_width, output_height);
                let transform = plan_layer_transform(layer, texture, output_width, output_height);
                crate::RenderLayer {
                    texture_id: texture.texture_id,
                    fit: Some(layer.fit.clone()),
                    dst_x,
                    dst_y,
                    dst_w,
                    dst_h,
                    src_x,
                    src_y,
                    src_w,
                    src_h,
                    opacity: layer.opacity,
                    z_index: layer.z_index,
                    color: Some(layer.color.clone()),
                    transform: Some(transform),
                    positioning: layer.positioning.clone(),
                    lut_id: layer.lut_id.clone(),
                    lut_intensity: layer.lut_intensity,
                }
            })
            .collect();
        Ok(PlannedPreview {
            width: output_width,
            height: output_height,
            layers: result_layers,
        })
    }
}

/// 使用 ffmpeg 解码静态图片到 RGBA（按 PREVIEW_MAX_SIZE 等比缩小）
pub(crate) fn decode_static_image_scaled(
    ffmpeg: &str,
    ffprobe: &str,
    path: &str,
    max_size: u32,
) -> Result<(Vec<u8>, u32, u32), String> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_frames",
            "-read_intervals",
            "%+#1",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe {}: {}", path, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("ffprobe json: {}", e))?;
    let frame = parsed["frames"].as_array().and_then(|frames| {
        frames
            .iter()
            .find(|f| f["media_type"].as_str() == Some("video"))
    });
    let stream = parsed["streams"].as_array().and_then(|streams| {
        streams
            .iter()
            .find(|s| s["codec_type"].as_str() == Some("video"))
    });
    let encoded_w = frame
        .and_then(|f| f["width"].as_u64())
        .or_else(|| stream.and_then(|s| s["width"].as_u64()))
        .unwrap_or(0) as u32;
    let encoded_h = frame
        .and_then(|f| f["height"].as_u64())
        .or_else(|| stream.and_then(|s| s["height"].as_u64()))
        .unwrap_or(0) as u32;
    if encoded_w == 0 || encoded_h == 0 {
        return Err(format!("invalid image size in {}", path));
    }
    let rotation = image_rotation_degrees(frame, stream);
    let (source_w, source_h) = if rotation == 90 || rotation == 270 {
        log!(
            "decode_static_image rotation={} swap {}x{} -> {}x{} path={}",
            rotation,
            encoded_w,
            encoded_h,
            encoded_h,
            encoded_w,
            path
        );
        (encoded_h, encoded_w)
    } else {
        (encoded_w, encoded_h)
    };

    let max_edge = source_w.max(source_h);
    let (dw, dh) = if max_edge > max_size {
        let s = max_size as f64 / max_edge as f64;
        (
            (source_w as f64 * s).round().max(1.0) as u32,
            (source_h as f64 * s).round().max(1.0) as u32,
        )
    } else {
        (source_w, source_h)
    };

    let local_path = normalize_local_path(path);
    let mut proc = Command::new(ffmpeg)
        .args([
            "-i",
            &local_path,
            "-vf",
            &format!("scale={}:{}:flags=lanczos", dw, dh),
            "-pix_fmt",
            "rgba",
            "-f",
            "rawvideo",
            "-vframes",
            "1",
            "-loglevel",
            "error",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg spawn {}: {}", path, e))?;

    let expected = (dw * dh * 4) as usize;
    let mut rgba = vec![0u8; expected];
    proc.stdout
        .take()
        .ok_or_else(|| "no stdout".to_string())?
        .read_exact(&mut rgba)
        .map_err(|e| format!("read {}: {}", path, e))?;
    proc.wait().ok();

    log!(
        "decode_static_image {} encoded={}x{} display={}x{} output={}x{} rotation={} bytes={}",
        path,
        encoded_w,
        encoded_h,
        source_w,
        source_h,
        dw,
        dh,
        rotation,
        rgba.len()
    );
    Ok((rgba, dw, dh))
}

/// 将 file:///path 转回本地路径，ffmpeg/ffprobe 不支持 URL 编码
fn normalize_local_path(path: &str) -> String {
    let raw = match path.strip_prefix("file://") {
        Some(rest) => rest,
        None => return path.to_string(),
    };
    let mut out = String::with_capacity(raw.len());
    let mut bytes = raw.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            match (bytes.next(), bytes.next()) {
                (Some(h), Some(l)) => {
                    let hi = (h as char).to_digit(16);
                    let lo = (l as char).to_digit(16);
                    match (hi, lo) {
                        (Some(h), Some(l)) => out.push((h as u8 * 16 + l as u8) as char),
                        _ => out.push('%'),
                    }
                }
                _ => out.push('%'),
            }
        } else {
            out.push(b as char);
        }
    }
    out
}

fn image_rotation_degrees(
    frame: Option<&serde_json::Value>,
    stream: Option<&serde_json::Value>,
) -> i32 {
    let displaymatrix_rotation = frame
        .and_then(rotation_from_side_data)
        .or_else(|| stream.and_then(rotation_from_side_data))
        .unwrap_or(0);
    if displaymatrix_rotation != 0 {
        return displaymatrix_rotation;
    }
    frame
        .and_then(rotation_from_orientation_tag)
        .or_else(|| stream.and_then(rotation_from_orientation_tag))
        .unwrap_or(0)
}

fn rotation_from_side_data(value: &serde_json::Value) -> Option<i32> {
    value["side_data_list"].as_array().and_then(|list| {
        list.iter()
            .filter_map(|side_data| side_data["rotation"].as_f64())
            .map(|rotation| ((rotation.round() as i32 % 360) + 360) % 360)
            .find(|rotation| *rotation == 90 || *rotation == 270)
    })
}

fn rotation_from_orientation_tag(value: &serde_json::Value) -> Option<i32> {
    match value["tags"]["Orientation"].as_str()?.trim() {
        "6" => Some(90),
        "8" => Some(270),
        _ => None,
    }
}

/// 探测静态图片的像素尺寸（已考虑 EXIF 旋转），返回 (width, height)
fn probe_static_image_dimensions(ffprobe: &str, path: &str) -> Result<(u32, u32), String> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_frames",
            "-read_intervals",
            "%+#1",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe {}: {}", path, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("ffprobe json: {}", e))?;
    let frame = parsed["frames"].as_array().and_then(|frames| {
        frames
            .iter()
            .find(|f| f["media_type"].as_str() == Some("video"))
    });
    let stream = parsed["streams"].as_array().and_then(|streams| {
        streams
            .iter()
            .find(|s| s["codec_type"].as_str() == Some("video"))
    });
    let encoded_w = frame
        .and_then(|f| f["width"].as_u64())
        .or_else(|| stream.and_then(|s| s["width"].as_u64()))
        .unwrap_or(0) as u32;
    let encoded_h = frame
        .and_then(|f| f["height"].as_u64())
        .or_else(|| stream.and_then(|s| s["height"].as_u64()))
        .unwrap_or(0) as u32;
    if encoded_w == 0 || encoded_h == 0 {
        return Err(format!("invalid image size in {}", path));
    }
    let rotation = image_rotation_degrees(frame, stream);
    let (source_w, source_h) = if rotation == 90 || rotation == 270 {
        (encoded_h, encoded_w)
    } else {
        (encoded_w, encoded_h)
    };
    Ok((source_w, source_h))
}

/// 根据层的 positioning、画布尺寸和源图尺寸，计算层在画布上的显示像素尺寸，
/// 返回最优解码最大边长（1.5x 过采样，不超出 fallback_max_edge）。
/// 无 positioning 时返回 fallback_max_edge（保持原行为）。
fn calc_optimal_decode_max_edge(
    positioning: &Option<crate::LayerPositioning>,
    canvas_width: Option<u32>,
    canvas_height: Option<u32>,
    source_width: u32,
    source_height: u32,
    fallback_max_edge: u32,
) -> u32 {
    let (cw, ch) = match (canvas_width, canvas_height) {
        (Some(cw), Some(ch)) => (cw as f64, ch as f64),
        _ => return fallback_max_edge,
    };
    let pos = match positioning {
        Some(p) => p,
        None => return fallback_max_edge,
    };
    let canvas_aspect = cw / ch.max(1.0);
    let tex_aspect = source_width as f64 / source_height.max(1) as f64;

    // 与 resolve_positioning 一致的计算
    let dst_w_uv = pos.target_width;
    let dst_h_uv = dst_w_uv * canvas_aspect / tex_aspect;

    let dst_w_px = (dst_w_uv * cw).ceil().max(1.0);
    let dst_h_px = (dst_h_uv * ch).ceil().max(1.0);

    // 1.5x 过采样：保留一些多余细节让 GPU 双线性做最后的微量缩放
    let optimal = (dst_w_px.max(dst_h_px) * 1.5).ceil() as u32;
    optimal.min(fallback_max_edge).max(1)
}

fn cached_texture_is_sufficient(width: u32, height: u32, required_max_edge: u32) -> bool {
    width.max(height) >= required_max_edge
}

#[cfg(test)]
mod tests {
    use super::cached_texture_is_sufficient;

    #[test]
    fn rejects_thumbnail_texture_for_workspace_preview() {
        assert!(!cached_texture_is_sufficient(124, 220, 2560));
    }

    #[test]
    fn reuses_larger_texture_for_smaller_preview() {
        assert!(cached_texture_is_sufficient(1440, 2560, 220));
    }
}
