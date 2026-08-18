import type { CompositionInput, CompositionLayer, RenderColorAdjustments, WatermarkPositioning } from '../../shared/types'
import { WEBGPU_FLAGS } from './constants'
import {
  buildWebGpuColorCurveLut,
  normalizeWebGpuHslChannels,
  webGpuColorCurveCacheKey,
  WEBGPU_CURVE_LUT_WIDTH,
} from './color-grade'
import { identityWebGpuLut, parseWebGpuLut, type WebGpuLutData } from './cube-lut'
import { encodeWebGpuMaskTexture, type WebGpuMaskSource } from './mask'
import { formatWebGpuError, WebGpuRuntime } from './runtime'
import { getWebGpuSourceDimensions, type WebGpuImageSource } from './source'
import { hasRasterizableWebGpuLayerContent, rasterizeWebGpuLayer } from './layer-rasterizer'
import { maskTimelineSampleAt } from '../../workspace/mask/maskTimeline'
import { maskTrackTransformAt } from '../../workspace/mask/maskTrack'
import { compositionRevealProgress } from '../revealProgress'

export interface WebGpuCompositionRenderStats {
  submitMs: number
  layerCount: number
}

export interface WebGpuCompositionRendererOptions {
  resolveImage: (path: string) => Promise<WebGpuImageSource>
  resolveSource?: (layer: CompositionLayer) => Promise<WebGpuImageSource>
  resolveLut?: (path: string) => Promise<string>
  resolveMask?: (layer: CompositionLayer, path: string) => Promise<WebGpuMaskSource>
  onDeviceLost?: (message: string) => void
  onError?: (message: string) => void
}

interface CachedImageTexture {
  texture: GPUTexture
  view: GPUTextureView
  width: number
  height: number
}

interface CachedLutTexture extends WebGpuLutData {
  texture: GPUTexture
  view: GPUTextureView
}

interface CachedCurveTexture {
  texture: GPUTexture
  view: GPUTextureView
  key: string
}

interface CachedMaskTexture {
  texture: GPUTexture
  view: GPUTextureView
  width: number
  height: number
}

interface ResolvedMask {
  path: string
  opacity: number
  inverted: boolean
  feather: number
  transform: {
    translateX: number
    translateY: number
    scale: number
    rotation: number
  }
}

const HIDDEN_MASK = Symbol('hidden-mask')

type SupportedBlendMode = 'normal' | 'multiply' | 'screen' | 'add'

const BLEND_MODES: SupportedBlendMode[] = ['normal', 'multiply', 'screen', 'add']
const LAYER_UNIFORM_FLOATS = 32 * 4
const LAYER_UNIFORM_BYTES = LAYER_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT

function paddedLutData(lut: WebGpuLutData): { data: Uint8Array; bytesPerRow: number } {
  const rowBytes = lut.size * 4
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256
  if (bytesPerRow === rowBytes) return { data: lut.data, bytesPerRow }

  const data = new Uint8Array(bytesPerRow * lut.size * lut.size)
  for (let depth = 0; depth < lut.size; depth++) {
    for (let row = 0; row < lut.size; row++) {
      const sourceOffset = (depth * lut.size + row) * rowBytes
      const targetOffset = (depth * lut.size + row) * bytesPerRow
      data.set(lut.data.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset)
    }
  }
  return { data, bytesPerRow }
}

const COMPOSITION_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) localPosition: vec2f,
};

struct LayerUniforms {
  rect: vec4f,
  sourceRect: vec4f,
  transform: vec4f,
  style: vec4f,
  color: vec4f,
  range: vec4f,
  detail: vec4f,
  detailExtra: vec4f,
  grading: vec4f,
  gradingExtra: vec4f,
  levels: vec4f,
  extra: vec4f,
  hsl: array<vec4f, 12>,
  mask: vec4f,
  maskTransform: vec4f,
  reveal: vec4f,
  pixelFlow: vec4f,
  pixelFlowGeometry: vec4f,
  pixelFlowDepth: vec4f,
  pixelFlowScale: vec4f,
  pixelFlowFinish: vec4f,
};

@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> layer: LayerUniforms;
@group(0) @binding(3) var lutTexture: texture_3d<f32>;
@group(0) @binding(4) var restoreLutTexture: texture_3d<f32>;
@group(0) @binding(5) var curveTexture: texture_2d<f32>;
@group(0) @binding(6) var maskTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0)
  );
  let sourcePosition = positions[vertexIndex];
  let centered = sourcePosition - vec2f(0.5, 0.5);
  let angle = layer.transform.y;
  let rotated = vec2f(
    centered.x * cos(angle) - centered.y * sin(angle),
    centered.x * sin(angle) + centered.y * cos(angle)
  ) * max(layer.transform.x, 0.0001);
  let localPosition = rotated + vec2f(0.5, 0.5);
  let canvasPosition = layer.rect.xy + localPosition * layer.rect.zw;

  var output: VertexOutput;
  output.position = vec4f(canvasPosition.x * 2.0 - 1.0, 1.0 - canvasPosition.y * 2.0, 0.0, 1.0);
  var uv = sourcePosition;
  if (layer.transform.z > 0.5) { uv.x = 1.0 - uv.x; }
  if (layer.transform.w > 0.5) { uv.y = 1.0 - uv.y; }
  output.uv = layer.sourceRect.xy + uv * layer.sourceRect.zw;
  output.localPosition = sourcePosition;
  return output;
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn rgb2hsv(c: vec3f) -> vec3f {
  let maxChannel = max(c.r, max(c.g, c.b));
  let minChannel = min(c.r, min(c.g, c.b));
  let delta = maxChannel - minChannel;
  var hue = 0.0;
  if (delta > 0.00001) {
    if (maxChannel == c.r) {
      hue = (c.g - c.b) / delta;
      if (hue < 0.0) { hue = hue + 6.0; }
    } else if (maxChannel == c.g) {
      hue = (c.b - c.r) / delta + 2.0;
    } else {
      hue = (c.r - c.g) / delta + 4.0;
    }
    hue = hue / 6.0;
  }
  return vec3f(hue, select(0.0, delta / maxChannel, maxChannel > 0.00001), maxChannel);
}

fn hsv2rgb(hsv: vec3f) -> vec3f {
  let hue = fract(hsv.x);
  let p = abs(fract(vec3f(hue) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return hsv.z * mix(vec3f(1.0), clamp(p - vec3f(1.0), vec3f(0.0), vec3f(1.0)), hsv.y);
}

fn sampleSource(uv: vec2f) -> vec3f {
  return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0).rgb;
}

fn blurSource(uv: vec2f, radius: f32) -> vec3f {
  let texel = vec2f(1.0) / vec2f(textureDimensions(sourceTexture, 0));
  let offset = texel * max(radius, 0.25);
  var total = vec3f(0.0);
  total = total + sampleSource(uv + vec2f(-offset.x, -offset.y));
  total = total + sampleSource(uv + vec2f(0.0, -offset.y));
  total = total + sampleSource(uv + vec2f(offset.x, -offset.y));
  total = total + sampleSource(uv + vec2f(-offset.x, 0.0));
  total = total + sampleSource(uv);
  total = total + sampleSource(uv + vec2f(offset.x, 0.0));
  total = total + sampleSource(uv + vec2f(-offset.x, offset.y));
  total = total + sampleSource(uv + vec2f(0.0, offset.y));
  total = total + sampleSource(uv + vec2f(offset.x, offset.y));
  return total / 9.0;
}

fn applySpatialDetail(cIn: vec3f, uv: vec2f) -> vec3f {
  let detail = layer.detail;
  let detailExtra = layer.detailExtra;
  let denoise = clamp((detailExtra.x + detailExtra.y) / 100.0, 0.0, 1.0);
  let localContrast = detail.y / 100.0 * 0.7 + detail.z / 100.0 * 0.35;
  let sharpen = clamp(detail.w / 100.0, 0.0, 2.0) * 0.65;
  let glow = clamp(detailExtra.z / 100.0, 0.0, 1.0);
  if (denoise <= 0.0001 && abs(localContrast) <= 0.0001 && sharpen <= 0.0001 && glow <= 0.0001) {
    return cIn;
  }

  let blurred = blurSource(uv, max(detailExtra.w / 18.0, 0.25));
  var c = mix(cIn, blurred, denoise);
  c = c + (cIn - blurred) * (localContrast + sharpen);
  if (glow > 0.0001) {
    let threshold = clamp(layer.grading.x / 100.0, 0.0, 0.99);
    let bright = max(blurred - vec3f(threshold), vec3f(0.0));
    c = c + bright * glow * 0.6;
  }
  return c;
}

fn sampleCurve(value: f32) -> vec4f {
  let width = ${WEBGPU_CURVE_LUT_WIDTH}.0;
  let u = (clamp(value, 0.0, 1.0) * (width - 1.0) + 0.5) / width;
  return textureSampleLevel(curveTexture, sourceSampler, vec2f(u, 0.5), 0.0);
}

fn applyLevels(cIn: vec3f) -> vec3f {
  let black = clamp(layer.levels.y, 0.0, 0.99);
  let white = max(black + 0.001, layer.levels.w);
  let gray = clamp(layer.levels.z, 0.05, 0.99);
  let gamma = log(0.5) / log(gray);
  var c = clamp((cIn - vec3f(black)) / vec3f(white - black), vec3f(0.0), vec3f(1.0));
  c = pow(c, vec3f(gamma));
  return c;
}

fn applyWheel(cIn: vec3f, hue: f32, amount: f32, mask: f32) -> vec3f {
  let strength = clamp(abs(amount) / 100.0, 0.0, 1.0) * mask;
  if (strength <= 0.0001) { return cIn; }
  let tintColor = hsv2rgb(vec3f(fract(hue / 360.0), 1.0, 1.0));
  var tintTarget = tintColor;
  if (amount < 0.0) { tintTarget = vec3f(1.0) - tintTarget; }
  return mix(cIn, cIn * mix(vec3f(1.0), tintTarget, clamp(abs(amount) / 100.0, 0.0, 1.0)), mask);
}

fn hueDistance(left: f32, right: f32) -> f32 {
  let direct = abs(left - right);
  return min(direct, 360.0 - direct);
}

fn applyHslChannel(cIn: vec3f, params: vec4f) -> vec3f {
  if (abs(params.y) + abs(params.z) + abs(params.w) <= 0.0001) { return cIn; }
  var hsv = rgb2hsv(cIn);
  if (hsv.y <= 0.0001) { return cIn; }
  let distance = hueDistance(hsv.x * 360.0, params.x);
  let weight = 1.0 - smoothstep(0.0, 45.0, distance);
  if (weight <= 0.0001) { return cIn; }
  hsv.x = fract(hsv.x + params.y / 360.0 * weight);
  hsv.y = clamp(hsv.y * (1.0 + params.z / 100.0 * weight), 0.0, 1.0);
  hsv.z = clamp(hsv.z + params.w / 100.0 * weight, 0.0, 1.0);
  return hsv2rgb(hsv);
}

fn applyHsl(cIn: vec3f) -> vec3f {
  var c = cIn;
  for (var index = 0u; index < 12u; index = index + 1u) {
    c = applyHslChannel(c, layer.hsl[index]);
  }
  return c;
}

fn applyColor(cIn: vec3f, uv: vec2f) -> vec3f {
  let tone = layer.style;
  let color = layer.color;
  let range = layer.range;
  let grading = layer.grading;
  let gradingExtra = layer.gradingExtra;
  var c = applySpatialDetail(cIn, uv) * exp2(tone.y);
  let bounded = clamp(c, vec3f(0.0), vec3f(1.0));
  let midtoneWeight = bounded * (vec3f(1.0) - bounded);
  c = c + midtoneWeight * (tone.z / 100.0) * 1.1;

  let temperature = color.y / 100.0;
  let tint = color.z / 100.0;
  let whiteBalance = vec3f(
    1.0 + temperature * 0.18 + tint * 0.04,
    1.0 - tint * 0.12,
    1.0 - temperature * 0.18 + tint * 0.04
  );
  c = c * whiteBalance;

  var y = luminance(c);
  let shadowMask = pow(1.0 - clamp(y, 0.0, 1.0), 2.0);
  let highlightMask = pow(clamp(y, 0.0, 1.0), 2.0);
  c = c + c * (range.y / 100.0) * shadowMask * 0.9;
  c = c + c * (range.x / 100.0) * highlightMask * 0.9;
  c = c - c * (range.w / 100.0) * shadowMask * 0.85;
  c = c + (range.z / 100.0) * highlightMask * 0.35;

  let contrast = tone.w / 100.0;
  c = (c - vec3f(0.466)) * (1.0 + contrast * 0.55) + vec3f(0.466);
  y = luminance(c);
  c = mix(vec3f(y), c, 1.0 + color.x / 100.0);

  let maxChannel = max(c.r, max(c.g, c.b));
  let minChannel = min(c.r, min(c.g, c.b));
  let chroma = maxChannel - minChannel;
  c = mix(vec3f(luminance(c)), c, 1.0 + color.w / 100.0 * (1.0 - clamp(chroma, 0.0, 1.0)));
  c = applyLevels(c);

  let gradeShadowMask = 1.0 - smoothstep(0.0, 0.5, luminance(c));
  let gradeHighlightMask = smoothstep(0.5, 1.0, luminance(c));
  let gradeMidtoneMask = max(0.0, 1.0 - gradeShadowMask - gradeHighlightMask);
  c = applyWheel(c, grading.y, grading.z, gradeShadowMask);
  c = applyWheel(c, grading.w, gradingExtra.x, gradeMidtoneMask);
  c = applyWheel(c, gradingExtra.y, gradingExtra.z, gradeHighlightMask);

  let curveLift = gradingExtra.w / 100.0;
  c = c + vec3f(curveLift);
  c = (c - vec3f(0.5)) * (1.0 + layer.levels.x / 100.0) + vec3f(0.5);
  let redCurve = sampleCurve(c.r).r;
  let greenCurve = sampleCurve(c.g).g;
  let blueCurve = sampleCurve(c.b).b;
  c = vec3f(redCurve, greenCurve, blueCurve);
  let currentLuma = luminance(c);
  let targetLuma = sampleCurve(currentLuma).a;
  c = c + vec3f(targetLuma - currentLuma);
  c = applyHsl(c);
  c = c + vec3f(layer.extra.x / 100.0);
  return clamp(c, vec3f(0.0), vec3f(1.0));
}

fn sampleLut(texture: texture_3d<f32>, color: vec3f, size: f32) -> vec3f {
  let coords = (clamp(color, vec3f(0.0), vec3f(1.0)) * (size - 1.0) + vec3f(0.5)) / size;
  return textureSampleLevel(texture, sourceSampler, coords, 0.0).rgb;
}

fn applyLut(cIn: vec3f) -> vec3f {
  var c = cIn;
  let restoreSize = layer.extra.w;
  if (restoreSize >= 2.0) {
    c = sampleLut(restoreLutTexture, c, restoreSize);
  }
  let intensity = clamp(layer.extra.y, 0.0, 1.0);
  if (intensity <= 0.0) { return c; }
  let size = max(layer.extra.z, 2.0);
  return mix(c, sampleLut(lutTexture, c, size), intensity);
}

fn sampleMask(uv: vec2f) -> f32 {
  let dimensions = vec2f(textureDimensions(maskTexture, 0));
  let translated = (uv - vec2f(0.5) - layer.maskTransform.xy) * dimensions;
  let angle = layer.maskTransform.w;
  let cosine = cos(angle);
  let sine = sin(angle);
  let unrotated = vec2f(
    cosine * translated.x + sine * translated.y,
    -sine * translated.x + cosine * translated.y,
  );
  let maskUv = unrotated / max(layer.maskTransform.z, 0.0001) / dimensions + vec2f(0.5);
  if (maskUv.x < 0.0 || maskUv.x > 1.0 || maskUv.y < 0.0 || maskUv.y > 1.0) {
    return 0.0;
  }
  let sampled = textureSampleLevel(maskTexture, sourceSampler, maskUv, 0.0);
  let inverted = layer.mask.y > 0.5;
  let original = select(sampled.r, 1.0 - sampled.r, inverted);
  let feather = layer.mask.z;
  if (feather < 0.5) { return original; }
  let distance = select(sampled.g, sampled.b, inverted) * 100.0;
  return max(original, 1.0 - smoothstep(0.0, feather, distance));
}

fn pixelFlowHash(cell: vec2f) -> f32 {
  return fract(sin(dot(cell, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn pixelFlowLuma(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn pixelFlowSource(uv: vec2f) -> vec3f {
  return textureSampleLevel(sourceTexture, sourceSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
}

fn pixelFlowRegions(uv: vec2f) -> vec3f {
  if (layer.pixelFlowDepth.y > 0.5) {
    let depth = textureSampleLevel(maskTexture, sourceSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).r;
    let sky = 1.0 - smoothstep(0.22, 0.4, depth);
    let subject = smoothstep(0.66, 0.84, depth);
    return vec3f(sky, max(0.0, 1.0 - sky - subject), subject);
  }
  let sky = 1.0 - smoothstep(0.34, 0.56, uv.y);
  return vec3f(sky, 1.0 - sky, 0.0);
}

fn pixelFlowDirectionCoord(uv: vec2f, sourceSize: vec2f) -> f32 {
  let direction = layer.pixelFlowScale.z;
  if (direction < 0.5) { return uv.y; }
  if (direction < 1.5) { return 1.0 - uv.y; }
  if (direction < 2.5) { return uv.x; }
  if (direction < 3.5) { return 1.0 - uv.x; }
  let offset = (uv - vec2f(0.5)) * sourceSize;
  let radial = clamp(length(offset) / max(1.0, length(sourceSize * 0.5)), 0.0, 1.0);
  return select(radial, 1.0 - radial, direction > 4.5);
}

fn pixelFlowArrival(uv: vec2f, cellIndex: vec2f, sourceSize: vec2f, cellPx: f32) -> vec4f {
  let regions = pixelFlowRegions(uv);
  let columnNoise = pixelFlowHash(vec2f(cellIndex.x * 1.37 + 19.0, 7.0));
  let coarse = pixelFlowHash(floor(cellIndex / vec2f(4.0, 7.0)) + vec2f(31.0, 13.0));
  let speed = mix(0.78, 1.32, layer.pixelFlowGeometry.x);
  let luma = pixelFlowLuma(pixelFlowSource(uv));
  let backgroundCoord = uv.y;
  let subjectCoord = pixelFlowDirectionCoord(uv, sourceSize);
  let highlightAdvance = smoothstep(0.46, 0.88, luma) * 0.055;
  let skyArrival = 0.005 + uv.y * 0.22 / speed + columnNoise * 0.09;
  let backgroundArrival = 0.11 + backgroundCoord * 0.47 / speed + columnNoise * 0.06 + coarse * 0.065 - highlightAdvance;
  let subjectArrival = 0.17 + subjectCoord * 0.48 / speed + columnNoise * 0.055 + coarse * 0.05
    + layer.pixelFlowGeometry.w * 0.14 - highlightAdvance;
  let arrival = dot(regions, vec3f(skyArrival, backgroundArrival, subjectArrival));
  return vec4f(clamp(arrival, 0.0, 0.92), regions);
}

fn pixelFlowPulse(progress: f32, arrival: f32, regions: vec3f) -> f32 {
  let lengthValue = layer.pixelFlowGeometry.y;
  let tail = dot(regions, vec3f(
    mix(0.11, 0.24, lengthValue),
    mix(0.11, 0.27, lengthValue),
    mix(0.1, 0.24, lengthValue),
  ));
  let elapsed = progress - arrival;
  return smoothstep(-0.012, 0.018, elapsed) * (1.0 - smoothstep(tail * 0.3, tail, elapsed));
}

fn pixelFlowVisible(color: vec3f) -> f32 {
  let peak = max(color.r, max(color.g, color.b));
  return smoothstep(0.0015, 0.01, max(pixelFlowLuma(color), peak * 0.78));
}

fn pixelFlowColor(color: vec3f, filterStrength: f32) -> vec3f {
  let luma = pixelFlowLuma(color);
  let contrasted = (color - vec3f(0.5)) * (1.0 + filterStrength * 0.14) + vec3f(0.5);
  let saturated = vec3f(luma) + (contrasted - vec3f(luma)) * (1.24 + filterStrength * 0.58);
  let tealShadows = vec3f(-0.02, 0.032, 0.05) * (1.0 - smoothstep(0.24, 0.7, luma));
  let warmHighlights = vec3f(0.055, 0.018, -0.014) * smoothstep(0.5, 0.92, luma);
  return clamp(saturated + tealShadows + warmHighlights, vec3f(0.0), vec3f(1.45));
}

fn pixelFlowBloom(uv: vec2f, radius: vec2f, filterStrength: f32) -> vec3f {
  let tap = (sampleSource(uv) * smoothstep(0.42, 0.9, max(pixelFlowLuma(sampleSource(uv)), max(sampleSource(uv).r, max(sampleSource(uv).g, sampleSource(uv).b)) * 0.68)));
  var bloom = tap * 0.28;
  bloom += pixelFlowSource(uv + vec2f(radius.x, 0.0)) * 0.12;
  bloom += pixelFlowSource(uv - vec2f(radius.x, 0.0)) * 0.12;
  bloom += pixelFlowSource(uv + vec2f(0.0, radius.y)) * 0.12;
  bloom += pixelFlowSource(uv - vec2f(0.0, radius.y)) * 0.12;
  return pixelFlowColor(bloom, filterStrength);
}

fn pixelFlowEffect(uv: vec2f, source: vec4f, localPosition: vec2f) -> vec4f {
  if (layer.pixelFlow.x <= 0.5) {
    return source;
  }
  let sourceSize = vec2f(textureDimensions(sourceTexture, 0));
  let cellPx = max(2.0, max(sourceSize.x, sourceSize.y) / max(24.0, layer.pixelFlow.z));
  let cellIndex = floor(uv * sourceSize / cellPx);
  let cellUv = clamp((cellIndex + vec2f(0.5)) * cellPx / sourceSize, vec2f(0.0), vec2f(1.0));
  let cell = pixelFlowArrival(cellUv, cellIndex, sourceSize, cellPx);
  let progress = clamp(layer.pixelFlow.y, 0.0, 1.0);
  let duration = max(0.1, layer.pixelFlowDepth.x);
  let color = applyLut(applyColor(source.rgb, uv));
  let gray = pixelFlowLuma(color);
  let initial = clamp(vec3f(gray + layer.pixelFlowScale.y * 0.5), vec3f(0.0), vec3f(1.0));
  let reveal = smoothstep(cell.x - 0.018, cell.x + clamp(layer.pixelFlowFinish.z / duration * 0.55, 0.025, 0.18), progress);
  let base = mix(initial, color, max(reveal, smoothstep(0.94, 1.0, progress)));
  let random = pixelFlowHash(cellIndex * vec2f(5.37, 3.11) + vec2f(71.0, 29.0));
  let group = pixelFlowHash(floor(cellIndex / vec2f(2.0, 5.0)) + vec2f(11.0, 83.0));
  let strength = layer.pixelFlowGeometry.z;
  let gate = smoothstep(mix(0.42, 0.2, strength), mix(0.5, 0.28, strength), random * 0.72 + group * 0.28);
  let pulse = pixelFlowPulse(progress, cell.x, cell.yzw) * gate * cell.y;
  let visibility = pixelFlowVisible(pixelFlowSource(cellUv));
  let rain = pixelFlowColor(pixelFlowSource(cellUv), layer.pixelFlowFinish.y);
  let blockOffset = fract(uv * sourceSize / cellPx) - vec2f(0.5);
  let blockDistance = max(abs(blockOffset.x), abs(blockOffset.y));
  let blockShape = 1.0 - smoothstep(0.32, 0.5, blockDistance);
  let emission = rain * pulse * strength * visibility * blockShape;
  var lit = vec3f(1.0) - (vec3f(1.0) - base) * (vec3f(1.0) - clamp(emission, vec3f(0.0), vec3f(0.94)));
  let surfacePx = cellPx * max(1.0, layer.pixelFlow.w / 4.0);
  let surfaceIndex = floor(uv * sourceSize / surfacePx);
  let surfaceUv = clamp((surfaceIndex + vec2f(0.5)) * surfacePx / sourceSize, vec2f(0.0), vec2f(1.0));
  let surface = pixelFlowArrival(surfaceUv, surfaceIndex, sourceSize, surfacePx);
  let surfaceRegion = surface.z + surface.w;
  let surfacePulse = pixelFlowPulse(progress, surface.x, surface.yzw) * surfaceRegion;
  let surfaceColor = pixelFlowColor(pixelFlowSource(surfaceUv), layer.pixelFlowFinish.y);
  let surfaceOffset = fract(uv * sourceSize / surfacePx) - vec2f(0.5);
  let surfaceShape = 1.0 - smoothstep(0.22, 0.5, max(abs(surfaceOffset.x), abs(surfaceOffset.y)));
  let surfaceLight = surfaceColor * surfacePulse * strength * surfaceShape * pixelFlowVisible(pixelFlowSource(surfaceUv)) * 1.8;
  lit = vec3f(1.0) - (vec3f(1.0) - lit) * (vec3f(1.0) - clamp(surfaceLight, vec3f(0.0), vec3f(1.0)));
  let bloomStrength = layer.pixelFlowFinish.x;
  let bloom = pixelFlowBloom(uv, vec2f(cellPx) / sourceSize * mix(0.8, 1.65, bloomStrength), layer.pixelFlowFinish.y);
  lit += bloom * bloomStrength * (reveal * 0.025 + pulse * 0.13 + surfacePulse * 0.08);
  let alpha = source.a * layer.style.x;
  return vec4f(clamp(lit, vec3f(0.0), vec3f(1.35)) * alpha, alpha);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let revealProgress = clamp(layer.reveal.x, 0.0, 1.0);
  if (input.localPosition.x >= revealProgress) {
    discard;
  }
  let sampled = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  var maskValue = 1.0;
  if (layer.mask.w > 0.5) {
    maskValue = clamp(sampleMask(input.uv) * layer.mask.x, 0.0, 1.0);
  }
  let adjusted = applyLut(applyColor(sampled.rgb, input.uv));
  let isLocalColor = layer.mask.w > 1.5;
  var color = select(mix(sampled.rgb, adjusted, maskValue), adjusted, isLocalColor);
  var alpha = sampled.a * layer.style.x * select(1.0, maskValue, isLocalColor);
  if (layer.pixelFlow.x > 0.5) {
    let effect = pixelFlowEffect(input.uv, vec4f(color, alpha), input.localPosition);
    color = effect.rgb;
    alpha = effect.a;
  }
  if (revealProgress > 0.001 && revealProgress < 0.999) {
    let edgeDistance = revealProgress - input.localPosition.x;
    let edgeWidth = max(fwidth(input.localPosition.x) * 1.5, 0.001);
    let edgeAlpha = (1.0 - smoothstep(0.0, edgeWidth, edgeDistance)) * 0.28;
    color = mix(color, vec3f(1.0), clamp(edgeAlpha, 0.0, 1.0));
  }
  return vec4f(color, alpha);
}
`

function colorValue(color: RenderColorAdjustments | undefined, key: keyof RenderColorAdjustments): number {
  const value = color?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function createLayerUniforms(
  layer: CompositionLayer,
  targetRect: [number, number, number, number],
  sourceRect: [number, number, number, number],
  luts: { creative: CachedLutTexture; restore: CachedLutTexture | null },
  mask: ResolvedMask | null,
  revealProgress: number,
  time: number,
): Float32Array {
  const transform = layer.transform
  const color = layer.color
  const uniforms = new Float32Array(LAYER_UNIFORM_FLOATS)
  uniforms.set(targetRect, 0)
  uniforms.set(sourceRect, 4)
  uniforms.set([
    transform?.scale ?? 1,
    ((transform?.orientation ?? 0) + (transform?.rotate ?? 0)) * Math.PI / 180,
    transform?.flipH ? 1 : 0,
    transform?.flipV ? 1 : 0,
  ], 8)
  uniforms.set([
    layer.opacity ?? 1,
    colorValue(color, 'exposure'),
    colorValue(color, 'brightness'),
    colorValue(color, 'contrast'),
  ], 12)
  uniforms.set([
    colorValue(color, 'saturation'),
    colorValue(color, 'temperature'),
    colorValue(color, 'tint'),
    colorValue(color, 'vibrance'),
  ], 16)
  uniforms.set([
    colorValue(color, 'highlights'),
    colorValue(color, 'shadows'),
    colorValue(color, 'whites'),
    colorValue(color, 'blacks'),
  ], 20)
  uniforms.set([
    colorValue(color, 'black'),
    colorValue(color, 'clarity'),
    colorValue(color, 'texture'),
    colorValue(color, 'sharpen'),
  ], 24)
  uniforms.set([
    colorValue(color, 'denoise'),
    colorValue(color, 'skinSmoothing'),
    colorValue(color, 'glowStrength'),
    colorValue(color, 'glowRadius'),
  ], 28)
  uniforms.set([
    colorValue(color, 'glowThreshold'),
    colorValue(color, 'gradeShadowsHue'),
    colorValue(color, 'gradeShadowsAmount'),
    colorValue(color, 'gradeMidHue'),
  ], 32)
  uniforms.set([
    colorValue(color, 'gradeMidAmount'),
    colorValue(color, 'gradeHighlightsHue'),
    colorValue(color, 'gradeHighlightsAmount'),
    colorValue(color, 'curveLift'),
  ], 36)
  uniforms.set([
    colorValue(color, 'curveContrast'),
    colorValue(color, 'levelsBlack'),
    colorValue(color, 'levelsGray') || 0.5,
    colorValue(color, 'levelsWhite') || 1,
  ], 40)
  uniforms.set([
    colorValue(color, 'black'),
    layer.lutId ? Math.max(0, Math.min(100, layer.lutIntensity ?? 100)) / 100 : 0,
    luts.creative.size,
    luts.restore?.size ?? 0,
  ], 44)
  uniforms.set(normalizeWebGpuHslChannels(color?.hslChannels), 48)
  uniforms.set([
    mask?.opacity ?? 1,
    mask?.inverted ? 1 : 0,
    mask?.feather ?? 0,
    mask ? (layer.layerType === 'local-color' ? 2 : 1) : 0,
  ], 96)
  uniforms.set([
    mask?.transform.translateX ?? 0,
    mask?.transform.translateY ?? 0,
    mask?.transform.scale ?? 1,
    mask?.transform.rotation ?? 0,
  ], 100)
  uniforms.set([Math.max(0, Math.min(1, revealProgress)), 0, 0, 0], 104)
  const pixelFlow = layer.pixelFlow
  const pixelFlowDuration = Math.max(0.1, pixelFlow?.duration ?? 0.1)
  const pixelFlowProgress = pixelFlow?.progress ?? Math.max(0, Math.min(1, time / pixelFlowDuration))
  const subjectDirection = pixelFlow?.subjectDirection === 'up'
    ? 1
    : pixelFlow?.subjectDirection === 'right'
      ? 2
      : pixelFlow?.subjectDirection === 'left'
        ? 3
        : pixelFlow?.subjectDirection === 'outward'
          ? 4
          : pixelFlow?.subjectDirection === 'inward' ? 5 : 0
  uniforms.set([
    pixelFlow ? 1 : 0,
    Math.max(0, Math.min(1, pixelFlowProgress)),
    Math.max(24, Math.min(500, pixelFlow?.pixelCount ?? 24)),
    Math.max(1, Math.min(32, pixelFlow?.lightWidth ?? 1)),
  ], 108)
  uniforms.set([
    Math.max(0, Math.min(1, (pixelFlow?.rainSpeed ?? 0) / 100)),
    Math.max(0, Math.min(1, (pixelFlow?.rainLength ?? 0) / 100)),
    Math.max(0, Math.min(1, (pixelFlow?.flowStrength ?? 0) / 100)),
    Math.max(0, Math.min(1, (pixelFlow?.subjectDelay ?? 0) / 100)),
  ], 112)
  uniforms.set([pixelFlowDuration, pixelFlow?.segmented ? 1 : 0, 0, 0], 116)
  uniforms.set([
    Math.max(0, Math.min(1, (pixelFlow?.initialSaturation ?? 0) / 100)),
    Math.max(-1, Math.min(1, (pixelFlow?.initialBrightness ?? 0) / 100)),
    subjectDirection,
    0,
  ], 120)
  uniforms.set([
    Math.max(0, Math.min(1, (pixelFlow?.bloomStrength ?? 0) / 100)),
    Math.max(0, Math.min(1, (pixelFlow?.filterStrength ?? 0) / 100)),
    Math.max(0, Math.min(2, pixelFlow?.colorTransition ?? 0)),
    0,
  ], 124)
  return uniforms
}

function maskTimeForLayer(layer: CompositionLayer, time: number): number {
  const sourceTime = layer.source.time
  return Math.max(0, (sourceTime?.start ?? 0) + time - (sourceTime?.offset ?? 0))
}

function resolveMaskForLayer(layer: CompositionLayer, time: number): ResolvedMask | typeof HIDDEN_MASK | null {
  const maskTime = maskTimeForLayer(layer, time)
  const timelineSample = maskTimelineSampleAt(layer.maskTimeline, maskTime)
  if (layer.maskTimeline && !timelineSample?.path) return HIDDEN_MASK
  const path = timelineSample?.path ?? layer.maskPath
  if (!path) return null
  const transform = timelineSample?.transform ?? (layer.maskTrack
    ? maskTrackTransformAt(layer.maskTrack, maskTime)
    : undefined)
  return {
    path,
    opacity: Math.max(0, Math.min(1, layer.maskOpacity ?? 1)),
    inverted: layer.maskInverted ?? false,
    feather: Math.max(0, Math.min(100, layer.maskFeather ?? 0)),
    transform: {
      translateX: transform?.translateX ?? 0,
      translateY: transform?.translateY ?? 0,
      scale: Math.max(0.0001, transform?.scale ?? 1),
      rotation: transform?.rotation ?? 0,
    },
  }
}

function sourceRectForLayer(
  layer: CompositionLayer,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): [number, number, number, number] {
  const requested = layer.sourceRect ?? { x: 0, y: 0, w: 1, h: 1 }
  let x = Math.max(0, Math.min(1, requested.x))
  let y = Math.max(0, Math.min(1, requested.y))
  let w = Math.max(0.0001, Math.min(1 - x, requested.w))
  let h = Math.max(0.0001, Math.min(1 - y, requested.h))
  if (resolvePositioning(layer.positioning, canvasWidth, canvasHeight)) return [x, y, w, h]
  if (layer.fit === 'stretch' || layer.fit === 'cover-scale') return [x, y, w, h]

  const targetAspect = Math.max(
    0.0001,
    (layer.rect.w * canvasWidth) / Math.max(layer.rect.h * canvasHeight, 0.0001),
  )
  const sourceAspect = Math.max(0.0001, (sourceWidth * w) / Math.max(sourceHeight * h, 0.0001))
  if (layer.fit === 'contain') return [x, y, w, h]
  if (sourceAspect > targetAspect) {
    const croppedWidth = h * targetAspect * sourceHeight / sourceWidth
    x += (w - croppedWidth) / 2
    w = croppedWidth
  } else {
    const croppedHeight = w / targetAspect * sourceWidth / sourceHeight
    y += (h - croppedHeight) / 2
    h = croppedHeight
  }
  return [x, y, w, h]
}

function destinationRectForLayer(
  layer: CompositionLayer,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): [number, number, number, number] {
  const positioning = resolvePositioning(layer.positioning, canvasWidth, canvasHeight)
  if (positioning) {
    const targetWidth = Math.max(0.0001, Math.min(1, positioning.targetWidth))
    const canvasAspect = canvasWidth / Math.max(1, canvasHeight)
    const sourceAspect = sourceWidth / Math.max(1, sourceHeight)
    const targetHeight = Math.min(1, targetWidth * canvasAspect / Math.max(0.0001, sourceAspect))
    const marginX = positioning.marginX ?? 0
    const marginY = positioning.marginY ?? 0
    let x = layer.rect.x
    let y = layer.rect.y
    switch (positioning.anchor) {
      case 'top-left':
        x = marginX
        y = marginY
        break
      case 'top-center':
        x = (1 - targetWidth) / 2
        y = marginY
        break
      case 'top-right':
        x = 1 - targetWidth - marginX
        y = marginY
        break
      case 'bottom-left':
        x = marginX
        y = 1 - targetHeight - marginY
        break
      case 'bottom-center':
        x = (1 - targetWidth) / 2
        y = 1 - targetHeight - marginY
        break
      case 'bottom-right':
        x = 1 - targetWidth - marginX
        y = 1 - targetHeight - marginY
        break
      case 'center':
        x = (1 - targetWidth) / 2
        y = (1 - targetHeight) / 2
        break
    }
    return [
      Math.max(0, Math.min(1 - targetWidth, x)),
      Math.max(0, Math.min(1 - targetHeight, y)),
      targetWidth,
      targetHeight,
    ]
  }
  if (layer.fit !== 'contain') return [layer.rect.x, layer.rect.y, layer.rect.w, layer.rect.h]
  const sourceAspect = Math.max(0.0001, sourceWidth / sourceHeight)
  const targetAspect = Math.max(
    0.0001,
    (layer.rect.w * canvasWidth) / Math.max(layer.rect.h * canvasHeight, 0.0001),
  )
  if (sourceAspect > targetAspect) {
    const height = layer.rect.w / sourceAspect
    return [layer.rect.x, layer.rect.y + (layer.rect.h - height) / 2, layer.rect.w, height]
  }
  const width = layer.rect.h * sourceAspect
  return [layer.rect.x + (layer.rect.w - width) / 2, layer.rect.y, width, layer.rect.h]
}

function resolvePositioning(
  positioning: CompositionLayer['positioning'],
  canvasWidth: number,
  canvasHeight: number,
): WatermarkPositioning | null {
  if (!positioning) return null
  if ('anchor' in positioning) return positioning
  const preferred = canvasWidth >= canvasHeight ? positioning.landscape : positioning.portrait
  return preferred ?? positioning.landscape ?? positioning.portrait ?? null
}

function blendState(mode: SupportedBlendMode): GPUBlendState {
  switch (mode) {
    case 'multiply':
      return {
        color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }
    case 'screen':
      return {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }
    case 'add':
      return {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }
    case 'normal':
      return {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }
  }
}

interface PreparedCompositionDraw {
  source: CachedImageTexture
  lut: CachedLutTexture
  restoreLut: CachedLutTexture
  curve: CachedCurveTexture
  mask: CachedMaskTexture
  uniforms: Float32Array
  pipeline: GPURenderPipeline
}

export class WebGpuCompositionRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas

  private runtime: WebGpuRuntime | null = null
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private format: GPUTextureFormat | null = null
  private sampler: GPUSampler | null = null
  private uniformBuffers: GPUBuffer[] = []
  private pipelines = new Map<SupportedBlendMode, GPURenderPipeline>()
  private imageTextures = new Map<string, CachedImageTexture>()
  private rasterizedLayerTextures = new Map<string, CachedImageTexture>()
  private videoTextures = new Map<string, CachedImageTexture>()
  private lutTextures = new Map<string, CachedLutTexture>()
  private curveTextures = new Map<string, CachedCurveTexture>()
  private maskTextures = new Map<string, CachedMaskTexture>()
  private identityLut: CachedLutTexture | null = null
  private identityCurve: CachedCurveTexture | null = null
  private identityMask: CachedMaskTexture | null = null
  private lastSubmitPromise: Promise<void> = Promise.resolve()
  private resolveImage: ((path: string) => Promise<WebGpuImageSource>) | null = null
  private resolveSource: ((layer: CompositionLayer) => Promise<WebGpuImageSource>) | null = null
  private resolveLut: ((path: string) => Promise<string>) | null = null
  private resolveMask: ((layer: CompositionLayer, path: string) => Promise<WebGpuMaskSource>) | null = null

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas
  }

  get isReady(): boolean {
    return this.runtime !== null && this.context !== null && this.pipelines.size === BLEND_MODES.length
  }

  get capabilities() {
    return this.runtime?.capabilities ?? null
  }

  async initialize(options: WebGpuCompositionRendererOptions): Promise<void> {
    const runtime = await WebGpuRuntime.create({
      onDeviceLost: (message) => options.onDeviceLost?.(message),
      onUncapturedError: (message) => options.onError?.(message),
    })
    try {
      const context = this.canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) throw new Error('无法创建 WebGPU 画布上下文')
      this.runtime = runtime
      this.device = runtime.device
      this.context = context
      this.format = runtime.capabilities.preferredCanvasFormat
      this.resolveImage = options.resolveImage
      this.resolveSource = options.resolveSource ?? null
      this.resolveLut = options.resolveLut ?? null
      this.resolveMask = options.resolveMask ?? null
      context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' })

      const module = this.device.createShaderModule({ label: 'webgpu-composition', code: COMPOSITION_SHADER })
      const layout = this.device.createBindGroupLayout({
        label: 'webgpu-composition-layout',
        entries: [
          { binding: 0, visibility: WEBGPU_FLAGS.fragmentStage, sampler: { type: 'filtering' } },
          { binding: 1, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float' } },
          { binding: 2, visibility: WEBGPU_FLAGS.vertexStage | WEBGPU_FLAGS.fragmentStage, buffer: { type: 'uniform' } },
          { binding: 3, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float', viewDimension: '3d' } },
          { binding: 4, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float', viewDimension: '3d' } },
          { binding: 5, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float' } },
          { binding: 6, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float' } },
        ],
      })
      const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] })
      for (const mode of BLEND_MODES) {
        this.pipelines.set(mode, this.device.createRenderPipeline({
          label: `webgpu-composition-${mode}`,
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vertexMain' },
          fragment: {
            module,
            entryPoint: 'fragmentMain',
            targets: [{ format: this.format, blend: blendState(mode) }],
          },
          primitive: { topology: 'triangle-list' },
        }))
      }
      this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    } catch (error) {
      runtime.destroy()
      throw new Error(formatWebGpuError(error))
    }
  }

  async render(composition: CompositionInput, time = 0): Promise<WebGpuCompositionRenderStats> {
    if (!this.device || !this.context || !this.sampler || !this.format) {
      throw new Error('WebGPU 合成渲染器尚未初始化')
    }
    if (!this.resolveImage) throw new Error('WebGPU 合成渲染器缺少图片加载器')
    if (composition.canvas.width < 1 || composition.canvas.height < 1) throw new Error('合成画布尺寸无效')

    this.setCanvasSize(composition.canvas.width, composition.canvas.height)
    const layers = [...composition.layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    const groupedInputs = new Map<string, CompositionLayer[]>()
    const groupedOutputs = new Map<string, CompositionLayer>()
    const topLevelLayers: CompositionLayer[] = []
    for (const layer of layers) {
      if (!layer.precomposeGroup) {
        topLevelLayers.push(layer)
      } else if (layer.precomposeRole === 'input') {
        const inputs = groupedInputs.get(layer.precomposeGroup) ?? []
        inputs.push(layer)
        groupedInputs.set(layer.precomposeGroup, inputs)
      } else if (layer.precomposeRole === 'output') {
        groupedOutputs.set(layer.precomposeGroup, layer)
      }
    }
    for (const output of groupedOutputs.values()) topLevelLayers.push(output)
    topLevelLayers.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

    const encoder = this.device.createCommandEncoder({ label: 'webgpu-composition-frame' })
    const transientTextures: GPUTexture[] = []
    let uniformOffset = 0
    const draws: PreparedCompositionDraw[] = []
    let renderedLayers = 0
    const start = performance.now()
    for (const layer of topLevelLayers) {
      if (layer.activeStart != null && time < layer.activeStart) continue
      if (layer.activeEnd != null && time >= layer.activeEnd) continue
      let sourceOverride: CachedImageTexture | undefined
      if (layer.precomposeGroup) {
        const inputs = groupedInputs.get(layer.precomposeGroup)
        if (!inputs) continue
        const groupResult = await this.renderPrecomposeGroup(
          inputs,
          composition.canvas.width,
          composition.canvas.height,
          time,
          encoder,
          uniformOffset,
          transientTextures,
        )
        uniformOffset += groupResult.uniformCount
        sourceOverride = groupResult.texture
      }
      const draw = await this.prepareDraw(
        layer,
        composition.canvas.width,
        composition.canvas.height,
        time,
        sourceOverride,
      )
      if (draw === HIDDEN_MASK) continue
      draws.push(draw)
    }
    renderedLayers += this.encodeDrawPass(
      encoder,
      this.context.getCurrentTexture().createView(),
      draws,
      uniformOffset,
    )
    this.device.queue.submit([encoder.finish()])
    const submitted = this.device.queue.onSubmittedWorkDone()
    this.lastSubmitPromise = submitted.then(() => {
      for (const texture of transientTextures) texture.destroy()
    })
    return { submitMs: performance.now() - start, layerCount: renderedLayers }
  }

  async waitForGpu(): Promise<void> {
    await this.lastSubmitPromise
  }

  async toBlob(format: 'png' | 'jpeg' | 'webp', quality = 100): Promise<Blob> {
    await this.waitForGpu()
    const mimeType = format === 'png' ? 'image/png' : `image/${format}`
    const normalizedQuality = Math.max(0, Math.min(1, quality / 100))
    const blob = 'convertToBlob' in this.canvas
      ? await this.canvas.convertToBlob({ type: mimeType, quality: normalizedQuality })
      : await new Promise<Blob | null>((resolve) => (this.canvas as HTMLCanvasElement).toBlob(
        resolve,
        mimeType,
        normalizedQuality,
      ))
    if (!blob) throw new Error('无法读取 WebGPU 合成画面')
    return blob
  }

  async toPngBlob(): Promise<Blob> {
    return this.toBlob('png')
  }

  destroy(): void {
    for (const image of this.imageTextures.values()) image.texture.destroy()
    for (const layer of this.rasterizedLayerTextures.values()) layer.texture.destroy()
    for (const video of this.videoTextures.values()) video.texture.destroy()
    for (const lut of this.lutTextures.values()) lut.texture.destroy()
    for (const curve of this.curveTextures.values()) curve.texture.destroy()
    for (const mask of this.maskTextures.values()) mask.texture.destroy()
    this.identityLut?.texture.destroy()
    this.identityCurve?.texture.destroy()
    this.identityMask?.texture.destroy()
    this.imageTextures.clear()
    this.rasterizedLayerTextures.clear()
    this.videoTextures.clear()
    this.lutTextures.clear()
    this.curveTextures.clear()
    this.maskTextures.clear()
    this.identityLut = null
    this.identityCurve = null
    this.identityMask = null
    for (const buffer of this.uniformBuffers) buffer.destroy()
    this.uniformBuffers = []
    this.runtime?.destroy()
    this.runtime = null
    this.device = null
    this.context = null
    this.sampler = null
    this.format = null
    this.resolveImage = null
    this.resolveSource = null
    this.resolveLut = null
    this.resolveMask = null
    this.pipelines.clear()
  }

  private setCanvasSize(width: number, height: number): void {
    if (!this.device || !this.context || !this.format) return
    if (this.canvas.width === width && this.canvas.height === height) return
    this.canvas.width = width
    this.canvas.height = height
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' })
  }

  private async prepareDraw(
    layer: CompositionLayer,
    canvasWidth: number,
    canvasHeight: number,
    time: number,
    sourceOverride?: CachedImageTexture,
  ): Promise<PreparedCompositionDraw | typeof HIDDEN_MASK> {
    const layerType = layer.layerType ?? 'media'
    const isLocalColorInput = layerType === 'local-color' && layer.precomposeRole === 'input'
    const canUseImageSource = layerType === 'media'
      || isLocalColorInput
      || ((layerType === 'logo' || layerType === 'decoration') && Boolean(layer.source.path))
    if (!sourceOverride && !canUseImageSource && !hasRasterizableWebGpuLayerContent(layer)) {
      throw new Error('当前图层缺少可显示内容')
    }

    const resolvedMask = resolveMaskForLayer(layer, time)
    if (resolvedMask === HIDDEN_MASK) return HIDDEN_MASK
    const rasterized = !sourceOverride && !canUseImageSource
    const source = sourceOverride
      ?? (rasterized
        ? await this.getRasterizedLayerTexture(layer, canvasWidth, canvasHeight)
        : await this.getLayerTexture(layer))
    const layoutLayer = sourceOverride || rasterized
      ? { ...layer, fit: 'stretch' as const, sourceRect: { x: 0, y: 0, w: 1, h: 1 } }
      : layer
    const targetRect = destinationRectForLayer(
      layoutLayer,
      source.width,
      source.height,
      canvasWidth,
      canvasHeight,
    )
    const sourceRect = sourceRectForLayer(
      layoutLayer,
      source.width,
      source.height,
      canvasWidth,
      canvasHeight,
    )
    const luts = await this.getLayerLuts(layer)
    const curve = this.getLayerCurve(layer.color)
    const mask = resolvedMask
      ? await this.getMaskTexture(layer, resolvedMask.path)
      : this.getIdentityMask()
    const revealProgress = layer.reveal
      ? compositionRevealProgress(layer.reveal, time)
      : 1
    const uniforms = createLayerUniforms(layer, targetRect, sourceRect, luts, resolvedMask, revealProgress, time)
    const mode = (layer.blendMode ?? 'normal') as SupportedBlendMode
    const pipeline = this.pipelines.get(BLEND_MODES.includes(mode) ? mode : 'normal')!
    return {
      source,
      lut: luts.creative,
      restoreLut: luts.restore ?? luts.creative,
      curve,
      mask,
      uniforms,
      pipeline,
    }
  }

  private async renderPrecomposeGroup(
    layers: CompositionLayer[],
    width: number,
    height: number,
    time: number,
    encoder: GPUCommandEncoder,
    uniformOffset: number,
    transientTextures: GPUTexture[],
  ): Promise<{ texture: CachedImageTexture; uniformCount: number }> {
    if (!this.device || !this.format) throw new Error('WebGPU 合成渲染器尚未初始化')
    const texture = this.device.createTexture({
      label: 'webgpu-composition-precompose',
      size: { width, height },
      format: this.format,
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureRenderAttachment,
    })
    transientTextures.push(texture)
    const draws: PreparedCompositionDraw[] = []
    for (const layer of [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))) {
      if (layer.activeStart != null && time < layer.activeStart) continue
      if (layer.activeEnd != null && time >= layer.activeEnd) continue
      const draw = await this.prepareDraw(layer, width, height, time)
      if (draw !== HIDDEN_MASK) draws.push(draw)
    }
    const uniformCount = this.encodeDrawPass(
      encoder,
      texture.createView(),
      draws,
      uniformOffset,
    )
    return {
      texture: { texture, view: texture.createView(), width, height },
      uniformCount,
    }
  }

  private encodeDrawPass(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    draws: PreparedCompositionDraw[],
    uniformOffset: number,
  ): number {
    if (!this.device || !this.sampler) throw new Error('WebGPU 合成渲染器尚未初始化')
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    for (const [index, draw] of draws.entries()) {
      const uniformBuffer = this.ensureUniformBuffer(uniformOffset + index)
      this.device.queue.writeBuffer(uniformBuffer, 0, draw.uniforms)
      const bindGroup = this.device.createBindGroup({
        layout: draw.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: draw.source.view },
          { binding: 2, resource: { buffer: uniformBuffer } },
          { binding: 3, resource: draw.lut.view },
          { binding: 4, resource: draw.restoreLut.view },
          { binding: 5, resource: draw.curve.view },
          { binding: 6, resource: draw.mask.view },
        ],
      })
      pass.setPipeline(draw.pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(6)
    }
    pass.end()
    return draws.length
  }

  private async getImageTexture(path: string): Promise<CachedImageTexture> {
    if (!this.device || !this.resolveImage) throw new Error('WebGPU 图片渲染器尚未初始化')
    const cached = this.imageTextures.get(path)
    if (cached) return cached
    const source = await this.resolveImage(path)
    const { width, height } = getWebGpuSourceDimensions(source)
    if (width < 1 || height < 1) throw new Error(`图片尺寸无效: ${path}`)
    const texture = this.device.createTexture({
      label: `webgpu-composition-image:${path}`,
      size: { width, height },
      format: 'rgba8unorm',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst | WEBGPU_FLAGS.textureRenderAttachment,
    })
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture },
      { width, height },
    )
    const entry = { texture, view: texture.createView(), width, height }
    this.imageTextures.set(path, entry)
    return entry
  }

  private async getRasterizedLayerTexture(
    layer: CompositionLayer,
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<CachedImageTexture> {
    if (!this.device) throw new Error('WebGPU 图层渲染器尚未初始化')
    const key = `${canvasWidth}x${canvasHeight}:${JSON.stringify(layer)}`
    const cached = this.rasterizedLayerTextures.get(key)
    if (cached) return cached

    const rasterized = await rasterizeWebGpuLayer(layer, canvasWidth, canvasHeight)
    const texture = this.device.createTexture({
      label: `webgpu-composition-layer:${layer.layerType ?? 'unknown'}`,
      size: { width: rasterized.width, height: rasterized.height },
      format: 'rgba8unorm',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst | WEBGPU_FLAGS.textureRenderAttachment,
    })
    this.device.queue.copyExternalImageToTexture(
      { source: rasterized.canvas, flipY: false },
      { texture },
      { width: rasterized.width, height: rasterized.height },
    )
    const entry = {
      texture,
      view: texture.createView(),
      width: rasterized.width,
      height: rasterized.height,
    }
    this.rasterizedLayerTextures.set(key, entry)
    return entry
  }

  private async getLayerTexture(layer: CompositionLayer): Promise<CachedImageTexture> {
    if (layer.source.sourceType !== 'video') return this.getImageTexture(layer.source.path)
    if (!this.device || !this.resolveSource) {
      throw new Error('WebGPU 视频图层缺少视频源')
    }

    const source = await this.resolveSource(layer)
    const { width, height } = getWebGpuSourceDimensions(source)
    if (width < 1 || height < 1) throw new Error(`视频尺寸无效: ${layer.source.path}`)

    const sourceKey = layer.source.key ?? layer.source.path
    let cached = this.videoTextures.get(sourceKey)
    if (!cached || cached.width !== width || cached.height !== height) {
      cached?.texture.destroy()
      const texture = this.device.createTexture({
        label: `webgpu-composition-video:${sourceKey}`,
        size: { width, height },
        format: 'rgba8unorm',
        usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst | WEBGPU_FLAGS.textureRenderAttachment,
      })
      cached = { texture, view: texture.createView(), width, height }
      this.videoTextures.set(sourceKey, cached)
    }
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: cached.texture },
      { width, height },
    )
    return cached
  }

  private async getLayerLuts(layer: CompositionLayer): Promise<{ creative: CachedLutTexture; restore: CachedLutTexture | null }> {
    const intensity = Math.max(0, Math.min(100, layer.lutIntensity ?? 100))
    const creative = layer.lutId && intensity > 0
      ? await this.getLutTexture(layer.lutId)
      : this.getIdentityLut()
    const restore = layer.restoreLutId
      ? await this.getLutTexture(layer.restoreLutId)
      : null
    return { creative, restore }
  }

  private getLayerCurve(color: RenderColorAdjustments | undefined): CachedCurveTexture {
    if (!this.device) throw new Error('WebGPU 合成渲染器尚未初始化')
    const key = webGpuColorCurveCacheKey(color?.curve)
    if (key === 'identity' && this.identityCurve) return this.identityCurve
    const cached = this.curveTextures.get(key)
    if (cached) return cached

    const texture = this.device.createTexture({
      label: `webgpu-composition-curve:${key}`,
      size: { width: WEBGPU_CURVE_LUT_WIDTH, height: 1 },
      format: 'rgba8unorm',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst,
    })
    this.device.queue.writeTexture(
      { texture },
      buildWebGpuColorCurveLut(color?.curve),
      { bytesPerRow: WEBGPU_CURVE_LUT_WIDTH * 4, rowsPerImage: 1 },
      { width: WEBGPU_CURVE_LUT_WIDTH, height: 1, depthOrArrayLayers: 1 },
    )
    const entry: CachedCurveTexture = { key, texture, view: texture.createView() }
    if (key === 'identity') this.identityCurve = entry
    else this.curveTextures.set(key, entry)
    return entry
  }

  private async getMaskTexture(layer: CompositionLayer, path: string): Promise<CachedMaskTexture> {
    if (!this.device || !this.resolveMask) throw new Error('WebGPU 合成渲染器缺少蒙版加载器')
    const key = `${layer.maskProjectId ?? ''}\u0000${path}`
    const cached = this.maskTextures.get(key)
    if (cached) return cached

    const source = await this.resolveMask(layer, path)
    const encoded = encodeWebGpuMaskTexture(source)
    const texture = this.device.createTexture({
      label: `webgpu-composition-mask:${key}`,
      size: { width: source.width, height: source.height },
      format: 'rgba8unorm',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst,
    })
    this.device.queue.writeTexture(
      { texture },
      encoded.data,
      { bytesPerRow: encoded.bytesPerRow, rowsPerImage: source.height },
      { width: source.width, height: source.height, depthOrArrayLayers: 1 },
    )
    const entry = {
      texture,
      view: texture.createView(),
      width: source.width,
      height: source.height,
    }
    this.maskTextures.set(key, entry)
    return entry
  }

  private getIdentityMask(): CachedMaskTexture {
    if (this.identityMask) return this.identityMask
    if (!this.device) throw new Error('WebGPU 合成渲染器尚未初始化')
    const texture = this.device.createTexture({
      label: 'webgpu-composition-mask:identity',
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst,
    })
    this.device.queue.writeTexture(
      { texture },
      new Uint8Array([255, 255, 255, 255, ...new Array<number>(252).fill(0)]),
      { bytesPerRow: 256, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    )
    this.identityMask = { texture, view: texture.createView(), width: 1, height: 1 }
    return this.identityMask
  }

  private async getLutTexture(path: string): Promise<CachedLutTexture> {
    if (!this.device || !this.resolveLut) throw new Error('WebGPU 合成渲染器缺少 LUT 加载器')

    const cached = this.lutTextures.get(path)
    if (cached) return cached

    const parsed = parseWebGpuLut(await this.resolveLut(path))
    const texture = this.createLutTexture(`webgpu-composition-lut:${path}`, parsed)
    const entry: CachedLutTexture = {
      ...parsed,
      texture,
      view: texture.createView({ dimension: '3d' }),
    }
    this.lutTextures.set(path, entry)
    return entry
  }

  private getIdentityLut(): CachedLutTexture {
    if (this.identityLut) return this.identityLut
    if (!this.device) throw new Error('WebGPU 合成渲染器尚未初始化')
    const parsed = identityWebGpuLut()
    const texture = this.createLutTexture('webgpu-composition-lut:identity', parsed)
    this.identityLut = {
      ...parsed,
      texture,
      view: texture.createView({ dimension: '3d' }),
    }
    return this.identityLut
  }

  private createLutTexture(label: string, lut: WebGpuLutData): GPUTexture {
    if (!this.device) throw new Error('WebGPU 合成渲染器尚未初始化')
    const texture = this.device.createTexture({
      label,
      size: { width: lut.size, height: lut.size, depthOrArrayLayers: lut.size },
      format: 'rgba8unorm',
      dimension: '3d',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst,
    })
    const upload = paddedLutData(lut)
    this.device.queue.writeTexture(
      { texture },
      upload.data,
      { bytesPerRow: upload.bytesPerRow, rowsPerImage: lut.size },
      { width: lut.size, height: lut.size, depthOrArrayLayers: lut.size },
    )
    return texture
  }

  private ensureUniformBuffer(index: number): GPUBuffer {
    if (!this.device) throw new Error('WebGPU 合成渲染器尚未初始化')
    const existing = this.uniformBuffers[index]
    if (existing) return existing
    const buffer = this.device.createBuffer({
      label: `webgpu-composition-uniforms-${index}`,
      size: LAYER_UNIFORM_BYTES,
      usage: WEBGPU_FLAGS.bufferUniform | WEBGPU_FLAGS.bufferCopyDst,
    })
    this.uniformBuffers[index] = buffer
    return buffer
  }
}
