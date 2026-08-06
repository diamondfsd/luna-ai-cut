struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct BlendUniforms {
    blend_mode: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var base_texture: texture_2d<f32>;
@group(0) @binding(1) var base_sampler: sampler;
@group(1) @binding(0) var layer_texture: texture_2d<f32>;
@group(1) @binding(1) var layer_sampler: sampler;
@group(2) @binding(0) var<uniform> uniforms: BlendUniforms;

fn clamp01(color: vec3f) -> vec3f {
    return clamp(color, vec3f(0.0), vec3f(1.0));
}

fn lum(c: vec3f) -> f32 {
    return dot(c, vec3f(0.3, 0.59, 0.11));
}

fn sat(c: vec3f) -> f32 {
    return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

fn clip_color(c: vec3f) -> vec3f {
    var result = c;
    let l = lum(result);
    let n = min(min(result.r, result.g), result.b);
    let x = max(max(result.r, result.g), result.b);
    if (n < 0.0) {
        result = l + ((result - l) * l) / (l - n);
    }
    if (x > 1.0) {
        result = l + ((result - l) * (1.0 - l)) / (x - l);
    }
    return result;
}

fn set_lum(c: vec3f, l: f32) -> vec3f {
    return clip_color(c + (l - lum(c)));
}

fn set_sat(color: vec3f, target_sat: f32) -> vec3f {
    var result = color;
    let max_value = max(max(result.r, result.g), result.b);
    let min_value = min(min(result.r, result.g), result.b);
    if (max_value <= min_value) {
        return vec3f(0.0);
    }
    let scale = target_sat / (max_value - min_value);
    result = (result - vec3f(min_value)) * scale;
    return result;
}

fn hard_light(base: vec3f, layer: vec3f) -> vec3f {
    let low = 2.0 * base * layer;
    let high = 1.0 - 2.0 * (1.0 - base) * (1.0 - layer);
    return select(low, high, layer >= vec3f(0.5));
}

fn soft_light_channel(base: f32, layer: f32) -> f32 {
    if (layer <= 0.5) {
        return base - (1.0 - 2.0 * layer) * base * (1.0 - base);
    }

    let d = select(
        ((16.0 * base - 12.0) * base + 4.0) * base,
        sqrt(base),
        base > 0.25,
    );
    return base + (2.0 * layer - 1.0) * (d - base);
}

fn soft_light(base: vec3f, layer: vec3f) -> vec3f {
    return vec3f(
        soft_light_channel(base.r, layer.r),
        soft_light_channel(base.g, layer.g),
        soft_light_channel(base.b, layer.b),
    );
}

fn color_dodge(base: vec3f, layer: vec3f) -> vec3f {
    return select(
        min(vec3f(1.0), base / max(vec3f(0.0001), vec3f(1.0) - layer)),
        vec3f(1.0),
        layer >= vec3f(1.0),
    );
}

fn color_burn(base: vec3f, layer: vec3f) -> vec3f {
    return select(
        vec3f(1.0) - min(vec3f(1.0), (vec3f(1.0) - base) / max(vec3f(0.0001), layer)),
        vec3f(0.0),
        layer <= vec3f(0.0),
    );
}

fn blend_rgb(base: vec3f, layer: vec3f, mode: u32) -> vec3f {
    switch mode {
        case 1u { return min(base, layer); }
        case 2u { return base * layer; }
        case 3u { return color_burn(base, layer); }
        case 4u { return max(base, layer); }
        case 5u { return 1.0 - (1.0 - base) * (1.0 - layer); }
        case 6u { return min(vec3f(1.0), base + layer); }
        case 7u { return color_dodge(base, layer); }
        case 8u { return select(
            2.0 * base * layer,
            1.0 - 2.0 * (1.0 - base) * (1.0 - layer),
            base >= vec3f(0.5),
        ); }
        case 9u { return soft_light(base, layer); }
        case 10u { return hard_light(base, layer); }
        case 11u { return abs(base - layer); }
        case 12u { return base + layer - 2.0 * base * layer; }
        case 13u { return set_lum(set_sat(layer, sat(base)), lum(base)); }
        case 14u { return set_lum(set_sat(base, sat(layer)), lum(base)); }
        case 15u { return set_lum(layer, lum(base)); }
        case 16u { return set_lum(base, lum(layer)); }
        default { return layer; }
    }
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureSample(base_texture, base_sampler, input.tex_coord);
    let layer = textureSample(layer_texture, layer_sampler, input.tex_coord);

    let blend_rgb_value = blend_rgb(base.rgb, layer.rgb, uniforms.blend_mode);
    let out_alpha = layer.a + base.a * (1.0 - layer.a);
    let out_rgb =
        ((1.0 - layer.a) * base.rgb) +
        (layer.a * ((1.0 - base.a) * layer.rgb + base.a * blend_rgb_value));

    return vec4f(clamp01(out_rgb), out_alpha);
}
