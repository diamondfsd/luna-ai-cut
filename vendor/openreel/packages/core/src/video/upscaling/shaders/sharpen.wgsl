struct Uniforms {
    width: u32,
    height: u32,
    strength: f32,
    padding: u32,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

fn sampleColor(coords: vec2<i32>) -> vec4<f32> {
    let clampedCoords = vec2<i32>(
        clamp(coords.x, 0, i32(uniforms.width) - 1),
        clamp(coords.y, 0, i32(uniforms.height) - 1)
    );
    return textureLoad(inputTexture, clampedCoords, 0);
}

fn getLuminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= uniforms.width || y >= uniforms.height) {
        return;
    }

    let coords = vec2<i32>(i32(x), i32(y));
    let center = sampleColor(coords);

    if (uniforms.strength < 0.001) {
        textureStore(outputTexture, coords, center);
        return;
    }

    let top = sampleColor(coords + vec2<i32>(0, -1));
    let bottom = sampleColor(coords + vec2<i32>(0, 1));
    let left = sampleColor(coords + vec2<i32>(-1, 0));
    let right = sampleColor(coords + vec2<i32>(1, 0));

    let blur = (top + bottom + left + right) * 0.25;

    let highPass = center - blur;

    let localContrast = abs(getLuminance(highPass.rgb));
    let adaptiveStrength = uniforms.strength * (1.0 - localContrast * 0.5);

    let sharpened = center + highPass * adaptiveStrength;

    let finalColor = clamp(sharpened, vec4<f32>(0.0), vec4<f32>(1.0));

    textureStore(outputTexture, coords, finalColor);
}
