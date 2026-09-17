struct Dimensions {
    width: u32,
    height: u32,
    padding: vec2<u32>,
};

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var edgeTexture: texture_2d<f32>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> dims: Dimensions;

fn sampleColor(coords: vec2<i32>) -> vec4<f32> {
    let clampedCoords = vec2<i32>(
        clamp(coords.x, 0, i32(dims.width) - 1),
        clamp(coords.y, 0, i32(dims.height) - 1)
    );
    return textureLoad(colorTexture, clampedCoords, 0);
}

fn sampleEdge(coords: vec2<i32>) -> vec4<f32> {
    let clampedCoords = vec2<i32>(
        clamp(coords.x, 0, i32(dims.width) - 1),
        clamp(coords.y, 0, i32(dims.height) - 1)
    );
    return textureLoad(edgeTexture, clampedCoords, 0);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= dims.width || y >= dims.height) {
        return;
    }

    let coords = vec2<i32>(i32(x), i32(y));
    let color = sampleColor(coords);
    let edge = sampleEdge(coords);

    let magnitude = edge.r;
    let gx = edge.b * 2.0 - 1.0;
    let gy = edge.a * 2.0 - 1.0;

    let edgeThreshold = 0.05;

    if (magnitude < edgeThreshold) {
        textureStore(outputTexture, coords, color);
        return;
    }

    let gradLen = sqrt(gx * gx + gy * gy);
    var perpX: f32 = 0.0;
    var perpY: f32 = 0.0;

    if (gradLen > 0.001) {
        perpX = -gy / gradLen;
        perpY = gx / gradLen;
    }

    let sampleDist = 1.0;
    let offset = vec2<f32>(perpX * sampleDist, perpY * sampleDist);

    let sample1Coords = coords + vec2<i32>(i32(round(offset.x)), i32(round(offset.y)));
    let sample2Coords = coords - vec2<i32>(i32(round(offset.x)), i32(round(offset.y)));

    let sample1 = sampleColor(sample1Coords);
    let sample2 = sampleColor(sample2Coords);

    let blendFactor = clamp(magnitude * 2.0, 0.0, 1.0);
    let edgeColor = (sample1 + sample2) * 0.5;
    let refinedColor = mix(color, edgeColor, blendFactor * 0.3);

    textureStore(outputTexture, coords, refinedColor);
}
