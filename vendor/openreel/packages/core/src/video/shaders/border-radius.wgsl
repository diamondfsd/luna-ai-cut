/**
 * Border Radius Clipping Shader - GPU-based rounded corner clipping
 * 
 * Implements smooth rounded corners using signed distance field (SDF)
 * calculations for anti-aliased edges.
 * 
 */

// Vertex shader output / Fragment shader input
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) texCoord: vec2<f32>,
    @location(1) localPos: vec2<f32>, // Position in local space for SDF calculation
};

// Border radius uniforms
struct BorderRadiusUniforms {
    // 4x4 transformation matrix
    matrix: mat4x4<f32>,
    // Layer opacity
    opacity: f32,
    // Border radius in normalized coordinates (0-0.5)
    radius: f32,
    // Aspect ratio (width / height)
    aspectRatio: f32,
    // Anti-aliasing smoothness
    smoothness: f32,
};

// Bind group 0: Uniforms
@group(0) @binding(0) var<uniform> uniforms: BorderRadiusUniforms;

// Bind group 1: Texture and sampler
@group(1) @binding(0) var textureSampler: sampler;
@group(1) @binding(1) var layerTexture: texture_2d<f32>;

/**
 * Vertex shader for border radius clipping
 */
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Generate quad vertices
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
    
    // Apply transformation matrix
    output.position = uniforms.matrix * vec4<f32>(pos, 0.0, 1.0);
    output.texCoord = texCoords[vertexIndex];
    
    // Pass local position for SDF calculation (normalized -1 to 1)
    output.localPos = pos;
    
    return output;
}

/**
 * Calculate signed distance to a rounded rectangle
 * 
 * @param p - Point to test (in -1 to 1 space)
 * @param b - Half-size of the rectangle
 * @param r - Corner radius
 * @return Signed distance (negative inside, positive outside)
 */
fn sdRoundedRect(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    // Adjust for aspect ratio
    let q = abs(p) - b + vec2<f32>(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}

/**
 * Fragment shader with border radius clipping
 * 
 * Uses signed distance field for smooth, anti-aliased rounded corners.
 */
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample the texture
    let texColor = textureSample(layerTexture, textureSampler, input.texCoord);
    
    // Calculate signed distance to rounded rectangle
    // The rectangle is in -1 to 1 space, so half-size is 1.0
    let halfSize = vec2<f32>(1.0, 1.0);
    
    // Clamp radius to valid range (0 to 0.5 in normalized space)
    let clampedRadius = clamp(uniforms.radius, 0.0, 0.5);
    
    // Calculate SDF
    let dist = sdRoundedRect(input.localPos, halfSize, clampedRadius * 2.0);
    
    // Anti-aliased edge using smoothstep
    // smoothness controls the width of the anti-aliasing band
    let alpha = 1.0 - smoothstep(-uniforms.smoothness, uniforms.smoothness, dist);
    
    // Apply opacity and border radius clipping
    let finalAlpha = texColor.a * uniforms.opacity * alpha;
    
    return vec4<f32>(texColor.rgb, finalAlpha);
}

/**
 * Alternative fragment shader with variable corner radii
 * 
 * Supports different radius values for each corner.
 */
struct VariableRadiusUniforms {
    matrix: mat4x4<f32>,
    opacity: f32,
    topLeftRadius: f32,
    topRightRadius: f32,
    bottomLeftRadius: f32,
    bottomRightRadius: f32,
    smoothness: f32,
    padding: vec2<f32>,
};

/**
 * Calculate signed distance to a rectangle with variable corner radii
 */
fn sdRoundedRectVariable(
    p: vec2<f32>,
    b: vec2<f32>,
    topLeft: f32,
    topRight: f32,
    bottomLeft: f32,
    bottomRight: f32
) -> f32 {
    // Determine which corner we're closest to
    var r: f32;
    if (p.x > 0.0) {
        if (p.y > 0.0) {
            r = topRight;
        } else {
            r = bottomRight;
        }
    } else {
        if (p.y > 0.0) {
            r = topLeft;
        } else {
            r = bottomLeft;
        }
    }
    
    let q = abs(p) - b + vec2<f32>(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}
