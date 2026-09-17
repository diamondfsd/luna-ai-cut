struct Dimensions {
    srcWidth: u32,
    srcHeight: u32,
    dstWidth: u32,
    dstHeight: u32,
    direction: u32,
    padding: vec3<u32>,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> dims: Dimensions;

const PI: f32 = 3.14159265359;
const LANCZOS_A: f32 = 3.0;

fn sinc(x: f32) -> f32 {
    if (abs(x) < 0.0001) {
        return 1.0;
    }
    let pix = PI * x;
    return sin(pix) / pix;
}

fn lanczosWeight(x: f32) -> f32 {
    if (abs(x) >= LANCZOS_A) {
        return 0.0;
    }
    return sinc(x) * sinc(x / LANCZOS_A);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dstX = global_id.x;
    let dstY = global_id.y;

    var targetWidth: u32;
    var targetHeight: u32;
    var srcWidth: u32;
    var srcHeight: u32;

    if (dims.direction == 0u) {
        targetWidth = dims.dstWidth;
        targetHeight = dims.srcHeight;
        srcWidth = dims.srcWidth;
        srcHeight = dims.srcHeight;
    } else {
        targetWidth = dims.dstWidth;
        targetHeight = dims.dstHeight;
        srcWidth = dims.dstWidth;
        srcHeight = dims.srcHeight;
    }

    if (dstX >= targetWidth || dstY >= targetHeight) {
        return;
    }

    var scale: f32;
    var srcPos: f32;

    if (dims.direction == 0u) {
        scale = f32(srcWidth) / f32(targetWidth);
        srcPos = (f32(dstX) + 0.5) * scale - 0.5;
    } else {
        scale = f32(srcHeight) / f32(targetHeight);
        srcPos = (f32(dstY) + 0.5) * scale - 0.5;
    }

    let srcCenter = i32(floor(srcPos));
    let kernelRadius = i32(ceil(LANCZOS_A * max(1.0, scale)));

    var colorSum = vec4<f32>(0.0);
    var weightSum: f32 = 0.0;

    for (var i = -kernelRadius; i <= kernelRadius; i = i + 1) {
        let srcIdx = srcCenter + i;
        var sampleCoords: vec2<i32>;

        if (dims.direction == 0u) {
            let clampedX = clamp(srcIdx, 0, i32(srcWidth) - 1);
            sampleCoords = vec2<i32>(clampedX, i32(dstY));
        } else {
            let clampedY = clamp(srcIdx, 0, i32(srcHeight) - 1);
            sampleCoords = vec2<i32>(i32(dstX), clampedY);
        }

        let dist = (f32(srcIdx) + 0.5 - srcPos) / max(1.0, scale);
        let weight = lanczosWeight(dist);

        if (weight > 0.0001) {
            colorSum = colorSum + textureLoad(inputTexture, sampleCoords, 0) * weight;
            weightSum = weightSum + weight;
        }
    }

    var finalColor: vec4<f32>;
    if (weightSum > 0.0001) {
        finalColor = colorSum / weightSum;
    } else {
        if (dims.direction == 0u) {
            finalColor = textureLoad(inputTexture, vec2<i32>(clamp(srcCenter, 0, i32(srcWidth) - 1), i32(dstY)), 0);
        } else {
            finalColor = textureLoad(inputTexture, vec2<i32>(i32(dstX), clamp(srcCenter, 0, i32(srcHeight) - 1)), 0);
        }
    }

    finalColor = clamp(finalColor, vec4<f32>(0.0), vec4<f32>(1.0));
    textureStore(outputTexture, vec2<i32>(i32(dstX), i32(dstY)), finalColor);
}
