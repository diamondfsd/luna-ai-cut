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
const PREVIEW_MAX_SIZE: u32 = 1920;

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
    _pad: [f32; 1],
    curve_data: [[f32; 4]; 30],
    hsl_data: [[f32; 4]; 8],
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
pub struct PreviewLayerInput {
    pub file_path: String,
    pub is_video: bool,
    pub video_time: f64,
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
}

// ── Compositor ──

pub struct Compositor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    bind_group_layout: wgpu::BindGroupLayout,

    textures: HashMap<u32, TextureEntry>,
    next_texture_id: u32,
    max_texture_size: u32,

    output_texture: Option<(wgpu::Texture, u32, u32)>,

    // ── render_preview 内部状态 ──
    /// 静态图路径→纹理ID LRU 缓存
    texture_cache: HashMap<String, u32>,
    /// LRU 顺序（前=最旧，后=最新）
    cache_order: VecDeque<String>,
    /// 已探测过的视频文件信息 <path → (width, height)>
    video_probed: HashMap<String, (u32, u32)>,
    /// 持久 ffmpeg pipe 解码器 <path → VideoDecoder>
    video_decoders: HashMap<String, VideoDecoder>,
}

/// 持久 ffmpeg pipe 视频解码器，保持进程存活按序读帧
///
/// 字段顺序重要：stdout 必须在 process 之前 drop，
/// 否则 process.wait() 因 pipe 未关闭而阻塞。
struct VideoDecoder {
    stdout: std::process::ChildStdout,
    process: std::process::Child,
    scaled_w: u32,
    scaled_h: u32,
    frame_bytes: usize,
    current_time: f64,
}

/// 创建 bind group layout（每个 layer 一个）
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
            // binding 1: sampler
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
        ],
    })
}

/// 创建 RGBA8 纹理（输入/输出通用）
fn create_rgba_texture(
    device: &wgpu::Device,
    label: &str,
    width: u32,
    height: u32,
    usage: wgpu::TextureUsages,
    mip_level_count: u32,
) -> wgpu::Texture {
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
        format: wgpu::TextureFormat::Rgba8Unorm,
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

/// 对齐
fn align_to(v: u32, align: u32) -> u32 {
    ((v + align - 1) / align) * align
}

impl Compositor {
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

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("compositor pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
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
        });

        Ok(Self {
            device,
            queue,
            pipeline,
            sampler,
            bind_group_layout: bgl,
            textures: HashMap::new(),
            next_texture_id: 1,
            max_texture_size,
            output_texture: None,
            texture_cache: HashMap::new(),
            cache_order: VecDeque::new(),
            video_probed: HashMap::new(),
            video_decoders: HashMap::new(),
        })
    }

    // ── 纹理管理 ──

    pub fn max_texture_size(&self) -> u32 {
        self.max_texture_size
    }

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
        let texture = create_rgba_texture(
            &self.device,
            "layer",
            width,
            height,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            1,
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

    /// 确保纹理存在：不存在则创建，存在则更新
    pub fn ensure_texture(
        &mut self,
        texture_id: u32,
        data: &[u8],
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        if self.textures.contains_key(&texture_id) {
            self.update_texture(texture_id, data)
        } else {
            // 临时设置 next_texture_id 以确保使用指定 ID
            let old_next = self.next_texture_id;
            self.next_texture_id = texture_id;
            let result = self.load_texture(data, width, height);
            self.next_texture_id = old_next.max(texture_id + 1);
            result.map(|_| ())
        }
    }

    // ── 渲染 ──

    pub fn render(
        &mut self,
        canvas_width: u32,
        canvas_height: u32,
        layers: &[RenderLayer],
    ) -> Result<Vec<u8>, String> {
        let pixel_count = (canvas_width * canvas_height * 4) as usize;

        if layers.is_empty() {
            return Ok(vec![0u8; pixel_count]);
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
                ),
                canvas_width,
                canvas_height,
            ));
        }
        let (output_tex, _, _) = self.output_texture.as_ref().unwrap();
        let output_view = output_tex.create_view(&wgpu::TextureViewDescriptor::default());

        // sort by z_index
        let mut sorted: Vec<&RenderLayer> = layers.iter().collect();
        sorted.sort_by_key(|l| l.z_index);

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

            rpass.set_pipeline(&self.pipeline);

            for layer in &sorted {
                let tex_entry = self.textures.get(&layer.texture_id).ok_or_else(|| {
                    log_error!("render: texture {} not found", layer.texture_id);
                    format!("texture {} not found", layer.texture_id)
                })?;
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
                let (frame_w, frame_h) = if swap_orientation {
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

                let params = GpuLayerParams {
                    // dst_* 转像素坐标（用于像素级命中检测）
                    dst_x: (layer.dst_x * canvas_width as f64) as f32,
                    dst_y: (layer.dst_y * canvas_height as f64) as f32,
                    dst_w: (layer.dst_w * canvas_width as f64) as f32,
                    dst_h: (layer.dst_h * canvas_height as f64) as f32,
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

        // copy output → staging buffer
        let row_bytes = canvas_width * 4;
        let row_padded = align_to(row_bytes, 256);
        let buf_size = (row_padded * canvas_height) as u64;

        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("staging"),
            size: buf_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        encoder.copy_texture_to_buffer(
            TexelCopyTextureInfo {
                texture: output_tex,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            TexelCopyBufferInfo {
                buffer: &staging,
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
        let slice = staging.slice(..);
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
        staging.unmap();

        Ok(result)
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

    /// 将静态纹理加入 LRU 缓存，超出上限时淘汰最旧的
    fn cache_static_texture(&mut self, path: String, tex_id: u32) -> Result<(), String> {
        self.texture_cache.insert(path.clone(), tex_id);
        self.cache_order.push_back(path);
        while self.cache_order.len() > MAX_TEXTURE_CACHE {
            let oldest = self.cache_order.pop_front().unwrap();
            if let Some(tid) = self.texture_cache.remove(&oldest) {
                self.release_texture(tid)?;
            }
        }
        Ok(())
    }

    /// 探测视频文件尺寸（结果缓存，避免重复 ffprobe）
    fn probe_video(&mut self, ffprobe: &str, path: &str) -> Result<(u32, u32), String> {
        if let Some(&dims) = self.video_probed.get(path) {
            return Ok(dims);
        }
        let output = Command::new(ffprobe)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                path,
            ])
            .output()
            .map_err(|e| format!("ffprobe {}: {}", path, e))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("ffprobe json: {}", e))?;
        let streams = parsed["streams"]
            .as_array()
            .ok_or_else(|| "no streams".to_string())?;
        let vs = streams
            .iter()
            .find(|s| s["codec_type"].as_str() == Some("video"))
            .ok_or_else(|| "no video stream".to_string())?;
        let w = vs["width"].as_u64().unwrap_or(0) as u32;
        let h = vs["height"].as_u64().unwrap_or(0) as u32;
        if w == 0 || h == 0 {
            return Err(format!("invalid video dimensions in {}", path));
        }
        self.video_probed.insert(path.to_string(), (w, h));
        Ok((w, h))
    }

    /// 获取视频帧：保持 ffmpeg pipe 存活，逐帧顺序读取。
    /// 初次 spawn + `-ss {time}` 定位起始位置，之后每次只读 pipe 的下一帧。
    /// 重新 spawn 只在视频文件切换或 pipe 异常时发生。
    fn read_video_frame(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        file_path: &str,
        video_time: f64,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        // 已有 decoder 且文件路径匹配 → 从 pipe 顺序读下一帧
        if let Some(dec) = self.video_decoders.get_mut(file_path) {
            let mut rgba = vec![0u8; dec.frame_bytes];
            // read_exact 可能因管道关闭失败（eof），此时需要重新 spawn
            if dec.stdout.read_exact(&mut rgba).is_err() {
                log!("read_video_frame [{}] pipe EOF, restarting", file_path);
                self.video_decoders.remove(file_path);
                return self.read_video_frame(ffmpeg, ffprobe, file_path, video_time);
            }
            dec.current_time = video_time;
            return Ok((rgba, dec.scaled_w, dec.scaled_h));
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

        // 不带 -vframes N，ffmpeg 持续输出帧直到 pipe 关闭
        let mut proc = Command::new(ffmpeg)
            .args([
                "-ss",
                &format!("{:.3}", video_time),
                "-i",
                file_path,
                "-vf",
                &format!("scale={}:{}:flags=lanczos", dw, dh),
                "-pix_fmt",
                "rgba",
                "-f",
                "rawvideo",
                "-loglevel",
                "error",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("ffmpeg spawn {}: {}", file_path, e))?;

        let stdout = proc.stdout.take().ok_or_else(|| "no stdout".to_string())?;

        // 读第1帧
        let mut rgba = vec![0u8; frame_bytes];
        let mut child_stdout = stdout;
        child_stdout
            .read_exact(&mut rgba)
            .map_err(|e| format!("read first frame {}: {}", file_path, e))?;

        self.video_decoders.insert(
            file_path.to_string(),
            VideoDecoder {
                process: proc,
                stdout: child_stdout,
                scaled_w: dw,
                scaled_h: dh,
                frame_bytes,
                current_time: video_time,
            },
        );

        log!(
            "read_video_frame [{}] started at {:.3}s {}x{}",
            file_path,
            video_time,
            dw,
            dh,
        );
        Ok((rgba, dw, dh))
    }

    /// 统一渲染预览帧：静态图走 LRU 缓存，视频帧保持 ffmpeg pipe 持续读
    pub fn render_preview(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        width: Option<u32>,
        height: Option<u32>,
        max_side: Option<u32>,
        layers: &[PreviewLayerInput],
    ) -> Result<(Vec<u8>, u32, u32), String> {
        // ── 清理已不再使用的视频 decoder ──
        let active_video_paths: std::collections::HashSet<&str> = layers
            .iter()
            .filter(|l| l.is_video)
            .map(|l| l.file_path.as_str())
            .collect();
        self.video_decoders
            .retain(|path, _| active_video_paths.contains(path.as_str()));

        let mut result_layers = Vec::with_capacity(layers.len());
        let mut first_layer_size: Option<(u32, u32)> = None;

        for layer in layers {
            let tex_id = if layer.is_video {
                // ── 视频帧：持久 ffmpeg pipe 依次读帧 ──
                let (rgba, dw, dh) =
                    self.read_video_frame(ffmpeg, ffprobe, &layer.file_path, layer.video_time)?;
                self.load_texture(&rgba, dw, dh)?
            } else {
                // ── 静态图：LRU 缓存 ──
                let cached = self.get_cached_texture(&layer.file_path);
                if let Some(tid) = cached {
                    tid
                } else {
                    let (rgba, w, h) = decode_static_image(ffmpeg, ffprobe, &layer.file_path)?;
                    let tid = self.load_texture(&rgba, w, h)?;
                    self.cache_static_texture(layer.file_path.clone(), tid)?;
                    tid
                }
            };

            if first_layer_size.is_none() {
                let entry = self
                    .textures
                    .get(&tex_id)
                    .ok_or_else(|| format!("texture {} not found", tex_id))?;
                first_layer_size = Some((entry.width, entry.height));
            }

            result_layers.push(crate::RenderLayer {
                texture_id: tex_id,
                dst_x: layer.dst_x,
                dst_y: layer.dst_y,
                dst_w: layer.dst_w,
                dst_h: layer.dst_h,
                src_x: layer.src_x,
                src_y: layer.src_y,
                src_w: layer.src_w,
                src_h: layer.src_h,
                opacity: layer.opacity,
                z_index: layer.z_index,
                color: Some(layer.color.clone()),
                transform: Some(layer.transform.clone()),
            });
        }

        let (source_width, source_height) =
            first_layer_size.ok_or_else(|| "no valid layers for preview".to_string())?;
        let (output_width, output_height) = fit_output_size(
            width.unwrap_or(source_width).max(1),
            height.unwrap_or(source_height).max(1),
            max_side.unwrap_or(PREVIEW_MAX_SIZE),
        );
        let result = self.render(output_width, output_height, &result_layers)?;

        // 释放视频帧的临时纹理（静态图纹理保留在缓存中）
        for (i, layer) in layers.iter().enumerate() {
            if layer.is_video {
                self.release_texture(result_layers[i].texture_id)?;
            }
        }

        Ok((result, output_width, output_height))
    }
}

fn fit_output_size(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    let max_side = max_side.max(1);
    let edge = width.max(height);
    if edge <= max_side {
        return (width.max(1), height.max(1));
    }
    let scale = max_side as f64 / edge as f64;
    (
        (width as f64 * scale).round().max(1.0) as u32,
        (height as f64 * scale).round().max(1.0) as u32,
    )
}

/// 使用 ffmpeg 解码静态图片到 RGBA（按 PREVIEW_MAX_SIZE 等比缩小）
fn decode_static_image(
    ffmpeg: &str,
    ffprobe: &str,
    path: &str,
) -> Result<(Vec<u8>, u32, u32), String> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe {}: {}", path, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("ffprobe json: {}", e))?;
    let streams = parsed["streams"]
        .as_array()
        .ok_or_else(|| "no streams".to_string())?;
    let vs = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or_else(|| "no video stream".to_string())?;
    let source_w = vs["width"].as_u64().unwrap_or(0) as u32;
    let source_h = vs["height"].as_u64().unwrap_or(0) as u32;
    if source_w == 0 || source_h == 0 {
        return Err(format!("invalid image size in {}", path));
    }

    let max_edge = source_w.max(source_h);
    let (dw, dh) = if max_edge > PREVIEW_MAX_SIZE {
        let s = PREVIEW_MAX_SIZE as f64 / max_edge as f64;
        (
            (source_w as f64 * s).round().max(1.0) as u32,
            (source_h as f64 * s).round().max(1.0) as u32,
        )
    } else {
        (source_w, source_h)
    };

    let mut proc = Command::new(ffmpeg)
        .args([
            "-i",
            path,
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
        "decode_static_image {} {}x{} -> {}x{}",
        path,
        source_w,
        source_h,
        dw,
        dh
    );
    Ok((rgba, dw, dh))
}
