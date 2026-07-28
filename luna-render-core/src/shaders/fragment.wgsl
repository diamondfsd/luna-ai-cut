fn glyph_bits(input_code: u32) -> u32 {
    var code = input_code;
    if (code >= 97u && code <= 122u) { code = code - 32u; }
    switch code {
        case 48u: { return 31599u; } case 49u: { return 29850u; } case 50u: { return 29667u; }
        case 51u: { return 14563u; } case 52u: { return 18925u; } case 53u: { return 14543u; }
        case 54u: { return 31694u; } case 55u: { return 9383u; } case 56u: { return 31727u; }
        case 57u: { return 14831u; } case 65u: { return 23530u; } case 66u: { return 15083u; }
        case 67u: { return 25166u; } case 68u: { return 15211u; } case 69u: { return 29391u; }
        case 70u: { return 4815u; } case 71u: { return 27470u; } case 72u: { return 23533u; }
        case 73u: { return 29847u; } case 74u: { return 11044u; } case 75u: { return 23277u; }
        case 76u: { return 29257u; } case 77u: { return 23549u; } case 78u: { return 24573u; }
        case 79u: { return 11114u; } case 80u: { return 4843u; } case 81u: { return 28522u; }
        case 82u: { return 23275u; } case 83u: { return 14478u; } case 84u: { return 9367u; }
        case 85u: { return 31597u; } case 86u: { return 11117u; } case 87u: { return 24557u; }
        case 88u: { return 23213u; } case 89u: { return 9389u; } case 90u: { return 29351u; }
        case 45u: { return 448u; } case 46u: { return 8192u; } case 47u: { return 4772u; }
        case 58u: { return 1040u; } case 63u: { return 8355u; }
        default: { return 8355u; }
    }
}

fn sample_media_texture(tex_coord: vec2<f32>) -> vec4<f32> {
    if (params.sampling_quality < 0.5) {
        return textureSample(src_texture, src_sampler, tex_coord);
    }

    // A positioned logo can shrink to a small fraction of its source size.
    // Average across the destination pixel footprint to avoid aliasing thin strokes.
    let footprint = max(abs(dpdx(tex_coord)), abs(dpdy(tex_coord)));
    let texel = vec2<f32>(params.texel_x, params.texel_y);
    if (max(footprint.x / texel.x, footprint.y / texel.y) < 1.5) {
        return textureSample(src_texture, src_sampler, tex_coord);
    }

    var premultiplied = vec3<f32>(0.0);
    var alpha = 0.0;
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let offset = vec2<f32>(f32(x), f32(y)) * footprint / 3.0;
            let sample = textureSample(src_texture, src_sampler, tex_coord + offset);
            premultiplied += sample.rgb * sample.a;
            alpha += sample.a;
        }
    }
    let averaged_alpha = alpha / 9.0;
    var straight_rgb = vec3<f32>(0.0);
    if (alpha > 0.0001) {
        straight_rgb = premultiplied / alpha;
    }
    return vec4<f32>(straight_rgb, averaged_alpha);
}

// 基于目标矩形的实际像素计算等半径圆角，避免宽高比将圆弧拉成椭圆。
fn rounded_rect_distance(local: vec2<f32>, radius_normalized: f32) -> f32 {
    let size = vec2<f32>(max(params.dst_w, 1.0), max(params.dst_h, 1.0));
    let radius_px = clamp(radius_normalized * min(size.x, size.y), 0.0, min(size.x, size.y) * 0.5);
    let q = abs(local - vec2<f32>(0.5)) * size - (size * 0.5 - vec2<f32>(radius_px));
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - radius_px;
}

fn rounded_box_distance(position: vec2<f32>, size: vec2<f32>, radius: f32) -> f32 {
    let safe_radius = clamp(radius, 0.0, min(size.x, size.y) * 0.5);
    let q = abs(position) - (size * 0.5 - vec2<f32>(safe_radius));
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - safe_radius;
}

fn sample_effective_color_mask(tex_coord: vec2<f32>) -> f32 {
    let value = textureSample(mask_texture, src_sampler, tex_coord).r;
    return select(value, 1.0 - value, params.mask_params.y > 0.5);
}

fn sample_pixel_stretch_mask(tex_coord: vec2<f32>) -> f32 {
    let value = textureSampleLevel(mask_texture, src_sampler, tex_coord, 0.0).r;
    return select(value, 1.0 - value, params.mask_params.y > 0.5);
}

fn s_curve_point(t: f32, origin_x: f32, amplitude: f32, aspect: f32) -> vec2<f32> {
    let y = mix(-0.12, 1.12, t);
    let x = origin_x - amplitude * sin(t * 6.28318530718);
    return vec2<f32>((x - origin_x) * aspect, y);
}

fn flow_path_control(index: i32) -> vec2<f32> {
    let scalar_index = index * 2;
    let first = scalar_index / 4;
    let offset = scalar_index % 4;
    if (offset == 0) {
        return params.pixel_stretch_path_data[first].xy;
    }
    return params.pixel_stretch_path_data[first].zw;
}

fn cubic_flow_path(t: f32) -> vec2<f32> {
    let segment = select(0, 1, t >= 0.5);
    let local_t = select(t * 2.0, (t - 0.5) * 2.0, segment == 1);
    let base = segment * 3;
    let p0 = flow_path_control(base);
    let p1 = flow_path_control(base + 1);
    let p2 = flow_path_control(base + 2);
    let p3 = flow_path_control(base + 3);
    let inverse_t = 1.0 - local_t;
    return inverse_t * inverse_t * inverse_t * p0
        + 3.0 * inverse_t * inverse_t * local_t * p1
        + 3.0 * inverse_t * local_t * local_t * p2
        + local_t * local_t * local_t * p3;
}

fn cubic_flow_path_derivative(t: f32) -> vec2<f32> {
    let segment = select(0, 1, t >= 0.5);
    let local_t = select(t * 2.0, (t - 0.5) * 2.0, segment == 1);
    let base = segment * 3;
    let p0 = flow_path_control(base);
    let p1 = flow_path_control(base + 1);
    let p2 = flow_path_control(base + 2);
    let p3 = flow_path_control(base + 3);
    let inverse_t = 1.0 - local_t;
    return 6.0 * (inverse_t * inverse_t * (p1 - p0)
        + 2.0 * inverse_t * local_t * (p2 - p1)
        + local_t * local_t * (p3 - p2));
}

fn cubic_flow_path_second_derivative(t: f32) -> vec2<f32> {
    let segment = select(0, 1, t >= 0.5);
    let local_t = select(t * 2.0, (t - 0.5) * 2.0, segment == 1);
    let base = segment * 3;
    let p0 = flow_path_control(base);
    let p1 = flow_path_control(base + 1);
    let p2 = flow_path_control(base + 2);
    let p3 = flow_path_control(base + 3);
    return 24.0 * (mix(p2 - 2.0 * p1 + p0, p3 - 2.0 * p2 + p1, local_t));
}

fn pixel_stretch_sample_seed(range_t: f32, horizontal: bool) -> vec2<f32> {
    let inverse_t = 1.0 - range_t;
    let start = select(params.pixel_stretch.w, params.pixel_stretch.z, horizontal);
    let along = inverse_t * inverse_t * inverse_t * start
        + 3.0 * inverse_t * inverse_t * range_t * params.pixel_stretch_center.z
        + 3.0 * inverse_t * range_t * range_t * params.pixel_stretch_center.w
        + range_t * range_t * range_t * params.pixel_stretch_extra.y;
    let across = mix(params.pixel_stretch_extra.z, params.pixel_stretch_extra.w, range_t);
    return select(vec2<f32>(across, along), vec2<f32>(along, across), horizontal);
}

fn valid_pixel_stretch_seed(seed: vec2<f32>) -> bool {
    return seed.x >= 0.0 && seed.x <= 1.0 && seed.y >= 0.0 && seed.y <= 1.0
        && sample_pixel_stretch_mask(seed) >= 0.5;
}

fn sample_color_mask(tex_coord: vec2<f32>) -> f32 {
    let dimensions = vec2<f32>(textureDimensions(mask_texture));
    let translated = (tex_coord - vec2<f32>(0.5) - params.mask_transform.xy) * dimensions;
    let angle = params.mask_transform.w;
    let cosine = cos(angle);
    let sine = sin(angle);
    let unrotated = vec2<f32>(
        cosine * translated.x + sine * translated.y,
        -sine * translated.x + cosine * translated.y,
    );
    let mask_coord = unrotated / max(params.mask_transform.z, 0.0001) / dimensions + vec2<f32>(0.5);
    if (mask_coord.x < 0.0 || mask_coord.x > 1.0 || mask_coord.y < 0.0 || mask_coord.y > 1.0) {
        return 0.0;
    }
    let mask_sample = textureSample(mask_texture, src_sampler, mask_coord);
    let inverted = params.mask_params.y > 0.5;
    let original = select(mask_sample.r, 1.0 - mask_sample.r, inverted);
    let feather_px = params.mask_params.z;
    if (feather_px < 0.5) {
        return original;
    }
    let encoded_distance = select(mask_sample.g, mask_sample.b, inverted);
    let distance_px = encoded_distance * 100.0;
    let outward_transition = 1.0 - smoothstep(0.0, feather_px, distance_px);
    return max(original, outward_transition);
}

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

    var corner_coverage = 1.0;
    if (params.procedural.x < 0.5 && params.procedural.z > 0.0) {
        let p = vec2<f32>(local_x, local_y);
        let corner_distance = rounded_rect_distance(p, params.procedural.z);
        let corner_aa = max(fwidth(corner_distance) * 1.5, 1.5);
        if (corner_distance > corner_aa) {
            discard;
        }
        corner_coverage = 1.0 - smoothstep(-corner_aa, corner_aa, corner_distance);
    }

    if (params.procedural.x < 0.5 && local_x > params.text_meta.w) {
        discard;
    }

    if (params.procedural.x > 0.5 && params.procedural.x < 1.5) {
        let p = vec2<f32>(local_x, local_y);
        let shape_kind = params.procedural.y;
        let radius = max(params.procedural.z, 0.0);
        var inside = true;
        var signed_distance = -1.0;
        if (shape_kind > 2.5) {
            let d = (p - vec2<f32>(0.5)) / vec2<f32>(0.5);
            signed_distance = length(d) - 1.0;
            inside = signed_distance <= 0.0;
        } else if (shape_kind > 0.5 && radius > 0.0) {
            signed_distance = rounded_rect_distance(p, radius);
            inside = signed_distance <= 0.0;
        }
        if (!inside) { discard; }
        let stroke_px = params.procedural.w;
        if (stroke_px > 0.0 && params.stroke_rgba.a > 0.0) {
            let edge_px = min(min(local_x * params.dst_w, (1.0 - local_x) * params.dst_w), min(local_y * params.dst_h, (1.0 - local_y) * params.dst_h));
            if (edge_px <= stroke_px) {
                let stroke_alpha = params.stroke_rgba.a * params.opacity;
                return vec4<f32>(params.stroke_rgba.rgb * stroke_alpha, stroke_alpha);
            }
        }
        let feather = max(-params.procedural.w, 0.0) * min(params.dst_w, params.dst_h);
        var feather_alpha = 1.0;
        if (feather > 0.0) {
            let outer_size = vec2<f32>(params.dst_w, params.dst_h);
            let inner_size = max(outer_size - vec2<f32>(feather * 2.0), vec2<f32>(1.0));
            let outer_radius = radius * min(outer_size.x, outer_size.y);
            let inner_radius = max(outer_radius - feather, 0.0);
            let position = (p - vec2<f32>(0.5)) * outer_size;
            let distance_from_card = max(rounded_box_distance(position, inner_size, inner_radius), 0.0);
            let normalized_distance = distance_from_card / max(feather, 0.0001);
            // 使用连续的 logistic 曲线向外衰减，并将边缘归一化到满密度；
            // 阴影强度滑块可以真正达到黑色，外侧仍保持柔和过渡。
            feather_alpha = min(1.0, 2.0 / (1.0 + exp(4.5 * normalized_distance)));
        }
        let fill_alpha = params.fill_rgba.a * params.opacity * feather_alpha;
        return vec4<f32>(params.fill_rgba.rgb * fill_alpha, fill_alpha);
    }

    if (params.procedural.x > 2.5) {
        let glyph_color = textureSample(src_texture, src_sampler, vec2<f32>(local_x, local_y));
        return vec4<f32>(glyph_color.rgb * params.opacity, glyph_color.a * params.opacity);
    }

    if (params.procedural.x > 1.5) {
        let char_count = u32(params.text_meta.z);
        if (char_count == 0u) { discard; }
        let glyph_h = max(params.text_meta.x, 5.0);
        let glyph_w = glyph_h * 0.72;
        let spacing = glyph_w * 0.18;
        let total_w = f32(char_count) * (glyph_w + spacing) - spacing;
        var origin_x = params.dst_x + 2.0;
        if (params.text_meta.y > 1.5) { origin_x = params.dst_x + params.dst_w - total_w - 2.0; }
        else if (params.text_meta.y > 0.5) { origin_x = params.dst_x + (params.dst_w - total_w) * 0.5; }
        var origin_y = params.dst_y + (params.dst_h - glyph_h) * 0.5;
        if (params.procedural.y < 0.5) { origin_y = params.dst_y + 2.0; }
        else if (params.procedural.y > 1.5) { origin_y = params.dst_y + params.dst_h - glyph_h - 2.0; }
        let tx = pixel_x - origin_x;
        let ty = pixel_y - origin_y;
        if (tx < 0.0 || ty < 0.0 || ty >= glyph_h) { discard; }
        let char_index = u32(floor(tx / (glyph_w + spacing)));
        if (char_index >= char_count) { discard; }
        let within_x = tx - f32(char_index) * (glyph_w + spacing);
        if (within_x >= glyph_w) { discard; }
        let packed_index = char_index / 4u;
        let component = char_index % 4u;
        let packed = params.text_data[packed_index];
        var code = packed.x;
        if (component == 1u) { code = packed.y; } else if (component == 2u) { code = packed.z; } else if (component == 3u) { code = packed.w; }
        // GPU 原生点阵字形：稳定覆盖 ASCII，非 ASCII 使用可见占位符。
        let col = u32(clamp(floor(within_x / glyph_w * 3.0), 0.0, 2.0));
        let row = u32(clamp(floor(ty / glyph_h * 5.0), 0.0, 4.0));
        let bits = glyph_bits(u32(code));
        let ink = ((bits >> (row * 3u + col)) & 1u) == 1u;
        if (!ink || u32(code) == 32u) { discard; }
        let text_alpha = params.fill_rgba.a * params.opacity;
        return vec4<f32>(params.fill_rgba.rgb * text_alpha, text_alpha);
    }
    let frame_uv = vec2<f32>(
        params.crop_x + local_x * params.crop_w,
        params.crop_y + local_y * params.crop_h,
    );
    var centered = (frame_uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(
        max(params.frame_w, 0.0001),
        max(params.frame_h, 0.0001),
    );
    centered = centered / max(params.scale, 0.0001) - vec2<f32>(params.translate_x, params.translate_y);
    let radians_value = (params.orientation + params.rotate) * 0.017453292519943295;
    let s = sin(radians_value);
    let c = cos(radians_value);
    centered = vec2<f32>(
        centered.x * c + centered.y * s,
        -centered.x * s + centered.y * c,
    );
    if (params.flip_h > 0.5) {
        centered.x = -centered.x;
    }
    if (params.flip_v > 0.5) {
        centered.y = -centered.y;
    }
    let source_local = centered / vec2<f32>(max(params.source_aspect, 0.0001), 1.0) + vec2<f32>(0.5, 0.5);
    if (source_local.x < 0.0 || source_local.x > 1.0 || source_local.y < 0.0 || source_local.y > 1.0) {
        discard;
    }
    let tex_coord = vec2<f32>(
        params.src_x + source_local.x * params.src_w,
        params.src_y + source_local.y * params.src_h,
    );

    if (params.pixel_flow.x > 0.5) {
        let source_size = vec2<f32>(textureDimensions(src_texture));
        let cell_px = max(2.0, max(source_size.x, source_size.y) * params.pixel_flow.z / 1000.0);
        let cell_index = floor(tex_coord * source_size / cell_px);
        let cell_uv = clamp((cell_index + vec2<f32>(0.5)) * cell_px / source_size, vec2<f32>(0.0), vec2<f32>(1.0));
        let cell = pixel_flow_cell(cell_uv, cell_index, source_size, cell_px);
        let region_scale = dot(cell.yzw, params.pixel_flow_scale.xyz);
        let band = max(0.006, params.pixel_flow.w / 100.0 * max(0.08, region_scale));
        let transition_ratio = clamp(params.pixel_flow_finish.z / max(params.pixel_flow_depth.y, 0.1), 0.0, 0.6);
        let flow_end = max(0.4, 1.0 - transition_ratio);
        let flow_time = clamp(params.pixel_flow.y / flow_end, 0.0, 1.0);
        let accelerated = flow_time * flow_time;
        let progress = accelerated * (1.04 + band * 3.4);
        let distance = cell.x - progress;
        let frame_edge = max(abs(cell_uv.x - 0.5) * 2.0, abs(cell_uv.y - 0.5) * 2.0);
        let edge_hold = smoothstep(0.76, 0.98, frame_edge);
        let pulse = pixel_flow_light(distance, band, cell.w, edge_hold);

        let source = sample_media_texture(tex_coord);
        let filter_strength = params.pixel_flow_finish.y;
        let adjusted = pixel_flow_hertz_grade(apply_color(source.rgb, tex_coord, local_x), filter_strength);
        let gray_value = dot(adjusted, vec3<f32>(0.2126, 0.7152, 0.0722));
        let monochrome = vec3<f32>(clamp((gray_value - 0.5) * 1.08 + 0.52, 0.0, 1.0));
        let arrival_time = sqrt(max(0.0, cell.x) / max(1.04, 1.04 + band * 3.4)) * flow_end;
        let reveal = smoothstep(arrival_time, arrival_time + max(0.001, transition_ratio), params.pixel_flow.y);
        let base = mix(monochrome, adjusted, reveal);

        let block_source = textureSampleLevel(src_texture, src_sampler, cell_uv, 0.0).rgb;
        let block_adjusted = pixel_flow_hertz_grade(apply_color(block_source, cell_uv, local_x), filter_strength);
        let maximum = max(block_adjusted.r, max(block_adjusted.g, block_adjusted.b));
        let minimum = min(block_adjusted.r, min(block_adjusted.g, block_adjusted.b));
        let center = (maximum + minimum) * 0.5;
        let color_gate = smoothstep(0.055, 0.14, maximum);
        let saturated = clamp(vec3<f32>(center) + (block_adjusted - vec3<f32>(center)) * 2.08, vec3<f32>(0.0), vec3<f32>(1.0));
        let highlight = mix(saturated, vec3<f32>(1.0), 0.34);
        let depth_light = cell.y * 1.22 + cell.z * 1.52 + cell.w * 1.88;
        let block_local = abs(fract(tex_coord * source_size / cell_px) - vec2<f32>(0.5));
        let block_distance = max(block_local.x, block_local.y);
        let block_core = 1.0 - smoothstep(0.34, 0.42, block_distance);
        let outer_glow = 1.0 - smoothstep(0.37, 0.5, block_distance);
        let contrast_noise = pixel_flow_hash(cell_index * vec2<f32>(5.37, 3.11) + vec2<f32>(71.0, 29.0));
        let bright_group = step(0.5, contrast_noise);
        let emission_gain = mix(0.28, 1.38, bright_group);
        let dim_amount = (1.0 - bright_group) * pulse * color_gate * 0.24;
        let contrasted_base = base * (1.0 - dim_amount);
        let glow = pulse * depth_light * color_gate;
        let source_luma = max(gray_value, dot(block_adjusted, vec3<f32>(0.2126, 0.7152, 0.0722)));
        let highlight_weight = smoothstep(0.24, 0.78, source_luma);
        let bloom_strength = params.pixel_flow_finish.x;
        let underlight_pulse = pixel_flow_light(distance, band * 3.2, cell.w, edge_hold);
        let underlight = underlight_pulse * color_gate * mix(0.14, 1.35, bloom_strength) * mix(0.38, 1.35, highlight_weight);
        let underlight_color = mix(saturated, vec3<f32>(1.0), 0.22 + highlight_weight * 0.38);
        let exposed_base = contrasted_base * (1.0 + underlight * (0.52 + highlight_weight * 0.72));
        let bloom_radius = vec2<f32>(cell_px) / source_size * mix(0.75, 1.8, bloom_strength);
        let ccd_bloom = pixel_flow_hertz_grade(pixel_flow_ccd_bloom(tex_coord, bloom_radius), filter_strength);
        let ccd_light = ccd_bloom * underlight_pulse * bloom_strength * color_gate * 1.75;
        let lit = exposed_base
            + saturated * underlight * 0.62
            + underlight_color * underlight * highlight_weight * 1.05
            + ccd_light
            + saturated * glow * emission_gain * (outer_glow * 0.62 + block_core * 1.18)
            + highlight * glow * emission_gain * block_core * 0.72;
        let layer_alpha = source.a * params.opacity * corner_coverage;
        return vec4<f32>(clamp(lit, vec3<f32>(0.0), vec3<f32>(1.35)) * layer_alpha, layer_alpha);
    }

    if (params.pixel_stretch.x > 0.5) {
        let stretch_mode = params.pixel_stretch.x;
        let is_s_curve = stretch_mode > 2.5 && stretch_mode < 4.5;
        if (!is_s_curve && sample_pixel_stretch_mask(tex_coord) > 0.5) {
            discard;
        }
        let amount = clamp(params.pixel_stretch.y / 100.0, 0.0, 1.0);
        let max_travel = 2.0;
        let origin = vec2<f32>(params.pixel_stretch.z, params.pixel_stretch.w);
        let aspect = max(params.source_aspect, 0.0001);
        let center = params.pixel_stretch_center.xy;
        let rotation = radians(params.pixel_stretch_extra.x);
        let rotation_cos = cos(rotation);
        let rotation_sin = sin(rotation);
        let rotated_delta = (tex_coord - center) * vec2<f32>(aspect, 1.0);
        let unrotated_delta = vec2<f32>(
            rotated_delta.x * rotation_cos + rotated_delta.y * rotation_sin,
            -rotated_delta.x * rotation_sin + rotated_delta.y * rotation_cos,
        );
        let effect_coord = center + unrotated_delta / vec2<f32>(aspect, 1.0);
        let line_end = params.pixel_stretch_extra.y;
        let control_start = params.pixel_stretch_center.z;
        let control_end = params.pixel_stretch_center.w;
        let sample_start = params.pixel_stretch_extra.z;
        let sample_end = params.pixel_stretch_extra.w;
        var seed = vec2<f32>(origin.x, tex_coord.y);
        var sample_range_t = 0.5;
        var edge_coverage = 1.0;
        let is_horizontal = stretch_mode < 1.5 || (stretch_mode > 4.5 && stretch_mode < 5.5) || (stretch_mode > 6.5 && stretch_mode < 7.5);
        let is_vertical = (stretch_mode > 1.5 && stretch_mode < 2.5) || (stretch_mode > 5.5 && stretch_mode < 6.5) || stretch_mode > 7.5;
        if (params.pixel_stretch_path_meta.x > 0.5) {
            let position = effect_coord * vec2<f32>(aspect, 1.0);
            var best_t = 0.0;
            var best_point = cubic_flow_path(0.0) * vec2<f32>(aspect, 1.0);
            var best_distance = dot(position - best_point, position - best_point);
            for (var index = 1; index < 32; index = index + 1) {
                let path_t = f32(index) / 31.0;
                let point_uv = cubic_flow_path(path_t);
                let point = point_uv * vec2<f32>(aspect, 1.0);
                let distance = dot(position - point, position - point);
                if (distance < best_distance) {
                    best_t = path_t;
                    best_point = point;
                    best_distance = distance;
                }
            }
            let coarse_step = 1.0 / 31.0;
            let refine_start = max(0.0, best_t - coarse_step);
            let refine_end = min(1.0, best_t + coarse_step);
            for (var index = 0; index < 6; index = index + 1) {
                let point_uv = cubic_flow_path(best_t);
                let point = point_uv * vec2<f32>(aspect, 1.0);
                let derivative = cubic_flow_path_derivative(best_t) * vec2<f32>(aspect, 1.0);
                let second_derivative = cubic_flow_path_second_derivative(best_t) * vec2<f32>(aspect, 1.0);
                let delta = point - position;
                let denominator = dot(derivative, derivative) + dot(delta, second_derivative);
                if (abs(denominator) > 0.0000001) {
                    best_t = clamp(best_t - dot(delta, derivative) / denominator, refine_start, refine_end);
                }
            }
            best_point = cubic_flow_path(best_t) * vec2<f32>(aspect, 1.0);
            let path_start = cubic_flow_path(0.0) * vec2<f32>(aspect, 1.0);
            let path_start_delta = cubic_flow_path_derivative(0.0) * vec2<f32>(aspect, 1.0);
            let path_start_fallback = (cubic_flow_path(0.01) - cubic_flow_path(0.0)) * vec2<f32>(aspect, 1.0);
            let path_start_length = max(length(path_start_delta), 0.000001);
            let path_start_fallback_length = max(length(path_start_fallback), 0.000001);
            let path_start_tangent = select(path_start_fallback / path_start_fallback_length, path_start_delta / path_start_length, dot(path_start_delta, path_start_delta) > 0.0000001);
            let path_end = cubic_flow_path(1.0) * vec2<f32>(aspect, 1.0);
            let path_end_delta = cubic_flow_path_derivative(1.0) * vec2<f32>(aspect, 1.0);
            let path_end_fallback = (cubic_flow_path(1.0) - cubic_flow_path(0.99)) * vec2<f32>(aspect, 1.0);
            let path_end_length = max(length(path_end_delta), 0.000001);
            let path_end_fallback_length = max(length(path_end_fallback), 0.000001);
            let path_end_tangent = select(path_end_fallback / path_end_fallback_length, path_end_delta / path_end_length, dot(path_end_delta, path_end_delta) > 0.0000001);
            if (dot(position - path_start, path_start_tangent) < 0.0) {
                best_t = 0.0;
                best_point = path_start;
            } else if (dot(position - path_end, path_end_tangent) > 0.0) {
                best_t = 1.0;
                best_point = path_end;
            }
            let tangent_delta = cubic_flow_path_derivative(best_t) * vec2<f32>(aspect, 1.0);
            if (dot(tangent_delta, tangent_delta) < 0.0000001) {
                discard;
            }
            let tangent = normalize(tangent_delta);
            let normal = vec2<f32>(-tangent.y, tangent.x);
            let signed_distance = dot(position - best_point, normal);
            let full_width = mix(params.pixel_stretch_path_meta.y, params.pixel_stretch_path_meta.z, best_t);
            let half_width = max(0.0005, full_width * 0.5);
            var distance_from_centerline = abs(signed_distance);
            if ((best_t <= 0.00001 && dot(position - best_point, tangent) < 0.0)
                || (best_t >= 0.99999 && dot(position - best_point, tangent) > 0.0)) {
                distance_from_centerline = length(position - best_point);
            }
            let edge_distance = half_width - distance_from_centerline;
            let edge_aa = max(fwidth(edge_distance), 0.00001);
            if (edge_distance < -edge_aa) {
                discard;
            }
            edge_coverage = smoothstep(-edge_aa, edge_aa, edge_distance);
            sample_range_t = clamp(signed_distance / full_width + 0.5, 0.0, 1.0);
            seed = pixel_stretch_sample_seed(sample_range_t, is_horizontal);
        } else if (is_horizontal) {
            let range_min = min(sample_start, sample_end);
            let range_max = max(sample_start, sample_end);
            let cross_distance = min(effect_coord.y - range_min, range_max - effect_coord.y);
            let cross_aa = max(fwidth(effect_coord.y), 0.00001);
            if (cross_distance < -cross_aa) {
                discard;
            }
            edge_coverage = smoothstep(-cross_aa, cross_aa, cross_distance);
            let range_delta = sample_end - sample_start;
            let safe_range_delta = select(min(range_delta, -0.0001), max(range_delta, 0.0001), range_delta >= 0.0);
            sample_range_t = clamp((effect_coord.y - sample_start) / safe_range_delta, 0.0, 1.0);
            seed = pixel_stretch_sample_seed(sample_range_t, true);
            let sample_x = seed.x;
            var direction_distance = max_travel - abs(effect_coord.x - sample_x);
            if (stretch_mode < 1.5) {
                direction_distance = min(direction_distance, effect_coord.x - sample_x);
            } else if (stretch_mode > 4.5 && stretch_mode < 5.5) {
                direction_distance = min(direction_distance, sample_x - effect_coord.x);
            }
            let direction_aa = max(fwidth(direction_distance), 0.00001);
            if (direction_distance < -direction_aa) {
                discard;
            }
            edge_coverage *= smoothstep(-direction_aa, direction_aa, direction_distance);
        } else if (is_vertical) {
            let range_min = min(sample_start, sample_end);
            let range_max = max(sample_start, sample_end);
            let cross_distance = min(effect_coord.x - range_min, range_max - effect_coord.x);
            let cross_aa = max(fwidth(effect_coord.x), 0.00001);
            if (cross_distance < -cross_aa) {
                discard;
            }
            edge_coverage = smoothstep(-cross_aa, cross_aa, cross_distance);
            let range_delta = sample_end - sample_start;
            let safe_range_delta = select(min(range_delta, -0.0001), max(range_delta, 0.0001), range_delta >= 0.0);
            sample_range_t = clamp((effect_coord.x - sample_start) / safe_range_delta, 0.0, 1.0);
            seed = pixel_stretch_sample_seed(sample_range_t, false);
            let sample_y = seed.y;
            var direction_distance = max_travel - abs(effect_coord.y - sample_y);
            if (stretch_mode > 1.5 && stretch_mode < 2.5) {
                direction_distance = min(direction_distance, effect_coord.y - sample_y);
            } else if (stretch_mode > 5.5 && stretch_mode < 6.5) {
                direction_distance = min(direction_distance, sample_y - effect_coord.y);
            }
            let direction_aa = max(fwidth(direction_distance), 0.00001);
            if (direction_distance < -direction_aa) {
                discard;
            }
            edge_coverage *= smoothstep(-direction_aa, direction_aa, direction_distance);
        } else {
            let position = vec2<f32>((tex_coord.x - origin.x) * aspect, tex_coord.y);
            let amplitude = mix(0.22, 0.38, amount);
            let half_width = mix(0.055, 0.10, amount);
            var best_t = 0.0;
            var best_point = s_curve_point(0.0, origin.x, amplitude, aspect);
            var best_distance = dot(position - best_point, position - best_point);
            for (var index = 1; index < 64; index = index + 1) {
                let t = f32(index) / 63.0;
                let point = s_curve_point(t, origin.x, amplitude, aspect);
                let distance = dot(position - point, position - point);
                if (distance < best_distance) {
                    best_t = t;
                    best_point = point;
                    best_distance = distance;
                }
            }
            if (best_distance > half_width * half_width || (stretch_mode > 3.5 && best_t < 0.76)) {
                discard;
            }
            let before = s_curve_point(max(0.0, best_t - 0.01), origin.x, amplitude, aspect);
            let after = s_curve_point(min(1.0, best_t + 0.01), origin.x, amplitude, aspect);
            let tangent = normalize(after - before);
            let normal = vec2<f32>(-tangent.y, tangent.x);
            let signed_distance = dot(position - best_point, normal);
            seed = vec2<f32>(origin.x, origin.y + signed_distance / half_width * 0.5);
        }
        var valid_seed = valid_pixel_stretch_seed(seed);
        if (!valid_seed && params.pixel_stretch_path_meta.w > 0.5 && (is_horizontal || is_vertical)) {
            for (var index = 1; index <= 48; index = index + 1) {
                let offset = f32(index) / 48.0;
                let before_t = max(0.0, sample_range_t - offset);
                let before_seed = pixel_stretch_sample_seed(before_t, is_horizontal);
                if (valid_pixel_stretch_seed(before_seed)) {
                    seed = before_seed;
                    valid_seed = true;
                    break;
                }
                let after_t = min(1.0, sample_range_t + offset);
                let after_seed = pixel_stretch_sample_seed(after_t, is_horizontal);
                if (valid_pixel_stretch_seed(after_seed)) {
                    seed = after_seed;
                    valid_seed = true;
                    break;
                }
            }
        }
        if (!valid_seed) {
            discard;
        }
        let source_size = vec2<f32>(textureDimensions(src_texture));
        let seed_pixel = clamp(floor(seed * source_size), vec2<f32>(0.0), source_size - vec2<f32>(1.0));
        let seed_center = (seed_pixel + vec2<f32>(0.5)) / source_size;
        let quarter_turn = round(rotation / 1.57079632679) * 1.57079632679;
        let needs_rotation_filter = abs(rotation - quarter_turn) > 0.0001;
        let stretched_color = textureSampleLevel(src_texture, src_sampler, select(seed_center, seed, needs_rotation_filter), 0.0);
        let stretched_adjusted = apply_color(stretched_color.rgb, seed, local_x);
        let stretched_alpha = stretched_color.a * params.opacity * edge_coverage;
        if (params.sampling_quality > 0.5) {
            return vec4<f32>(stretched_adjusted * stretched_alpha, stretched_alpha);
        }
        return vec4<f32>(stretched_adjusted, stretched_alpha);
    }

    var color = sample_media_texture(tex_coord);
    let adjusted = apply_color(color.rgb, tex_coord, local_x);
    let mask_value = clamp(sample_color_mask(tex_coord) * params.mask_params.x, 0.0, 1.0);
    if (params.mask_params.w > 0.5) {
        let layer_alpha = color.a * params.opacity * mask_value * corner_coverage;
        return vec4<f32>(adjusted * layer_alpha, layer_alpha);
    }
    color = vec4<f32>(mix(color.rgb, adjusted, mask_value), color.a);
    color.a = color.a * params.opacity * corner_coverage;
    color = vec4<f32>(color.rgb * color.a, color.a);
    return color;
}
