use crate::RenderLayer;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use wgpu::TexelCopyBufferInfo;
use wgpu::TexelCopyBufferLayout;
use wgpu::TexelCopyTextureInfo;

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
    let ts = chrono::Local::now().format("%H:%M:%S%.3f");
    let line = format!("[{}] {}", ts, msg);
    eprintln!("[LunaRC] {}", msg);
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

const SHADER: &str = r#"
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    let xi = idx & 1u;
    let yi = (idx & 2u) >> 1u;
    let x = f32(xi * 2u) - 1.0;
    let y = 1.0 - f32(yi * 2u);
    var out: VertexOutput;
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

struct LayerParams {
    dst_x: f32,
    dst_y: f32,
    dst_w: f32,
    dst_h: f32,
    src_x: f32,
    src_y: f32,
    src_w: f32,
    src_h: f32,
    opacity: f32,
}

@group(0) @binding(0) var src_texture: texture_2d<f32>;
@group(0) @binding(1) var src_sampler: sampler;
@group(0) @binding(2) var<uniform> params: LayerParams;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let pixel_x = in.position.x;
    let pixel_y = in.position.y;

    let in_rect = pixel_x >= params.dst_x
        && pixel_x < params.dst_x + params.dst_w
        && pixel_y >= params.dst_y
        && pixel_y < params.dst_y + params.dst_h;

    if (!in_rect) {
        discard;
    }

    let local_x = (pixel_x - params.dst_x) / params.dst_w;
    let local_y = (pixel_y - params.dst_y) / params.dst_h;
    let tex_coord = vec2<f32>(
        params.src_x + local_x * params.src_w,
        params.src_y + local_y * params.src_h,
    );

    var color = textureSample(src_texture, src_sampler, tex_coord);
    color.a = color.a * params.opacity;
    return color;
}
"#;

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
    opacity: f32,
    _pad: [f32; 3],
}

struct TextureEntry {
    texture: wgpu::Texture,
    width: u32,
    height: u32,
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
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage,
        view_formats: &[],
    })
}

/// 上传 RGBA 数据到纹理
fn upload_rgba(queue: &wgpu::Queue, texture: &wgpu::Texture, data: &[u8], width: u32, height: u32) {
    queue.write_texture(
        TexelCopyTextureInfo {
            texture,
            mip_level: 0,
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

        let texture = create_rgba_texture(
            &self.device,
            "layer",
            width,
            height,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
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

        // ── ffprobe 获取原始尺寸 ──
        let probe_output = Command::new(ffprobe)
            .args([
                "-v", "quiet",
                "-print_format", "json",
                "-show_streams", path,
            ])
            .output()
            .map_err(|e| format!("ffprobe {}: {}", path, e))?;
        let probe_stdout = String::from_utf8_lossy(&probe_output.stdout);
        let parsed: serde_json::Value =
            serde_json::from_str(&probe_stdout).map_err(|e| format!("ffprobe json: {}", e))?;
        let streams = parsed["streams"]
            .as_array()
            .ok_or_else(|| format!("ffprobe: no streams in {}", path))?;
        let vs = streams
            .iter()
            .find(|s| s["codec_type"].as_str() == Some("video"))
            .ok_or_else(|| format!("ffprobe: no video stream in {}", path))?;
        let source_w = vs["width"].as_u64().unwrap_or(0) as u32;
        let source_h = vs["height"].as_u64().unwrap_or(0) as u32;
        if source_w == 0 || source_h == 0 {
            return Err(format!("ffprobe: invalid image size in {}", path));
        }

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
                "-i", path,
                "-vf", &format!("scale={}:{}:flags=lanczos", width, height),
                "-pix_fmt", "rgba",
                "-f", "rawvideo",
                "-vframes", "1",
                "-loglevel", "error",
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
            .map_err(|e| format!("ffmpeg read {}: {}", path, e))?;
        let status = proc
            .wait()
            .map_err(|e| format!("ffmpeg wait {}: {}", path, e))?;
        if !status.success() {
            return Err(format!("ffmpeg exit {} for {}", status, path));
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
        log!("update_texture id={} {}bytes", texture_id, expected);
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
                    opacity: layer.opacity as f32,
                    _pad: [0.0; 3],
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
}
