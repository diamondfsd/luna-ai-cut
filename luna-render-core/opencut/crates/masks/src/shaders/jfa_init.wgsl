struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct JfaInitUniforms {
    resolution: vec2f,
    invert: f32,
    _padding: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: JfaInitUniforms;

fn encode_seed(seed: vec2f) -> vec4f {
    let x_hi = floor(seed.x / 256.0);
    let x_lo = seed.x - (x_hi * 256.0);
    let y_hi = floor(seed.y / 256.0);
    let y_lo = seed.y - (y_hi * 256.0);
    return vec4f(x_hi / 255.0, x_lo / 255.0, y_hi / 255.0, y_lo / 255.0);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let mask = textureSample(input_texture, input_sampler, input.tex_coord).r;
    let above = mask > 0.5;
    let below = mask < 0.5;
    let inverted = uniforms.invert > 0.5;
    let is_seed = select(above, below, inverted);

    if (is_seed) {
        let pixel_coord = floor(input.tex_coord * uniforms.resolution);
        return encode_seed(pixel_coord);
    }

    return vec4f(1.0, 1.0, 1.0, 1.0);
}
