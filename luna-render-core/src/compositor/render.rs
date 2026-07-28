use super::*;
use crate::{log, log_error};

impl Compositor {
    pub(super) fn render_impl(
        &mut self,
        canvas_width: u32,
        canvas_height: u32,
        layers: &[RenderLayer],
        readback: bool,
        present_output: bool,
    ) -> Result<Vec<u8>, String> {
        let (prepared_layers, temporary_texture_ids) = self.prepare_precompositions(layers)?;
        let result = self.render_flat_impl(
            canvas_width,
            canvas_height,
            &prepared_layers,
            readback,
            present_output,
        );
        for texture_id in temporary_texture_ids {
            self.textures.remove(&texture_id);
        }
        result
    }

    fn prepare_precompositions(
        &mut self,
        layers: &[RenderLayer],
    ) -> Result<(Vec<RenderLayer>, Vec<u32>), String> {
        let mut groups = std::collections::BTreeMap::<String, Vec<RenderLayer>>::new();
        for layer in layers {
            if layer.precompose_role.as_deref() != Some("input") {
                continue;
            }
            let group = layer
                .precompose_group
                .as_ref()
                .ok_or_else(|| "precompose input is missing a group".to_string())?;
            let mut input = layer.clone();
            input.precompose_group = None;
            input.precompose_role = None;
            groups.entry(group.clone()).or_default().push(input);
        }

        if groups.is_empty() {
            return Ok((layers.to_vec(), Vec::new()));
        }

        let mut group_textures = std::collections::BTreeMap::<String, u32>::new();
        let mut temporary_texture_ids = Vec::with_capacity(groups.len());
        for (group, inputs) in groups {
            let first = inputs
                .first()
                .ok_or_else(|| format!("precompose group {group} has no inputs"))?;
            let source = self.textures.get(&first.texture_id).ok_or_else(|| {
                format!("precompose source texture {} not found", first.texture_id)
            })?;
            let width = source.width.max(1);
            let height = source.height.max(1);
            let texture = create_rgba_texture(
                &self.device,
                "precomposed layer group",
                width,
                height,
                wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                1,
                true,
            );
            let previous_output = self.output_texture.replace((texture, width, height));
            let render_result = self.render_flat_impl(width, height, &inputs, false, false);
            let rendered = self.output_texture.take();
            self.output_texture = previous_output;
            render_result?;
            let (texture, _, _) =
                rendered.ok_or_else(|| format!("precompose group {group} produced no texture"))?;

            let texture_id = self.next_texture_id;
            self.next_texture_id += 1;
            self.textures.insert(
                texture_id,
                TextureEntry {
                    texture,
                    width,
                    height,
                    #[cfg(target_os = "windows")]
                    external: false,
                },
            );
            group_textures.insert(group, texture_id);
            temporary_texture_ids.push(texture_id);
        }

        let mut prepared = Vec::with_capacity(layers.len());
        for layer in layers {
            match layer.precompose_role.as_deref() {
                Some("input") => {}
                Some("output") => {
                    let group = layer
                        .precompose_group
                        .as_ref()
                        .ok_or_else(|| "precompose output is missing a group".to_string())?;
                    let texture_id = group_textures
                        .get(group)
                        .copied()
                        .ok_or_else(|| format!("precompose group {group} has no inputs"))?;
                    let mut output = layer.clone();
                    output.texture_id = texture_id;
                    output.precompose_group = None;
                    output.precompose_role = None;
                    prepared.push(output);
                }
                _ => prepared.push(layer.clone()),
            }
        }
        Ok((prepared, temporary_texture_ids))
    }

    fn render_flat_impl(
        &mut self,
        mut canvas_width: u32,
        mut canvas_height: u32,
        layers: &[RenderLayer],
        readback: bool,
        _present_output: bool,
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

        let mut prepared_layers = layers.to_vec();
        for layer in &mut prepared_layers {
            if matches!(layer.layer_type.as_deref(), Some("text") | Some("logo")) {
                layer.texture_id = self.text_texture(layer, canvas_width, canvas_height)?;
                layer.layer_type = Some("text-raster".to_string());
                layer.fit = Some("stretch".to_string());
            }
        }
        // sort by z_index
        let mut sorted: Vec<&RenderLayer> = prepared_layers.iter().collect();
        sorted.sort_by_key(|l| l.z_index);

        // 预加载所有层需要的 LUT（在借用 self.output_texture 之前）
        for layer in &sorted {
            if let Some(path) = &layer.restore_lut_id {
                if let Err(e) = self.ensure_lut_loaded(path) {
                    log!("还原 LUT 加载失败 {}: {}", path, e);
                }
            }
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

            for layer in &sorted {
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                let pipelines = if output_tex.format() == wgpu::TextureFormat::Bgra8UnormSrgb {
                    &self.pipelines_bgra
                } else {
                    &self.pipelines
                };
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                let pipelines = &self.pipelines;
                rpass.set_pipeline(pipelines.get(layer.blend_mode.as_deref()));

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
                let layer_type = layer.layer_type.as_deref().unwrap_or("media");
                let procedural_kind = match layer_type {
                    "shape" => 1.0,
                    "text" | "logo" => 2.0,
                    "text-raster" => 3.0,
                    _ => 0.0,
                };
                let pixel_stretch = layer.pixel_stretch.as_ref().map_or([0.0; 4], |effect| {
                    let mode = match effect.mode.as_str() {
                        "right" => 1.0,
                        "down" => 2.0,
                        "swirl" => 3.0,
                        "swirl-front" => 4.0,
                        "left" => 5.0,
                        "up" => 6.0,
                        "horizontal" => 7.0,
                        "vertical" => 8.0,
                        _ => 0.0,
                    };
                    [
                        mode,
                        effect.intensity.clamp(0.0, 100.0) as f32,
                        effect.origin_x.clamp(0.0, 1.0) as f32,
                        effect.origin_y.clamp(0.0, 1.0) as f32,
                    ]
                });
                let pixel_stretch_extra = layer.pixel_stretch.as_ref().map_or([0.0; 4], |effect| {
                    let horizontal =
                        matches!(effect.mode.as_str(), "left" | "right" | "horizontal");
                    [
                        effect.angle.unwrap_or(0.0).clamp(-180.0, 180.0) as f32,
                        effect
                            .line_end
                            .unwrap_or(if horizontal {
                                effect.origin_x
                            } else {
                                effect.origin_y
                            })
                            .clamp(0.0, 1.0) as f32,
                        effect.sample_start.unwrap_or(0.0).clamp(0.0, 1.0) as f32,
                        effect.sample_end.unwrap_or(1.0).clamp(0.0, 1.0) as f32,
                    ]
                });
                let pixel_stretch_center =
                    layer
                        .pixel_stretch
                        .as_ref()
                        .map_or([0.5, 0.5, 0.0, 0.0], |effect| {
                            let horizontal =
                                matches!(effect.mode.as_str(), "left" | "right" | "horizontal");
                            [
                                effect.center_x.unwrap_or(0.5).clamp(0.0, 1.0) as f32,
                                effect.center_y.unwrap_or(0.5).clamp(0.0, 1.0) as f32,
                                effect
                                    .control_start
                                    .unwrap_or(if horizontal {
                                        effect.origin_x
                                    } else {
                                        effect.origin_y
                                    })
                                    .clamp(0.0, 1.0) as f32,
                                effect
                                    .control_end
                                    .unwrap_or(effect.line_end.unwrap_or(if horizontal {
                                        effect.origin_x
                                    } else {
                                        effect.origin_y
                                    }))
                                    .clamp(0.0, 1.0) as f32,
                            ]
                        });
                let pixel_stretch_path_meta =
                    layer.pixel_stretch.as_ref().map_or([0.0; 4], |effect| {
                        let enabled = effect
                            .path_points
                            .as_ref()
                            .is_some_and(|points| points.len() == 14);
                        [
                            if enabled { 1.0 } else { 0.0 },
                            effect.path_start_width.unwrap_or(0.2).clamp(0.001, 2.0) as f32,
                            effect.path_end_width.unwrap_or(0.1).clamp(0.001, 2.0) as f32,
                            if effect.fill_sample_gaps.unwrap_or(false) {
                                1.0
                            } else {
                                0.0
                            },
                        ]
                    });
                let mut pixel_stretch_path_data = [[0.0; 4]; 4];
                if let Some(points) = layer
                    .pixel_stretch
                    .as_ref()
                    .and_then(|effect| effect.path_points.as_ref())
                {
                    if points.len() == 14 {
                        for (index, value) in points.iter().enumerate() {
                            pixel_stretch_path_data[index / 4][index % 4] =
                                value.clamp(-2.0, 3.0) as f32;
                        }
                    }
                }
                let pixel_flow = layer.pixel_flow.as_ref().map_or([0.0; 4], |effect| {
                    [
                        1.0,
                        effect.progress.unwrap_or(0.0).clamp(0.0, 1.0) as f32,
                        effect.pixel_size.clamp(2.0, 64.0) as f32,
                        effect.light_width.clamp(1.0, 30.0) as f32,
                    ]
                });
                let pixel_flow_geometry =
                    layer
                        .pixel_flow
                        .as_ref()
                        .map_or([0.5, 0.28, 0.5, 0.48], |effect| {
                            [
                                effect.origin_x.clamp(0.0, 1.0) as f32,
                                effect.origin_y.clamp(0.0, 1.0) as f32,
                                effect.impact_x.clamp(0.0, 1.0) as f32,
                                effect.impact_y.clamp(0.0, 1.0) as f32,
                            ]
                        });
                let pixel_flow_depth = layer.pixel_flow.as_ref().map_or([0.0; 4], |effect| {
                    let sky_mode = match effect.sky_mode.as_deref() {
                        Some("sweep") => 1.0,
                        Some("full") => 2.0,
                        _ => 0.0,
                    };
                    let other_direction = if effect.flow_mode.as_deref() == Some("whole-frame") {
                        3.0
                    } else {
                        match effect.other_direction.as_deref() {
                            Some("outside-in") => 1.0,
                            Some("inside-out") => 2.0,
                            _ => 0.0,
                        }
                    };
                    [
                        effect.depth_strength.clamp(0.0, 100.0) as f32,
                        effect.duration.clamp(0.1, 60.0) as f32,
                        sky_mode,
                        other_direction,
                    ]
                });
                let pixel_flow_scale =
                    layer
                        .pixel_flow
                        .as_ref()
                        .map_or([1.0, 1.0, 1.0, 0.0], |effect| {
                            [
                                effect.sky_scale.unwrap_or(1.0).clamp(0.02, 1.0) as f32,
                                effect.background_scale.unwrap_or(1.0).clamp(0.02, 1.0) as f32,
                                effect.subject_scale.unwrap_or(1.0).clamp(0.02, 1.0) as f32,
                                effect.sky_black_ratio.unwrap_or(0.0).clamp(0.0, 1.0) as f32,
                            ]
                        });
                let shape_kind = match layer.shape.as_deref() {
                    Some("rounded-rectangle") => 1.0,
                    Some("line") => 2.0,
                    Some("circle") => 3.0,
                    _ => 0.0,
                };
                let fill_rgba = if procedural_kind > 1.5 {
                    parse_hex_color(layer.text_color.as_deref(), [1.0, 1.0, 1.0, 1.0])
                } else {
                    parse_hex_color(layer.fill_color.as_deref(), [1.0, 1.0, 1.0, 1.0])
                };
                let stroke_rgba =
                    parse_hex_color(layer.stroke_color.as_deref(), [0.0, 0.0, 0.0, 0.0]);
                let text = layer.content.as_deref().unwrap_or("");
                let ascii: Vec<u8> = text
                    .chars()
                    .take(128)
                    .map(|ch| if ch.is_ascii() { ch as u8 } else { b'?' })
                    .collect();
                let mut text_data = [[0.0f32; 4]; 32];
                for (index, byte) in ascii.iter().enumerate() {
                    text_data[index / 4][index % 4] = *byte as f32;
                }
                let text_align = match layer.text_align.as_deref() {
                    Some("center") => 1.0,
                    Some("right") => 2.0,
                    _ => 0.0,
                };
                let vertical_align_val = match layer.vertical_align.as_deref() {
                    Some("top") => 0.0,
                    Some("bottom") => 2.0,
                    _ => 1.0,
                };

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

                let (restore_lut_texture, restore_lut_size) = match &layer.restore_lut_id {
                    Some(path) => self.luts.get(path.as_str()).map_or_else(
                        || (&self.identity_lut, 0.0),
                        |entry| (&entry.texture, entry.size as f32),
                    ),
                    None => (&self.identity_lut, 0.0),
                };
                // ── 确定当前层的创意 LUT（已在 render loop 前预加载） ──
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
                    restore_lut_size,
                    lut_size,
                    lut_intensity: layer.lut_intensity.unwrap_or(100.0) as f32,
                    sampling_quality: if layer.positioning.is_some() {
                        1.0
                    } else {
                        0.0
                    },
                    lut_padding: [0.0; 3],
                    mask_params: mask_params(layer),
                    mask_transform: layer
                        .mask_transform
                        .as_ref()
                        .map(|transform| {
                            [
                                transform.translate_x as f32,
                                transform.translate_y as f32,
                                transform.scale.clamp(0.1, 10.0) as f32,
                                transform.rotation as f32,
                            ]
                        })
                        .unwrap_or([0.0, 0.0, 1.0, 0.0]),
                    procedural: [
                        procedural_kind,
                        if procedural_kind > 1.5 {
                            vertical_align_val
                        } else {
                            shape_kind
                        },
                        layer.corner_radius.unwrap_or(0.0) as f32,
                        layer.stroke_width.unwrap_or(0.0) as f32,
                    ],
                    pixel_stretch,
                    pixel_stretch_extra,
                    pixel_stretch_center,
                    pixel_stretch_path_meta,
                    pixel_stretch_path_data,
                    pixel_flow,
                    pixel_flow_geometry,
                    pixel_flow_depth,
                    pixel_flow_scale,
                    fill_rgba,
                    stroke_rgba,
                    text_meta: [
                        (layer.font_size.unwrap_or(16.0) * canvas_height as f64 / 1080.0) as f32,
                        text_align,
                        ascii.len() as f32,
                        layer.reveal_progress.unwrap_or(1.0).clamp(0.0, 1.0) as f32,
                    ],
                    text_data,
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
                let restore_lut_view =
                    restore_lut_texture.create_view(&wgpu::TextureViewDescriptor::default());
                let mask_entry = layer
                    .mask_texture_id
                    .and_then(|id| self.textures.get(&id))
                    .or_else(|| self.textures.get(&0))
                    .ok_or_else(|| "identity mask texture not found".to_string())?;
                let mask_view = mask_entry
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
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::TextureView(&lut_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                    wgpu::BindGroupEntry {
                        binding: 5,
                        resource: wgpu::BindingResource::TextureView(&mask_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 6,
                        resource: wgpu::BindingResource::TextureView(&restore_lut_view),
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
            #[cfg(target_os = "windows")]
            if _present_output {
                let transitions = [wgpu::wgt::TextureTransition {
                    texture: output_tex,
                    selector: None,
                    state: wgpu::wgt::TextureUses::PRESENT,
                }];
                encoder.transition_resources(std::iter::empty(), transitions.into_iter());
            }
            let submission_index = self.queue.submit(Some(encoder.finish()));
            let poll_type = if _present_output {
                // Bound native-preview work to one submitted frame. Waiting without an index
                // also includes concurrent LUT thumbnail submissions on the shared device,
                // while a non-blocking poll lets per-frame resources accumulate until OOM.
                wgpu::PollType::Wait {
                    submission_index: Some(submission_index),
                    timeout: None,
                }
            } else {
                wgpu::PollType::Wait {
                    submission_index: None,
                    timeout: None,
                }
            };
            self.device
                .poll(poll_type)
                .map_err(|e| format!("GPU render poll: {}", e))?;
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
}
