export const lanczosShaderSource = /* wgsl */ `
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
`;

export const edgeDetectShaderSource = /* wgsl */ `
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

 textureStore(outputTexture, coords, vec4<f32>(
 normalizedMagnitude,
 angle,
 gx * 0.5 + 0.5,
 gy * 0.5 + 0.5
 ));
}
`;

export const edgeDirectedShaderSource = /* wgsl */ `
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
`;

export const sharpenShaderSource = /* wgsl */ `
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
`;

export function createLanczosDimensionsBuffer(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  direction: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(32);
  const view = new Uint32Array(buffer);
  view[0] = srcWidth;
  view[1] = srcHeight;
  view[2] = dstWidth;
  view[3] = dstHeight;
  view[4] = direction;
  view[5] = 0;
  view[6] = 0;
  view[7] = 0;
  return buffer;
}

export function createEdgeDimensionsBuffer(
  width: number,
  height: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(16);
  const view = new Uint32Array(buffer);
  view[0] = width;
  view[1] = height;
  view[2] = 0;
  view[3] = 0;
  return buffer;
}

export function createSharpenUniformsBuffer(
  width: number,
  height: number,
  strength: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(16);
  const u32View = new Uint32Array(buffer);
  const f32View = new Float32Array(buffer);
  u32View[0] = width;
  u32View[1] = height;
  f32View[2] = strength;
  u32View[3] = 0;
  return buffer;
}
