struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct JfaStepUniforms {
    resolution: vec2f,
    step_size: f32,
    _padding: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: JfaStepUniforms;

fn decode_seed(encoded: vec4f) -> vec2f {
    let x = floor(encoded.r * 255.0 + 0.5) * 256.0 + floor(encoded.g * 255.0 + 0.5);
    let y = floor(encoded.b * 255.0 + 0.5) * 256.0 + floor(encoded.a * 255.0 + 0.5);
    return vec2f(x, y);
}

fn encode_seed(seed: vec2f) -> vec4f {
    let x_hi = floor(seed.x / 256.0);
    let x_lo = seed.x - (x_hi * 256.0);
    let y_hi = floor(seed.y / 256.0);
    let y_lo = seed.y - (y_hi * 256.0);
    return vec4f(x_hi / 255.0, x_lo / 255.0, y_hi / 255.0, y_lo / 255.0);
}

fn is_no_seed(encoded: vec4f) -> bool {
    return encoded.r > 0.99 && encoded.g > 0.99 && encoded.b > 0.99 && encoded.a > 0.99;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let pixel_coord = floor(input.tex_coord * uniforms.resolution);
    let texel_size = vec2f(1.0, 1.0) / uniforms.resolution;

    var best_distance = 10000000000.0;
    var best_seed = vec2f(65535.0, 65535.0);

    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let offset = vec2f(f32(x), f32(y)) * uniforms.step_size;
            let sample_uv = input.tex_coord + (offset * texel_size);

            if (
                sample_uv.x < 0.0 ||
                sample_uv.x > 1.0 ||
                sample_uv.y < 0.0 ||
                sample_uv.y > 1.0
            ) {
                continue;
            }

            let encoded = textureSampleLevel(input_texture, input_sampler, sample_uv, 0.0);
            if (is_no_seed(encoded)) {
                continue;
            }

            let seed = decode_seed(encoded);
            let distance_to_seed = distance(pixel_coord, seed);
            if (distance_to_seed < best_distance) {
                best_distance = distance_to_seed;
                best_seed = seed;
            }
        }
    }

    if (best_distance < 1000000000.0) {
        return encode_seed(best_seed);
    }

    return vec4f(1.0, 1.0, 1.0, 1.0);
}
