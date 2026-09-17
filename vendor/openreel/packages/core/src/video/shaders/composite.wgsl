/**
 * Composite Shader - Multi-layer rendering with alpha blending
 * 
 * Implements vertex shader for full-screen quad and fragment shader
 * with texture sampling and alpha blending for layer compositing.
 * 
 */

// Vertex shader output / Fragment shader input
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) texCoord: vec2<f32>,
};

// Layer uniforms for compositing
struct LayerUniforms {
    opacity: f32,
    padding: vec3<f32>,
};

// Bind group 0: Layer uniforms
@group(0) @binding(0) var<uniform> layer: LayerUniforms;

// Bind group 1: Texture and sampler
@group(1) @binding(0) var textureSampler: sampler;
@group(1) @binding(1) var layerTexture: texture_2d<f32>;

/**
 * Vertex shader for full-screen quad
 * 
 * Uses vertex index to generate a full-screen triangle that covers
 * the entire viewport. This is more efficient than using a quad
 * with 4 vertices and 2 triangles.
 */
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Generate full-screen triangle vertices
    // Vertex 0: (-1, -1), Vertex 1: (3, -1), Vertex 2: (-1, 3)
    // This creates a triangle that covers the entire screen
    let x = f32(i32(vertexIndex & 1u) * 4 - 1);
    let y = f32(i32(vertexIndex >> 1u) * 4 - 1);
    
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    
    // Calculate texture coordinates (0,0 to 1,1)
    // Flip Y coordinate for correct texture orientation
    output.texCoord = vec2<f32>(
        (x + 1.0) * 0.5,
        (1.0 - y) * 0.5
    );
    
    return output;
}

/**
 * Fragment shader with texture sampling and alpha blending
 * 
 * Samples the layer texture and applies opacity for compositing.
 * Alpha blending is handled by the GPU pipeline blend state.
 */
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample the texture
    let texColor = textureSample(layerTexture, textureSampler, input.texCoord);
    
    // Apply layer opacity
    let finalColor = vec4<f32>(
        texColor.rgb,
        texColor.a * layer.opacity
    );
    
    return finalColor;
}
