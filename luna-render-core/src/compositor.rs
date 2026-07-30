mod cache;
mod external;
mod gpu;
mod init;
mod layer_kind;
mod lut;
mod mask;
mod playback;
mod preview;
mod render;
mod shared;
#[cfg(test)]
mod tests;
mod text;
mod texture;

use gpu::{
    align_to, create_compositor_pipelines, create_identity_lut, create_lut_3d_texture,
    create_rgba_texture, layer_bind_group_layout, parse_cube_lut, upload_rgba,
};
pub(crate) use layer_kind::is_procedural_layer_type;
use mask::{linear_clamp_sampler_descriptor, mask_params};
use preview::{plan_cover_scale, plan_cover_transform, resolve_positioning};
pub(crate) use preview::{PreviewLayerInput, PreviewTextureInfo};

use crate::media::{
    decode_static_image_scaled, fit_output_size, normalize_local_path,
    probe_static_image_dimensions, probe_video_dimensions,
};
use crate::RenderLayer;
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::process::Stdio;
use wgpu::TexelCopyBufferInfo;
use wgpu::TexelCopyBufferLayout;
use wgpu::TexelCopyTextureInfo;

/// 静态图纹理 LRU 缓存上限
const MAX_TEXTURE_CACHE: usize = 10;
/// 预览纹理最大边长
const PREVIEW_MAX_SIZE: u32 = 1280; // 从 1920 降低到 1280，减少 56% 数据量

macro_rules! log {
    ($($arg:tt)*) => {
        crate::logging::write(&format!($($arg)*))
    };
}

// ── WGSL 着色器 ──

const SHADER: &str = concat!(
    include_str!("shaders/vertex.wgsl"),
    include_str!("shaders/params.wgsl"),
    include_str!("shaders/common.wgsl"),
    include_str!("shaders/detail.wgsl"),
    include_str!("shaders/curve.wgsl"),
    include_str!("shaders/color.wgsl"),
    include_str!("shaders/pixel_flow.wgsl"),
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
    restore_lut_size: f32,
    lut_size: f32,
    lut_intensity: f32,
    sampling_quality: f32,
    lut_padding: [f32; 3],
    mask_params: [f32; 4],
    mask_transform: [f32; 4],
    procedural: [f32; 4],
    pixel_stretch: [f32; 4],
    pixel_stretch_extra: [f32; 4],
    pixel_stretch_center: [f32; 4],
    pixel_stretch_path_meta: [f32; 4],
    pixel_stretch_path_data: [[f32; 4]; 4],
    pixel_flow: [f32; 4],
    pixel_flow_geometry: [f32; 4],
    pixel_flow_depth: [f32; 4],
    pixel_flow_scale: [f32; 4],
    pixel_flow_finish: [f32; 4],
    fill_rgba: [f32; 4],
    stroke_rgba: [f32; 4],
    text_meta: [f32; 4],
    text_data: [[f32; 4]; 32],
    curve_data: [[f32; 4]; 30],
    hsl_data: [[f32; 4]; 12],
}

fn parse_hex_color(value: Option<&str>, fallback: [f32; 4]) -> [f32; 4] {
    let Some(hex) = value.map(|s| s.trim_start_matches('#')) else {
        return fallback;
    };
    if hex.len() != 6 && hex.len() != 8 {
        return fallback;
    }
    let byte = |start| {
        u8::from_str_radix(&hex[start..start + 2], 16)
            .ok()
            .map(|v| v as f32 / 255.0)
    };
    match (byte(0), byte(2), byte(4)) {
        (Some(r), Some(g), Some(b)) => [
            r,
            g,
            b,
            if hex.len() == 8 {
                byte(6).unwrap_or(1.0)
            } else {
                1.0
            },
        ],
        _ => fallback,
    }
}

struct LutEntry {
    texture: wgpu::Texture,
    size: u32,
}

struct TextureEntry {
    texture: wgpu::Texture,
    width: u32,
    height: u32,
    #[cfg(target_os = "windows")]
    #[allow(dead_code)]
    external: bool,
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

fn pack_hsl_channels(channels: &[crate::RenderHslChannelAdjust]) -> [[f32; 4]; 12] {
    let defaults = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 285.0, 320.0];
    let mut data = [[0.0; 4]; 12];
    for index in 0..data.len() {
        let channel = channels.get(index);
        let default_hue = defaults.get(index).copied().unwrap_or(0.0);
        data[index] = [
            channel
                .map(|c| c.hue)
                .unwrap_or(default_hue)
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

// ── Compositor ──

pub struct Compositor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipelines: gpu::BlendPipelines,
    /// BGRA sRGB 格式渲染管线（macOS Metal External）
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pipelines_bgra: gpu::BlendPipelines,
    sampler: wgpu::Sampler,
    bind_group_layout: wgpu::BindGroupLayout,

    textures: HashMap<u32, TextureEntry>,
    next_texture_id: u32,
    pub max_texture_size: u32,

    output_texture: Option<(wgpu::Texture, u32, u32)>,

    // ── render_preview 内部状态 ──
    /// 静态图路径→纹理ID LRU 缓存
    texture_cache: HashMap<String, u32>,
    /// 灰度蒙版使用线性 RGBA 纹理，不能与 sRGB 媒体纹理共用缓存。
    mask_texture_cache: HashMap<String, u32>,
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
    fonts: HashMap<String, Vec<u8>>,
    text_texture_cache: HashMap<String, u32>,
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
impl Compositor {
    pub fn new(log_path: Option<&str>) -> Result<Self, String> {
        // 初始化文件日志
        let path = log_path.unwrap_or("luna-rc.log");
        crate::logging::init(path);
        log!("Creating wgpu instance...");
        // Windows 默认枚举 Vulkan 和 D3D12。部分旧版 Intel Vulkan 驱动会在
        // 枚举阶段直接访问冲突，进程无法捕获，因此 Windows 只启用 D3D12。
        let backends = if cfg!(target_os = "windows") {
            wgpu::Backends::DX12
        } else {
            wgpu::Backends::default()
        };
        log!("Enabled wgpu backends: {:?}", backends);
        let instance = wgpu::Instance::new(init::instance_descriptor(backends, log_path)?);

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

        let sampler = device.create_sampler(&linear_clamp_sampler_descriptor());

        let bgl = layer_bind_group_layout(&device);

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("compositor layout"),
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });

        let pipelines = create_compositor_pipelines(
            &device,
            &pipeline_layout,
            &shader,
            wgpu::TextureFormat::Rgba8UnormSrgb,
            "compositor pipeline",
        );
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let pipelines_bgra = create_compositor_pipelines(
            &device,
            &pipeline_layout,
            &shader,
            wgpu::TextureFormat::Bgra8UnormSrgb,
            "compositor pipeline BGRA sRGB",
        );

        // ── identity LUT（2×2×2，采样输出 = 输入） ──
        let identity_lut = create_identity_lut(&device, &queue);
        log!("identity_lut created size=2x2x2 format=Rgba8Unorm");

        let procedural_texture = create_rgba_texture(
            &device,
            "procedural-white",
            1,
            1,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            1,
            true,
        );
        queue.write_texture(
            procedural_texture.as_image_copy(),
            &[255, 255, 255, 255],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        let mut initial_textures = HashMap::new();
        initial_textures.insert(
            0,
            TextureEntry {
                texture: procedural_texture,
                width: 1,
                height: 1,
                #[cfg(target_os = "windows")]
                external: false,
            },
        );

        Ok(Self {
            device,
            queue,
            pipelines,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            pipelines_bgra,
            sampler,
            bind_group_layout: bgl,
            textures: initial_textures,
            next_texture_id: 1,
            max_texture_size,
            output_texture: None,
            texture_cache: HashMap::new(),
            mask_texture_cache: HashMap::new(),
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
            fonts: HashMap::new(),
            text_texture_cache: HashMap::new(),
        })
    }

    /// 渲染并回读 RGBA。预览和跨平台 FFmpeg 回退路径继续使用此入口。
    pub fn render(
        &mut self,
        canvas_width: u32,
        canvas_height: u32,
        layers: &[RenderLayer],
    ) -> Result<Vec<u8>, String> {
        self.render_impl(canvas_width, canvas_height, layers, true, false)
    }
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
