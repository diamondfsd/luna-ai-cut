struct Dimensions {
    width: u32,
    height: u32,
    padding: vec2<u32>,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> dims: Dimensions;

fn getLuminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

fn sampleLuminance(coords: vec2<i32>) -> f32 {
    let clampedCoords = vec2<i32>(
        clamp(coords.x, 0, i32(dims.width) - 1),
        clamp(coords.y, 0, i32(dims.height) - 1)
    );
    return getLuminance(textureLoad(inputTexture, clampedCoords, 0).rgb);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= dims.width || y >= dims.height) {
        return;
    }

    let coords = vec2<i32>(i32(x), i32(y));

    let tl = sampleLuminance(coords + vec2<i32>(-1, -1));
    let tc = sampleLuminance(coords + vec2<i32>(0, -1));
    let tr = sampleLuminance(coords + vec2<i32>(1, -1));
    let ml = sampleLuminance(coords + vec2<i32>(-1, 0));
    let mr = sampleLuminance(coords + vec2<i32>(1, 0));
    let bl = sampleLuminance(coords + vec2<i32>(-1, 1));
    let bc = sampleLuminance(coords + vec2<i32>(0, 1));
    let br = sampleLuminance(coords + vec2<i32>(1, 1));

    let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;

    let magnitude = sqrt(gx * gx + gy * gy);

    var angle: f32 = 0.0;
    if (abs(gx) > 0.001 || abs(gy) > 0.001) {
        angle = atan2(gy, gx);
        angle = (angle + 3.14159265359) / (2.0 * 3.14159265359);
    }

    let normalizedMagnitude = clamp(magnitude, 0.0, 1.0);

    let originalColor = textureLoad(inputTexture, coords, 0);

    textureStore(outputTexture, coords, vec4<f32>(
        normalizedMagnitude,
        angle,
        gx * 0.5 + 0.5,
        gy * 0.5 + 0.5
    ));
}
