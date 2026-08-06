struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct DistanceUniforms {
    resolution: vec2f,
    feather_half: f32,
    _padding: f32,
}

@group(0) @binding(0) var inside_texture: texture_2d<f32>;
@group(0) @binding(1) var inside_sampler: sampler;
@group(1) @binding(0) var outside_texture: texture_2d<f32>;
@group(1) @binding(1) var outside_sampler: sampler;
@group(2) @binding(0) var<uniform> uniforms: DistanceUniforms;

fn decode_seed(encoded: vec4f) -> vec2f {
    let x = floor(encoded.r * 255.0 + 0.5) * 256.0 + floor(encoded.g * 255.0 + 0.5);
    let y = floor(encoded.b * 255.0 + 0.5) * 256.0 + floor(encoded.a * 255.0 + 0.5);
    return vec2f(x, y);
}

fn is_no_seed(encoded: vec4f) -> bool {
    return encoded.r > 0.99 && encoded.g > 0.99 && encoded.b > 0.99 && encoded.a > 0.99;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let pixel_coord = floor(input.tex_coord * uniforms.resolution);
    let inside_encoded = textureSample(inside_texture, inside_sampler, input.tex_coord);
    let outside_encoded = textureSample(outside_texture, outside_sampler, input.tex_coord);

    let has_inside = !is_no_seed(inside_encoded);
    let has_outside = !is_no_seed(outside_encoded);
    let distance_to_inside = select(
        100000.0,
        distance(pixel_coord, decode_seed(inside_encoded)),
        has_inside,
    );
    let distance_to_outside = select(
        100000.0,
        distance(pixel_coord, decode_seed(outside_encoded)),
        has_outside,
    );
    let signed_distance = distance_to_outside - distance_to_inside;
    let alpha = smoothstep(-uniforms.feather_half, uniforms.feather_half, signed_distance);

    return vec4f(alpha, alpha, alpha, alpha);
}
