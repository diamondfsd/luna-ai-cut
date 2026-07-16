use super::GpuLayerParams;
use wgpu::{TexelCopyBufferLayout, TexelCopyTextureInfo};

pub(super) fn layer_bind_group_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
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
            // binding 5: layer color mask (white identity fallback)
            wgpu::BindGroupLayoutEntry {
                binding: 5,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
        ],
    })
}

pub(super) struct BlendPipelines {
    normal: wgpu::RenderPipeline,
    multiply: wgpu::RenderPipeline,
    screen: wgpu::RenderPipeline,
    add: wgpu::RenderPipeline,
}

impl BlendPipelines {
    pub(super) fn get(&self, blend_mode: Option<&str>) -> &wgpu::RenderPipeline {
        match blend_mode {
            Some("multiply") => &self.multiply,
            Some("screen") => &self.screen,
            Some("add") => &self.add,
            _ => &self.normal,
        }
    }
}

pub(super) fn create_compositor_pipelines(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
    label: &str,
) -> BlendPipelines {
    BlendPipelines {
        normal: create_compositor_pipeline(
            device,
            layout,
            shader,
            format,
            &format!("{label} normal"),
            "normal",
        ),
        multiply: create_compositor_pipeline(
            device,
            layout,
            shader,
            format,
            &format!("{label} multiply"),
            "multiply",
        ),
        screen: create_compositor_pipeline(
            device,
            layout,
            shader,
            format,
            &format!("{label} screen"),
            "screen",
        ),
        add: create_compositor_pipeline(
            device,
            layout,
            shader,
            format,
            &format!("{label} add"),
            "add",
        ),
    }
}

fn create_compositor_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
    label: &str,
    blend_mode: &str,
) -> wgpu::RenderPipeline {
    let alpha = wgpu::BlendComponent {
        src_factor: wgpu::BlendFactor::One,
        dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
        operation: wgpu::BlendOperation::Add,
    };
    let color = match blend_mode {
        "multiply" => wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::Dst,
            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
            operation: wgpu::BlendOperation::Add,
        },
        "screen" => wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::OneMinusSrc,
            operation: wgpu::BlendOperation::Add,
        },
        "add" => wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::One,
            operation: wgpu::BlendOperation::Add,
        },
        _ => wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
            operation: wgpu::BlendOperation::Add,
        },
    };
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
                blend: Some(wgpu::BlendState { color, alpha }),
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
pub(super) fn create_rgba_texture(
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
pub(super) fn upload_rgba_ex(
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
pub(super) fn upload_rgba(
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    data: &[u8],
    width: u32,
    height: u32,
) {
    upload_rgba_ex(queue, texture, data, width, height, 0);
}

/// 创建 2×2×2 identity LUT（未启用 LUT 时的默认绑定，采样原值）
pub(super) fn create_identity_lut(device: &wgpu::Device, queue: &wgpu::Queue) -> wgpu::Texture {
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
pub(super) fn create_lut_3d_texture(
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
pub(super) fn parse_cube_lut(data: &[u8]) -> Result<(u32, Vec<f32>), String> {
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
pub(super) fn align_to(v: u32, align: u32) -> u32 {
    ((v + align - 1) / align) * align
}
