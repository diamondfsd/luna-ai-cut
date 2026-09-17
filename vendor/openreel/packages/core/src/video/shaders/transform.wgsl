/**
 * Transform Shader - Matrix-based transformations with bilinear filtering
 * 
 * Implements 4x4 transformation matrix support for position, scale, and rotation.
 * Uses bilinear filtering for smooth scaling.
 * 
 * - 3.1: Apply transforms using GPU matrix operations
 * - 3.2: Use bilinear filtering for smooth scaling
 * - 3.3: Maintain image quality without pixelation during rotation
 */

// Vertex shader output / Fragment shader input
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) texCoord: vec2<f32>,
};

// Transform uniforms
struct TransformUniforms {
    // 4x4 transformation matrix (column-major order)
    matrix: mat4x4<f32>,
    // Layer opacity (0-1)
    opacity: f32,
    // Border radius in pixels
    borderRadius: f32,
    // Padding for alignment
    padding: vec2<f32>,
};

// Bind group 0: Transform uniforms
@group(0) @binding(0) var<uniform> transform: TransformUniforms;

// Bind group 1: Texture and sampler
@group(1) @binding(0) var textureSampler: sampler;
@group(1) @binding(1) var layerTexture: texture_2d<f32>;

/**
 * Vertex shader with matrix transformation
 * 
 * Generates a quad and applies the transformation matrix.
 * The quad vertices are transformed in clip space.
 */
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Generate quad vertices (2 triangles, 6 vertices)
    // Triangle 1: 0, 1, 2
    // Triangle 2: 2, 1, 3
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), // Bottom-left
        vec2<f32>(1.0, -1.0),  // Bottom-right
        vec2<f32>(-1.0, 1.0),  // Top-left
        vec2<f32>(-1.0, 1.0),  // Top-left
        vec2<f32>(1.0, -1.0),  // Bottom-right
        vec2<f32>(1.0, 1.0)    // Top-right
    );
    
    var texCoords = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0), // Bottom-left
        vec2<f32>(1.0, 1.0), // Bottom-right
        vec2<f32>(0.0, 0.0), // Top-left
        vec2<f32>(0.0, 0.0), // Top-left
        vec2<f32>(1.0, 1.0), // Bottom-right
        vec2<f32>(1.0, 0.0)  // Top-right
    );
    
    let pos = positions[vertexIndex];
    
    // Apply transformation matrix
    output.position = transform.matrix * vec4<f32>(pos, 0.0, 1.0);
    output.texCoord = texCoords[vertexIndex];
    
    return output;
}

/**
 * Fragment shader with bilinear filtering
 * 
 * The sampler is configured with linear filtering for smooth scaling.
 * This provides bilinear interpolation automatically.
 */
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample texture with bilinear filtering (configured in sampler)
    let texColor = textureSample(layerTexture, textureSampler, input.texCoord);
    
    // Apply opacity
    let finalColor = vec4<f32>(
        texColor.rgb,
        texColor.a * transform.opacity
    );
    
    return finalColor;
}

/**
 * Alternative vertex shader for instanced rendering
 * 
 * Useful when rendering multiple layers with different transforms
 * in a single draw call.
 */
@vertex
fn vertexMainInstanced(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    var output: VertexOutput;
    
    // Same quad generation as vertexMain
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0)
    );
    
    var texCoords = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
    );
    
    let pos = positions[vertexIndex];
    
    // Apply transformation matrix (same for all instances in this simple case)
    // For true instanced rendering, you'd use a storage buffer with per-instance transforms
    output.position = transform.matrix * vec4<f32>(pos, 0.0, 1.0);
    output.texCoord = texCoords[vertexIndex];
    
    return output;
}
