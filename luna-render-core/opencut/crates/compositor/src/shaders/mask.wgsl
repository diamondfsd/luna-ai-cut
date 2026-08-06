struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct MaskUniforms {
    inverted: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

@group(0) @binding(0) var layer_texture: texture_2d<f32>;
@group(0) @binding(1) var layer_sampler: sampler;
@group(1) @binding(0) var mask_texture: texture_2d<f32>;
@group(1) @binding(1) var mask_sampler: sampler;
@group(2) @binding(0) var<uniform> uniforms: MaskUniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let layer = textureSample(layer_texture, layer_sampler, input.tex_coord);
    let mask = textureSample(mask_texture, mask_sampler, input.tex_coord).a;
    let alpha = select(mask, 1.0 - mask, uniforms.inverted > 0.5);
    return vec4f(layer.rgb, layer.a * alpha);
}
