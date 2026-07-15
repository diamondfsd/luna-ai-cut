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

    if (params.procedural.x < 0.5 && local_x > params.text_meta.w) {
        discard;
    }

    if (params.procedural.x > 0.5 && params.procedural.x < 1.5) {
        let p = vec2<f32>(local_x, local_y);
        let shape_kind = params.procedural.y;
        let radius = max(params.procedural.z, 0.0);
        var inside = true;
        if (shape_kind > 2.5) {
            let d = (p - vec2<f32>(0.5)) / vec2<f32>(0.5);
            inside = dot(d, d) <= 1.0;
        } else if (shape_kind > 0.5 && radius > 0.0) {
            let q = abs(p - vec2<f32>(0.5)) - (vec2<f32>(0.5) - vec2<f32>(radius));
            inside = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) <= radius;
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
        let fill_alpha = params.fill_rgba.a * params.opacity;
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

    var color = sample_media_texture(tex_coord);
    color = vec4<f32>(apply_color(color.rgb, tex_coord, local_x), color.a);
    color.a = color.a * params.opacity;
    if (params.sampling_quality > 0.5) {
        color = vec4<f32>(color.rgb * color.a, color.a);
    }
    return color;
}
