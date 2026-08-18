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
import { hasRasterizableWebGpuLayerContent, rasterizeWebGpuLayer, type WebGpuFontResolver } from './layer-rasterizer'
import { maskTimelineSampleAt } from '../../workspace/mask/maskTimeline'
import { maskTrackTransformAt } from '../../workspace/mask/maskTrack'
import { shouldSwapOrientation } from '../../workspace/transform/cropGeometry'
import { compositionRevealProgress } from '../revealProgress'

export interface WebGpuCompositionRenderStats {
  submitMs: number
  layerCount: number
}

export interface WebGpuCompositionRendererOptions {
  resolveImage: (path: string) => Promise<WebGpuImageSource>
  resolveSource?: (layer: CompositionLayer) => Promise<WebGpuImageSource>
  resolveFont?: WebGpuFontResolver
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
const BLUR_BUFFER_SCALE = 0.5
const LAYER_UNIFORM_FLOATS = 44 * 4
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
  pixelStretch: vec4f,
  pixelStretchExtra: vec4f,
  pixelStretchCenter: vec4f,
  pixelStretchPathMeta: vec4f,
  pixelStretchPathData: array<vec4f, 4>,
  crop: vec4f,
  geometry: vec4f,
  effects: vec4f,
  shape: vec4f,
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
  let framePosition = layer.crop.xy + sourcePosition * layer.crop.zw;
  var centered = (framePosition - vec2f(0.5, 0.5)) * vec2f(max(layer.geometry.x, 0.0001), 1.0);
  centered = centered / max(layer.transform.x, 0.0001) - layer.reveal.yz;
  let angle = layer.transform.y;
  let sourceCentered = vec2f(
    centered.x * cos(angle) + centered.y * sin(angle),
    -centered.x * sin(angle) + centered.y * cos(angle)
  );
  var sourceLocal = sourceCentered / vec2f(max(layer.geometry.y, 0.0001), 1.0) + vec2f(0.5, 0.5);
  if (layer.transform.z > 0.5) { sourceLocal.x = 1.0 - sourceLocal.x; }
  if (layer.transform.w > 0.5) { sourceLocal.y = 1.0 - sourceLocal.y; }
  let canvasPosition = layer.rect.xy + sourcePosition * layer.rect.zw;

  var output: VertexOutput;
  output.position = vec4f(canvasPosition.x * 2.0 - 1.0, 1.0 - canvasPosition.y * 2.0, 0.0, 1.0);
  output.uv = layer.sourceRect.xy + sourceLocal * layer.sourceRect.zw;
  output.localPosition = sourcePosition;
  return output;
}

fn sourceUvIsValid(uv: vec2f) -> bool {
  let local = (uv - layer.sourceRect.xy) / max(layer.sourceRect.zw, vec2f(0.0001));
  return local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0;
}

fn samplePremultipliedSource(uv: vec2f) -> vec4f {
  let sampled = textureSampleLevel(
    sourceTexture,
    sourceSampler,
    clamp(uv, vec2f(0.0), vec2f(1.0)),
    0.0,
  );
  return vec4f(sampled.rgb * sampled.a, sampled.a);
}

// Small watermarks are minified heavily in the workbench. A single bilinear
// sample preserves sharpness but aliases transparent diagonals and fine text.
// Resolve the covered source footprint with premultiplied-alpha taps so the
// transparent edge does not turn into a dark halo.
fn sampleLayerSource(uv: vec2f) -> vec4f {
  let direct = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
  let sourceSize = vec2f(textureDimensions(sourceTexture, 0));
  let derivativeX = dpdx(uv);
  let derivativeY = dpdy(uv);
  let footprintX = length(derivativeX * sourceSize);
  let footprintY = length(derivativeY * sourceSize);
  if (layer.shape.y <= 0.5) {
    return direct;
  }

  if (max(footprintX, footprintY) <= 1.25) {
    return direct;
  }

  let offsetX = derivativeX * 0.5;
  let offsetY = derivativeY * 0.5;
  var sum = samplePremultipliedSource(uv - offsetX - offsetY);
  sum += samplePremultipliedSource(uv - offsetY);
  sum += samplePremultipliedSource(uv + offsetX - offsetY);
  sum += samplePremultipliedSource(uv - offsetX);
  sum += samplePremultipliedSource(uv);
  sum += samplePremultipliedSource(uv + offsetX);
  sum += samplePremultipliedSource(uv - offsetX + offsetY);
  sum += samplePremultipliedSource(uv + offsetY);
  sum += samplePremultipliedSource(uv + offsetX + offsetY);
  let alpha = sum.a / 9.0;
  return vec4f((sum.rgb / 9.0) / max(alpha, 0.0001), alpha);
}

fn roundedRectDistanceWithAspect(local: vec2f, radius: f32, aspect: f32) -> f32 {
  let safeAspect = max(aspect, 0.0001);
  let point = abs(local - vec2f(0.5)) * vec2f(safeAspect, 1.0);
  let halfSize = vec2f(0.5 * safeAspect, 0.5);
  let clampedRadius = clamp(radius, 0.0, min(halfSize.x, halfSize.y));
  let corner = point - (halfSize - vec2f(clampedRadius));
  return length(max(corner, vec2f(0.0))) + min(max(corner.x, corner.y), 0.0) - clampedRadius;
}

fn roundedRectCoverage(local: vec2f) -> f32 {
  let distance = roundedRectDistanceWithAspect(local, layer.geometry.z, layer.shape.x);
  let feather = max(layer.geometry.w, 0.0);
  let edgeWidth = max(max(fwidth(distance) * 1.5, feather), 0.0001);
  return 1.0 - smoothstep(0.0, edgeWidth, distance);
}

fn layerCoverage(local: vec2f) -> f32 {
  let outer = roundedRectCoverage(local);
  if (layer.effects.y <= 0.5) {
    return outer;
  }

  let radius = clamp(layer.geometry.z, 0.0, 0.5);
  let inset = clamp(layer.effects.zw, vec2f(0.0), vec2f(0.49));
  let innerSize = max(vec2f(1.0) - inset * 2.0, vec2f(0.0001));
  let innerLocal = (local - inset) / innerSize;
  let outerAspect = max(layer.shape.x, 0.0001);
  let innerAspect = outerAspect * innerSize.x / innerSize.y;
  let insetDistance = max(inset.x * outerAspect, inset.y);
  let innerRadius = max(0.0, layer.geometry.z - insetDistance);
  let innerDistance = roundedRectDistanceWithAspect(innerLocal, innerRadius, innerAspect);
  let fadeX = max(inset.x * outerAspect, 0.0001);
  let fadeY = max(inset.y, 0.0001);
  let distanceFromCenter = abs(local - vec2f(0.5));
  let axisWeight = distanceFromCenter.x / max(distanceFromCenter.x + distanceFromCenter.y, 0.0001);
  let fadeWidth = mix(fadeY, fadeX, axisWeight);
  // Keep the shadow outside the photo and use a Gaussian falloff instead of
  // a solid ring. Three sigma fit inside the expanded layer so the blur does
  // not get hard-clipped at a single canvas edge.
  let outsideDistance = max(innerDistance, 0.0);
  let sigma = max(fadeWidth / 3.2, 0.0001);
  let gaussianFade = exp(-0.5 * (outsideDistance / sigma) * (outsideDistance / sigma));
  let outsideShadow = select(0.0, gaussianFade, innerDistance > 0.0);
  let outerDistance = roundedRectDistanceWithAspect(local, radius, outerAspect);
  let outerInsideDistance = max(-outerDistance, 0.0);
  let outerFadeWidth = max(fadeWidth * 0.7, fwidth(outerDistance) * 2.0);
  let outerFade = smoothstep(0.0, outerFadeWidth, outerInsideDistance);
  return outer * outerFade * outsideShadow;
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
  // 13 weighted taps approximate a small separable Gaussian while keeping
  // the background layer cheap enough for realtime video preview.
  let step = texel * max(radius * 0.75, 0.5);
  let outer = step * 2.0;
  var total = vec3f(0.0);
  total = total + sampleSource(uv) * 0.24;
  total = total + sampleSource(uv + vec2f(-step.x, 0.0)) * 0.11;
  total = total + sampleSource(uv + vec2f(step.x, 0.0)) * 0.11;
  total = total + sampleSource(uv + vec2f(0.0, -step.y)) * 0.11;
  total = total + sampleSource(uv + vec2f(0.0, step.y)) * 0.11;
  total = total + sampleSource(uv + vec2f(-step.x, -step.y)) * 0.055;
  total = total + sampleSource(uv + vec2f(step.x, -step.y)) * 0.055;
  total = total + sampleSource(uv + vec2f(-step.x, step.y)) * 0.055;
  total = total + sampleSource(uv + vec2f(step.x, step.y)) * 0.055;
  total = total + sampleSource(uv + vec2f(-outer.x, 0.0)) * 0.025;
  total = total + sampleSource(uv + vec2f(outer.x, 0.0)) * 0.025;
  total = total + sampleSource(uv + vec2f(0.0, -outer.y)) * 0.025;
  total = total + sampleSource(uv + vec2f(0.0, outer.y)) * 0.025;
  return total;
}

fn applySpatialDetail(cIn: vec3f, uv: vec2f) -> vec3f {
  let detail = layer.detail;
  let detailExtra = layer.detailExtra;
  let hasExplicitBlur = layer.effects.x > 0.0001;
  let denoise = select(clamp((detailExtra.x + detailExtra.y) / 100.0, 0.0, 1.0), 1.0, hasExplicitBlur);
  let localContrast = detail.y / 100.0 * 0.7 + detail.z / 100.0 * 0.35;
  let sharpen = clamp(detail.w / 100.0, 0.0, 2.0) * 0.65;
  let glow = clamp(detailExtra.z / 100.0, 0.0, 1.0);
  if (denoise <= 0.0001 && abs(localContrast) <= 0.0001 && sharpen <= 0.0001 && glow <= 0.0001) {
    return cIn;
  }

  let blurRadius = select(detailExtra.w / 18.0, layer.effects.x, layer.effects.x > 0.0001);
  let blurred = blurSource(uv, max(blurRadius, 0.25));
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
  if (amount < 0.0) {
    tintTarget = vec3f(1.0) - tintTarget;
  }
  return mix(cIn, cIn * mix(vec3f(1.0), tintTarget, clamp(abs(amount) / 100.0, 0.0, 1.0)), mask);
}

fn hueDistance(left: f32, right: f32) -> f32 {
  let direct = abs(left - right);
  return min(direct, 360.0 - direct);
}

fn applyHslChannel(cIn: vec3f, params: vec4f) -> vec3f {
  if (abs(params.y) + abs(params.z) + abs(params.w) <= 0.0001) {
    return cIn;
  }
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

// Tetrahedral interpolation adapted from the open-source Flashback RAW editor
// shader. Trilinear filtering can change slope at LUT cell boundaries; this
// chooses one of the six tetrahedra in the cell and keeps the color gradient
// continuous, which is especially visible in skin tones and low-saturation
// footage.
fn lutTexel(texture: texture_3d<f32>, r: u32, g: u32, b: u32) -> vec3f {
  return textureLoad(texture, vec3i(i32(r), i32(g), i32(b)), 0).rgb;
}

fn sampleLut(texture: texture_3d<f32>, color: vec3f, size: f32) -> vec3f {
  let maxIndex = u32(max(size - 1.0, 1.0));
  let scaled = clamp(color, vec3f(0.0), vec3f(1.0)) * f32(maxIndex);
  let r0 = min(u32(scaled.x), maxIndex - 1u);
  let g0 = min(u32(scaled.y), maxIndex - 1u);
  let b0 = min(u32(scaled.z), maxIndex - 1u);
  let rx = scaled.x - f32(r0);
  let gx = scaled.y - f32(g0);
  let bx = scaled.z - f32(b0);
  let c000 = lutTexel(texture, r0, g0, b0);
  let c111 = lutTexel(texture, r0 + 1u, g0 + 1u, b0 + 1u);

  if (rx >= gx && gx >= bx) {
    let c100 = lutTexel(texture, r0 + 1u, g0, b0);
    let c110 = lutTexel(texture, r0 + 1u, g0 + 1u, b0);
    return (1.0 - rx) * c000 + (rx - gx) * c100 + (gx - bx) * c110 + bx * c111;
  }
  if (rx >= bx && bx > gx) {
    let c100 = lutTexel(texture, r0 + 1u, g0, b0);
    let c101 = lutTexel(texture, r0 + 1u, g0, b0 + 1u);
    return (1.0 - rx) * c000 + (rx - bx) * c100 + (bx - gx) * c101 + gx * c111;
  }
  if (gx > rx && rx >= bx) {
    let c010 = lutTexel(texture, r0, g0 + 1u, b0);
    let c110 = lutTexel(texture, r0 + 1u, g0 + 1u, b0);
    return (1.0 - gx) * c000 + (gx - rx) * c010 + (rx - bx) * c110 + bx * c111;
  }
  if (bx > rx && rx >= gx) {
    let c001 = lutTexel(texture, r0, g0, b0 + 1u);
    let c101 = lutTexel(texture, r0 + 1u, g0, b0 + 1u);
    return (1.0 - bx) * c000 + (bx - rx) * c001 + (rx - gx) * c101 + gx * c111;
  }
  if (gx >= bx && bx > rx) {
    let c010 = lutTexel(texture, r0, g0 + 1u, b0);
    let c011 = lutTexel(texture, r0, g0 + 1u, b0 + 1u);
    return (1.0 - gx) * c000 + (gx - bx) * c010 + (bx - rx) * c011 + rx * c111;
  }
  let c001 = lutTexel(texture, r0, g0, b0 + 1u);
  let c011 = lutTexel(texture, r0, g0 + 1u, b0 + 1u);
  return (1.0 - bx) * c000 + (bx - gx) * c001 + (gx - rx) * c011 + rx * c111;
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

fn pixelStretchMask(uv: vec2f) -> f32 {
  let value = textureSampleLevel(maskTexture, sourceSampler, uv, 0.0).r;
  return select(value, 1.0 - value, layer.mask.y > 0.5);
}

fn pixelStretchPathControl(index: i32) -> vec2f {
  let scalarIndex = index * 2;
  let first = scalarIndex / 4;
  let offset = scalarIndex % 4;
  if (offset == 0) { return layer.pixelStretchPathData[first].xy; }
  return layer.pixelStretchPathData[first].zw;
}

fn pixelStretchPathPoint(t: f32) -> vec2f {
  let segment = select(0, 1, t >= 0.5);
  let localT = select(t * 2.0, (t - 0.5) * 2.0, segment == 1);
  let base = segment * 3;
  let p0 = pixelStretchPathControl(base);
  let p1 = pixelStretchPathControl(base + 1);
  let p2 = pixelStretchPathControl(base + 2);
  let p3 = pixelStretchPathControl(base + 3);
  let inverseT = 1.0 - localT;
  return inverseT * inverseT * inverseT * p0
    + 3.0 * inverseT * inverseT * localT * p1
    + 3.0 * inverseT * localT * localT * p2
    + localT * localT * localT * p3;
}

fn pixelStretchPathDerivative(t: f32) -> vec2f {
  let segment = select(0, 1, t >= 0.5);
  let localT = select(t * 2.0, (t - 0.5) * 2.0, segment == 1);
  let base = segment * 3;
  let p0 = pixelStretchPathControl(base);
  let p1 = pixelStretchPathControl(base + 1);
  let p2 = pixelStretchPathControl(base + 2);
  let p3 = pixelStretchPathControl(base + 3);
  let inverseT = 1.0 - localT;
  return 6.0 * (inverseT * inverseT * (p1 - p0)
    + 2.0 * inverseT * localT * (p2 - p1)
    + localT * localT * (p3 - p2));
}

fn pixelStretchPathSecondDerivative(t: f32) -> vec2f {
  let segment = select(0, 1, t >= 0.5);
  let localT = select(t * 2.0, (t - 0.5) * 2.0, segment == 1);
  let base = segment * 3;
  let p0 = pixelStretchPathControl(base);
  let p1 = pixelStretchPathControl(base + 1);
  let p2 = pixelStretchPathControl(base + 2);
  let p3 = pixelStretchPathControl(base + 3);
  return 24.0 * mix(p2 - 2.0 * p1 + p0, p3 - 2.0 * p2 + p1, localT);
}

fn pixelStretchSampleSeed(rangeT: f32, horizontal: bool) -> vec2f {
  let inverseT = 1.0 - rangeT;
  let start = select(layer.pixelStretch.w, layer.pixelStretch.z, horizontal);
  let along = inverseT * inverseT * inverseT * start
    + 3.0 * inverseT * inverseT * rangeT * layer.pixelStretchCenter.z
    + 3.0 * inverseT * rangeT * rangeT * layer.pixelStretchCenter.w
    + rangeT * rangeT * rangeT * layer.pixelStretchExtra.y;
  let across = mix(layer.pixelStretchExtra.z, layer.pixelStretchExtra.w, rangeT);
  return select(vec2f(across, along), vec2f(along, across), horizontal);
}

fn pixelStretchSeedValid(seed: vec2f) -> bool {
  return seed.x >= 0.0 && seed.x <= 1.0 && seed.y >= 0.0 && seed.y <= 1.0
    && pixelStretchMask(seed) >= 0.5;
}

fn pixelStretchSCurvePoint(t: f32, originX: f32, amplitude: f32, aspect: f32) -> vec2f {
  let y = mix(-0.12, 1.12, t);
  let x = originX - amplitude * sin(t * 6.28318530718);
  return vec2f((x - originX) * aspect, y);
}

fn pixelStretchEffect(uv: vec2f) -> vec4f {
  if (layer.pixelStretch.x <= 0.5) {
    let sampled = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
    return sampled;
  }
  let stretchMode = layer.pixelStretch.x;
  let isSCurve = stretchMode > 2.5 && stretchMode < 4.5;
  if (!isSCurve && pixelStretchMask(uv) > 0.5) {
    return vec4f(0.0);
  }
  let amount = clamp(layer.pixelStretch.y / 100.0, 0.0, 1.0);
  let origin = vec2f(layer.pixelStretch.z, layer.pixelStretch.w);
  let sourceSize = vec2f(textureDimensions(sourceTexture, 0));
  let aspect = max(sourceSize.x / max(sourceSize.y, 1.0), 0.0001);
  let center = layer.pixelStretchCenter.xy;
  let rotation = layer.pixelStretchExtra.x * 0.017453292519943;
  let rotationCos = cos(rotation);
  let rotationSin = sin(rotation);
  let rotatedDelta = (uv - center) * vec2f(aspect, 1.0);
  let unrotatedDelta = vec2f(
    rotatedDelta.x * rotationCos + rotatedDelta.y * rotationSin,
    -rotatedDelta.x * rotationSin + rotatedDelta.y * rotationCos,
  );
  let effectCoord = center + unrotatedDelta / vec2f(aspect, 1.0);
  let lineEnd = layer.pixelStretchExtra.y;
  let controlStart = layer.pixelStretchCenter.z;
  let controlEnd = layer.pixelStretchCenter.w;
  let sampleStart = layer.pixelStretchExtra.z;
  let sampleEnd = layer.pixelStretchExtra.w;
  let isHorizontal = stretchMode < 1.5
    || (stretchMode > 4.5 && stretchMode < 5.5)
    || (stretchMode > 6.5 && stretchMode < 7.5);
  let isVertical = (stretchMode > 1.5 && stretchMode < 2.5)
    || (stretchMode > 5.5 && stretchMode < 6.5)
    || stretchMode > 7.5;
  var seed = vec2f(origin.x, uv.y);
  var sampleRangeT = 0.5;
  var edgeCoverage = 1.0;

  if (layer.pixelStretchPathMeta.x > 0.5) {
    let position = effectCoord * vec2f(aspect, 1.0);
    var bestT = 0.0;
    var bestPoint = pixelStretchPathPoint(0.0) * vec2f(aspect, 1.0);
    var bestDistance = dot(position - bestPoint, position - bestPoint);
    for (var index = 1; index < 32; index = index + 1) {
      let pathT = f32(index) / 31.0;
      let point = pixelStretchPathPoint(pathT) * vec2f(aspect, 1.0);
      let distance = dot(position - point, position - point);
      if (distance < bestDistance) {
        bestT = pathT;
        bestPoint = point;
        bestDistance = distance;
      }
    }
    let coarseStep = 1.0 / 31.0;
    let refineStart = max(0.0, bestT - coarseStep);
    let refineEnd = min(1.0, bestT + coarseStep);
    for (var index = 0; index < 6; index = index + 1) {
      let point = pixelStretchPathPoint(bestT) * vec2f(aspect, 1.0);
      let derivative = pixelStretchPathDerivative(bestT) * vec2f(aspect, 1.0);
      let secondDerivative = pixelStretchPathSecondDerivative(bestT) * vec2f(aspect, 1.0);
      let delta = point - position;
      let denominator = dot(derivative, derivative) + dot(delta, secondDerivative);
      if (abs(denominator) > 0.0000001) {
        bestT = clamp(bestT - dot(delta, derivative) / denominator, refineStart, refineEnd);
      }
    }
    bestPoint = pixelStretchPathPoint(bestT) * vec2f(aspect, 1.0);
    let pathStart = pixelStretchPathPoint(0.0) * vec2f(aspect, 1.0);
    let pathStartDelta = pixelStretchPathDerivative(0.0) * vec2f(aspect, 1.0);
    let pathStartFallback = (pixelStretchPathPoint(0.01) - pixelStretchPathPoint(0.0)) * vec2f(aspect, 1.0);
    let pathStartTangent = select(
      pathStartFallback / max(length(pathStartFallback), 0.000001),
      pathStartDelta / max(length(pathStartDelta), 0.000001),
      dot(pathStartDelta, pathStartDelta) > 0.0000001,
    );
    let pathEnd = pixelStretchPathPoint(1.0) * vec2f(aspect, 1.0);
    let pathEndDelta = pixelStretchPathDerivative(1.0) * vec2f(aspect, 1.0);
    let pathEndFallback = (pixelStretchPathPoint(1.0) - pixelStretchPathPoint(0.99)) * vec2f(aspect, 1.0);
    let pathEndTangent = select(
      pathEndFallback / max(length(pathEndFallback), 0.000001),
      pathEndDelta / max(length(pathEndDelta), 0.000001),
      dot(pathEndDelta, pathEndDelta) > 0.0000001,
    );
    if (dot(position - pathStart, pathStartTangent) < 0.0) {
      bestT = 0.0;
      bestPoint = pathStart;
    } else if (dot(position - pathEnd, pathEndTangent) > 0.0) {
      bestT = 1.0;
      bestPoint = pathEnd;
    }
    let tangentDelta = pixelStretchPathDerivative(bestT) * vec2f(aspect, 1.0);
    if (dot(tangentDelta, tangentDelta) < 0.0000001) {
      return vec4f(0.0);
    }
    let tangent = normalize(tangentDelta);
    let normal = vec2f(-tangent.y, tangent.x);
    let signedDistance = dot(position - bestPoint, normal);
    let fullWidth = mix(layer.pixelStretchPathMeta.y, layer.pixelStretchPathMeta.z, bestT);
    let halfWidth = max(0.0005, fullWidth * 0.5);
    var distanceFromCenterline = abs(signedDistance);
    if ((bestT <= 0.00001 && dot(position - bestPoint, tangent) < 0.0)
      || (bestT >= 0.99999 && dot(position - bestPoint, tangent) > 0.0)) {
      distanceFromCenterline = length(position - bestPoint);
    }
    let edgeDistance = halfWidth - distanceFromCenterline;
    let edgeAA = max(1.5 / max(sourceSize.y, 1.0), 0.00001);
    if (edgeDistance < -edgeAA) {
      return vec4f(0.0);
    }
    edgeCoverage = smoothstep(-edgeAA, edgeAA, edgeDistance);
    sampleRangeT = clamp(signedDistance / fullWidth + 0.5, 0.0, 1.0);
    seed = pixelStretchSampleSeed(sampleRangeT, isHorizontal);
  } else if (isHorizontal) {
    let rangeMin = min(sampleStart, sampleEnd);
    let rangeMax = max(sampleStart, sampleEnd);
    let crossDistance = min(effectCoord.y - rangeMin, rangeMax - effectCoord.y);
    let crossAA = max(1.5 / max(sourceSize.y, 1.0), 0.00001);
    if (crossDistance < -crossAA) {
      return vec4f(0.0);
    }
    edgeCoverage = smoothstep(-crossAA, crossAA, crossDistance);
    let rangeDelta = sampleEnd - sampleStart;
    let safeRangeDelta = select(min(rangeDelta, -0.0001), max(rangeDelta, 0.0001), rangeDelta >= 0.0);
    sampleRangeT = clamp((effectCoord.y - sampleStart) / safeRangeDelta, 0.0, 1.0);
    seed = pixelStretchSampleSeed(sampleRangeT, true);
    let sampleX = seed.x;
    var directionDistance = 2.0 - abs(effectCoord.x - sampleX);
    if (stretchMode < 1.5) {
      directionDistance = min(directionDistance, effectCoord.x - sampleX);
    } else if (stretchMode > 4.5 && stretchMode < 5.5) {
      directionDistance = min(directionDistance, sampleX - effectCoord.x);
    }
    let directionAA = max(1.5 / max(sourceSize.x, 1.0), 0.00001);
    if (directionDistance < -directionAA) {
      return vec4f(0.0);
    }
    edgeCoverage *= smoothstep(-directionAA, directionAA, directionDistance);
  } else if (isVertical) {
    let rangeMin = min(sampleStart, sampleEnd);
    let rangeMax = max(sampleStart, sampleEnd);
    let crossDistance = min(effectCoord.x - rangeMin, rangeMax - effectCoord.x);
    let crossAA = max(1.5 / max(sourceSize.x, 1.0), 0.00001);
    if (crossDistance < -crossAA) {
      return vec4f(0.0);
    }
    edgeCoverage = smoothstep(-crossAA, crossAA, crossDistance);
    let rangeDelta = sampleEnd - sampleStart;
    let safeRangeDelta = select(min(rangeDelta, -0.0001), max(rangeDelta, 0.0001), rangeDelta >= 0.0);
    sampleRangeT = clamp((effectCoord.x - sampleStart) / safeRangeDelta, 0.0, 1.0);
    seed = pixelStretchSampleSeed(sampleRangeT, false);
    let sampleY = seed.y;
    var directionDistance = 2.0 - abs(effectCoord.y - sampleY);
    if (stretchMode > 1.5 && stretchMode < 2.5) {
      directionDistance = min(directionDistance, effectCoord.y - sampleY);
    } else if (stretchMode > 5.5 && stretchMode < 6.5) {
      directionDistance = min(directionDistance, sampleY - effectCoord.y);
    }
    let directionAA = max(1.5 / max(sourceSize.y, 1.0), 0.00001);
    if (directionDistance < -directionAA) {
      return vec4f(0.0);
    }
    edgeCoverage *= smoothstep(-directionAA, directionAA, directionDistance);
  } else {
    let position = vec2f((uv.x - origin.x) * aspect, uv.y);
    let amplitude = mix(0.22, 0.38, amount);
    let halfWidth = mix(0.055, 0.10, amount);
    var bestT = 0.0;
    var bestPoint = pixelStretchSCurvePoint(0.0, origin.x, amplitude, aspect);
    var bestDistance = dot(position - bestPoint, position - bestPoint);
    for (var index = 1; index < 64; index = index + 1) {
      let t = f32(index) / 63.0;
      let point = pixelStretchSCurvePoint(t, origin.x, amplitude, aspect);
      let distance = dot(position - point, position - point);
      if (distance < bestDistance) {
        bestT = t;
        bestPoint = point;
        bestDistance = distance;
      }
    }
    if (bestDistance > halfWidth * halfWidth || (stretchMode > 3.5 && bestT < 0.76)) {
      return vec4f(0.0);
    }
    let before = pixelStretchSCurvePoint(max(0.0, bestT - 0.01), origin.x, amplitude, aspect);
    let after = pixelStretchSCurvePoint(min(1.0, bestT + 0.01), origin.x, amplitude, aspect);
    let tangent = normalize(after - before);
    let normal = vec2f(-tangent.y, tangent.x);
    let signedDistance = dot(position - bestPoint, normal);
    seed = vec2f(origin.x, origin.y + signedDistance / halfWidth * 0.5);
  }

  var validSeed = pixelStretchSeedValid(seed);
  if (!validSeed && layer.pixelStretchPathMeta.w > 0.5 && (isHorizontal || isVertical)) {
    for (var index = 1; index <= 48; index = index + 1) {
      let offset = f32(index) / 48.0;
      let beforeT = max(0.0, sampleRangeT - offset);
      let beforeSeed = pixelStretchSampleSeed(beforeT, isHorizontal);
      if (pixelStretchSeedValid(beforeSeed)) {
        seed = beforeSeed;
        validSeed = true;
        break;
      }
      let afterT = min(1.0, sampleRangeT + offset);
      let afterSeed = pixelStretchSampleSeed(afterT, isHorizontal);
      if (pixelStretchSeedValid(afterSeed)) {
        seed = afterSeed;
        validSeed = true;
        break;
      }
    }
  }
  if (!validSeed) {
    return vec4f(0.0);
  }
  let seedPixel = clamp(floor(seed * sourceSize), vec2f(0.0), sourceSize - vec2f(1.0));
  let seedCenter = (seedPixel + vec2f(0.5)) / sourceSize;
  let quarterTurn = round(rotation / 1.57079632679) * 1.57079632679;
  let needsRotationFilter = abs(rotation - quarterTurn) > 0.0001;
  let stretched = textureSampleLevel(sourceTexture, sourceSampler, select(seedCenter, seed, needsRotationFilter), 0.0);
  let adjusted = applyLut(applyColor(stretched.rgb, seed));
  let alpha = stretched.a * layer.style.x * edgeCoverage;
  return vec4f(adjusted, alpha);
}

@fragment
fn fragmentFastMain(input: VertexOutput) -> @location(0) vec4f {
  let revealProgress = clamp(layer.reveal.x, 0.0, 1.0);
  if (input.localPosition.x >= revealProgress) {
    discard;
  }
  if (!sourceUvIsValid(input.uv)) {
    discard;
  }
  let sampled = sampleLayerSource(input.uv);
  return vec4f(sampled.rgb, sampled.a * layer.style.x * layerCoverage(input.localPosition));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let revealProgress = clamp(layer.reveal.x, 0.0, 1.0);
  if (input.localPosition.x >= revealProgress) {
    discard;
  }
  if (!sourceUvIsValid(input.uv)) {
    discard;
  }
  let sampled = sampleLayerSource(input.uv);
  var maskValue = 1.0;
  if (layer.mask.w > 0.5) {
    maskValue = clamp(sampleMask(input.uv) * layer.mask.x, 0.0, 1.0);
  }
  let adjusted = applyLut(applyColor(sampled.rgb, input.uv));
  let isLocalColor = layer.mask.w > 1.5;
  var color = select(mix(sampled.rgb, adjusted, maskValue), adjusted, isLocalColor);
  var alpha = sampled.a * layer.style.x * select(1.0, maskValue, isLocalColor) * layerCoverage(input.localPosition);
  if (layer.pixelFlow.x > 0.5) {
    let effect = pixelFlowEffect(input.uv, vec4f(color, alpha), input.localPosition);
    color = effect.rgb;
    alpha = effect.a;
  }
  if (layer.pixelStretch.x > 0.5) {
    let effect = pixelStretchEffect(input.uv);
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

// Dual-Kawase blur adapted from the production kernels used by PixiJS and
// cosmic-comp. The source is progressively downsampled and then reconstructed
// with a weighted upsample. This keeps large background blurs smooth without
// the sparse-sample trails produced by a fixed fast Gaussian kernel.
const DUAL_KAWASE_SHADER = /* wgsl */ `
struct KawaseUniforms {
  sourceSize: vec2f,
  offset: f32,
  _padding: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var blurTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> blur: KawaseUniforms;

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
  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position.x * 2.0 - 1.0, 1.0 - position.y * 2.0, 0.0, 1.0);
  output.uv = position;
  return output;
}

fn normalizeBlur(color: vec4f, weight: f32) -> vec4f {
  if (color.a <= 0.0001) {
    return vec4f(0.0);
  }
  let alpha = color.a / weight;
  let unpremultiplied = color.rgb / max(color.a, 0.0001);
  return vec4f(unpremultiplied, alpha);
}

@fragment
fn fragmentDownMain(input: VertexOutput) -> @location(0) vec4f {
  let halfPixel = vec2f(0.5, 0.5) / max(blur.sourceSize, vec2f(1.0)) * blur.offset;
  var color = textureSampleLevel(blurTexture, blurSampler, input.uv, 0.0) * 4.0;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv - halfPixel, 0.0);
  color += textureSampleLevel(blurTexture, blurSampler, input.uv + halfPixel, 0.0);
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(halfPixel.x, -halfPixel.y),
    0.0,
  );
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv - vec2f(halfPixel.x, -halfPixel.y),
    0.0,
  );
  return normalizeBlur(color, 8.0);
}

@fragment
fn fragmentUpMain(input: VertexOutput) -> @location(0) vec4f {
  let halfPixel = vec2f(0.5, 0.5) / max(blur.sourceSize, vec2f(1.0)) * blur.offset;
  var color = textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(-halfPixel.x * 2.0, 0.0),
    0.0,
  );
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(-halfPixel.x, halfPixel.y),
    0.0,
  ) * 2.0;
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(0.0, halfPixel.y * 2.0),
    0.0,
  );
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(halfPixel.x, halfPixel.y),
    0.0,
  ) * 2.0;
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(halfPixel.x * 2.0, 0.0),
    0.0,
  );
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(halfPixel.x, -halfPixel.y),
    0.0,
  ) * 2.0;
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(0.0, -halfPixel.y * 2.0),
    0.0,
  );
  color += textureSampleLevel(
    blurTexture,
    blurSampler,
    input.uv + vec2f(-halfPixel.x, -halfPixel.y),
    0.0,
  ) * 2.0;
  return normalizeBlur(color, 12.0);
}
`

function colorValue(color: RenderColorAdjustments | undefined, key: keyof RenderColorAdjustments): number {
  const value = color?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function hasColorAdjustments(color: RenderColorAdjustments | undefined): boolean {
  if (!color) return false
  for (const [key, value] of Object.entries(color)) {
    if (key === 'levelsGray' && value === 0.5) continue
    if (key === 'levelsWhite' && value === 1) continue
    if (key === 'hslChannels') {
      if (Array.isArray(value) && value.some((channel) => (
        channel && typeof channel === 'object'
          && Object.values(channel).some((entry) => typeof entry === 'number' && Math.abs(entry) > 0.0001)
      ))) return true
      continue
    }
    if (typeof value === 'number' && Math.abs(value) > 0.0001) return true
  }
  return false
}

function canUseFastCompositionPath(
  layer: CompositionLayer,
  resolvedMask: ResolvedMask | null,
): boolean {
  return !resolvedMask
    && !layer.lutId
    && !layer.restoreLutId
    && !layer.pixelFlow
    && !layer.pixelStretch
    && !layer.reveal
    && !(layer.blurRadius && layer.blurRadius > 0)
    && !(layer.cornerRadius && layer.cornerRadius > 0)
    && !(layer.feather && layer.feather > 0)
    && !layer.shadowMask
    && !hasColorAdjustments(layer.color)
}

function createLayerUniforms(
  layer: CompositionLayer,
  targetRect: [number, number, number, number],
  sourceRect: [number, number, number, number],
  sourceCrop: [number, number, number, number],
  sourceAspect: number,
  frameAspect: number,
  targetAspect: number,
  canvasWidth: number,
  canvasHeight: number,
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
  uniforms.set([
    Math.max(0, Math.min(1, revealProgress)),
    transform?.translateX ?? 0,
    transform?.translateY ?? 0,
    0,
  ], 104)
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
  const pixelStretch = layer.pixelStretch
  const stretchMode = pixelStretch?.mode === 'right'
    ? 1
    : pixelStretch?.mode === 'down'
      ? 2
      : pixelStretch?.mode === 'swirl'
        ? 3
        : pixelStretch?.mode === 'swirl-front'
          ? 4
          : pixelStretch?.mode === 'left'
            ? 5
            : pixelStretch?.mode === 'up'
              ? 6
              : pixelStretch?.mode === 'horizontal'
                ? 7
                : pixelStretch?.mode === 'vertical' ? 8 : 0
  const stretchHorizontal = stretchMode === 1 || stretchMode === 5 || stretchMode === 7
  const stretchOriginX = Math.max(0, Math.min(1, pixelStretch?.originX ?? 0.5))
  const stretchOriginY = Math.max(0, Math.min(1, pixelStretch?.originY ?? 0.5))
  const stretchLineEnd = Math.max(0, Math.min(1, pixelStretch?.lineEnd ?? (stretchHorizontal ? stretchOriginX : stretchOriginY)))
  const stretchSampleStart = Math.max(0, Math.min(1, pixelStretch?.sampleStart ?? 0))
  const stretchSampleEnd = Math.max(0, Math.min(1, pixelStretch?.sampleEnd ?? 1))
  const stretchControlStart = Math.max(0, Math.min(1, pixelStretch?.controlStart ?? (stretchHorizontal ? stretchOriginX : stretchOriginY)))
  const stretchControlEnd = Math.max(0, Math.min(1, pixelStretch?.controlEnd ?? stretchLineEnd))
  const pathPoints = pixelStretch?.pathPoints
  const hasPath = Array.isArray(pathPoints) && pathPoints.length === 14
  const pathData = new Float32Array(16)
  if (hasPath) {
    for (let index = 0; index < 14; index += 1) {
      pathData[index] = Math.max(-2, Math.min(3, pathPoints[index]))
    }
  }
  uniforms.set([
    stretchMode,
    Math.max(0, Math.min(100, pixelStretch?.intensity ?? 0)),
    stretchOriginX,
    stretchOriginY,
  ], 128)
  uniforms.set([
    Math.max(-180, Math.min(180, pixelStretch?.angle ?? 0)),
    stretchLineEnd,
    stretchSampleStart,
    stretchSampleEnd,
  ], 132)
  uniforms.set([
    Math.max(0, Math.min(1, pixelStretch?.centerX ?? 0.5)),
    Math.max(0, Math.min(1, pixelStretch?.centerY ?? 0.5)),
    stretchControlStart,
    stretchControlEnd,
  ], 136)
  uniforms.set([
    hasPath ? 1 : 0,
    Math.max(0.001, Math.min(2, pixelStretch?.pathStartWidth ?? 0.2)),
    Math.max(0.001, Math.min(2, pixelStretch?.pathEndWidth ?? 0.1)),
    pixelStretch?.fillSampleGaps ? 1 : 0,
  ], 140)
  uniforms.set(pathData, 144)
  uniforms.set(sourceCrop, 160)
  // Preset radii are fractions of the displayed layer's shorter pixel side.
  // Convert that physical radius back to the shader's y-normalized space so
  // a landscape and portrait layer keep the same radius on both axes.
  const targetWidthPixels = Math.max(0.0001, targetRect[2] * canvasWidth)
  const targetHeightPixels = Math.max(0.0001, targetRect[3] * canvasHeight)
  const cornerRadiusScale = Math.min(targetWidthPixels, targetHeightPixels) / targetHeightPixels
  uniforms.set([
    frameAspect,
    sourceAspect,
    Math.max(0, Math.min(0.5, layer.cornerRadius ?? 0)) * cornerRadiusScale,
    Math.max(0, layer.feather ?? 0) * cornerRadiusScale,
  ], 164)
  uniforms.set([
    Math.max(0, layer.blurRadius ?? 0),
    layer.shadowMask ? 1 : 0,
    Math.max(0, Math.min(0.49, layer.shadowMask?.insetX ?? 0)),
    Math.max(0, Math.min(0.49, layer.shadowMask?.insetY ?? 0)),
  ], 168)
  // shape.y marks positioned image layers, currently used by watermark AA.
  uniforms.set([Math.max(0.0001, targetAspect), layer.positioning ? 1 : 0, 0, 0], 172)
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
): [number, number, number, number] {
  const requested = layer.sourceRect ?? { x: 0, y: 0, w: 1, h: 1 }
  const x = Math.max(0, Math.min(1, requested.x))
  const y = Math.max(0, Math.min(1, requested.y))
  const w = Math.max(0.0001, Math.min(1 - x, requested.w))
  const h = Math.max(0.0001, Math.min(1 - y, requested.h))
  return [x, y, w, h]
}

function sourceCropForLayer(
  layer: CompositionLayer,
  sourceRect: [number, number, number, number],
  targetRect: [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): [number, number, number, number] {
  const requested = layer.transform?.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  let x = Math.max(0, Math.min(1, requested.x))
  let y = Math.max(0, Math.min(1, requested.y))
  let w = Math.max(0.0001, Math.min(1 - x, requested.w))
  let h = Math.max(0.0001, Math.min(1 - y, requested.h))
  if (resolvePositioning(layer.positioning, canvasWidth, canvasHeight)) return [x, y, w, h]
  if (layer.fit === 'stretch' || layer.fit === 'cover-scale' || layer.fit === 'contain') return [x, y, w, h]

  const targetAspect = Math.max(
    0.0001,
    (targetRect[2] * canvasWidth) / Math.max(targetRect[3] * canvasHeight, 0.0001),
  )
  const rawSourceAspect = Math.max(
    0.0001,
    (sourceWidth * sourceRect[2]) / Math.max(sourceHeight * sourceRect[3], 0.0001),
  )
  const swapped = shouldSwapOrientation(layer.transform?.orientation ?? 0)
  const sourceAspect = swapped ? 1 / rawSourceAspect : rawSourceAspect
  if (sourceAspect > targetAspect) {
    const croppedWidth = h * targetAspect / sourceAspect
    x += (w - croppedWidth) / 2
    w = croppedWidth
  } else {
    const croppedHeight = w * sourceAspect / targetAspect
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
  private blurDownPipeline: GPURenderPipeline | null = null
  private blurUpPipeline: GPURenderPipeline | null = null
  private uniformBuffers: GPUBuffer[] = []
  private pipelines = new Map<SupportedBlendMode, GPURenderPipeline>()
  private fastPipelines = new Map<SupportedBlendMode, GPURenderPipeline>()
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
  private resolveFont: WebGpuFontResolver | null = null
  private resolveLut: ((path: string) => Promise<string>) | null = null
  private resolveMask: ((layer: CompositionLayer, path: string) => Promise<WebGpuMaskSource>) | null = null

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas
  }

  get isReady(): boolean {
    return this.runtime !== null
      && this.context !== null
      && this.pipelines.size === BLEND_MODES.length
      && this.fastPipelines.size === BLEND_MODES.length
      && this.blurDownPipeline !== null
      && this.blurUpPipeline !== null
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
      this.resolveFont = options.resolveFont ?? null
      this.resolveLut = options.resolveLut ?? null
      this.resolveMask = options.resolveMask ?? null
      context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' })

      const module = this.device.createShaderModule({ label: 'webgpu-composition', code: COMPOSITION_SHADER })
      const compilationInfo = await module.getCompilationInfo()
      const shaderErrors = compilationInfo.messages.filter((message) => message.type === 'error')
      if (shaderErrors.length > 0) {
        throw new Error(shaderErrors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'))
      }
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
        this.fastPipelines.set(mode, this.device.createRenderPipeline({
          label: `webgpu-composition-fast-${mode}`,
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vertexMain' },
          fragment: {
            module,
            entryPoint: 'fragmentFastMain',
            targets: [{ format: this.format, blend: blendState(mode) }],
          },
          primitive: { topology: 'triangle-list' },
        }))
      }
      const blurModule = this.device.createShaderModule({ label: 'webgpu-composition-dual-kawase-blur', code: DUAL_KAWASE_SHADER })
      const blurCompilationInfo = await blurModule.getCompilationInfo()
      const blurShaderErrors = blurCompilationInfo.messages.filter((message) => message.type === 'error')
      if (blurShaderErrors.length > 0) {
        throw new Error(blurShaderErrors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'))
      }
      const blurLayout = this.device.createBindGroupLayout({
        label: 'webgpu-composition-dual-kawase-blur-layout',
        entries: [
          { binding: 0, visibility: WEBGPU_FLAGS.fragmentStage, sampler: { type: 'filtering' } },
          { binding: 1, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float' } },
          { binding: 2, visibility: WEBGPU_FLAGS.fragmentStage, buffer: { type: 'uniform' } },
        ],
      })
      const blurPipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [blurLayout] })
      this.blurDownPipeline = this.device.createRenderPipeline({
        label: 'webgpu-composition-dual-kawase-down',
        layout: blurPipelineLayout,
        vertex: { module: blurModule, entryPoint: 'vertexMain' },
        fragment: {
          module: blurModule,
          entryPoint: 'fragmentDownMain',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      })
      this.blurUpPipeline = this.device.createRenderPipeline({
        label: 'webgpu-composition-dual-kawase-up',
        layout: blurPipelineLayout,
        vertex: { module: blurModule, entryPoint: 'vertexMain' },
        fragment: {
          module: blurModule,
          entryPoint: 'fragmentUpMain',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      })
      this.sampler = this.device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
      })
    } catch (error) {
      runtime.destroy()
      throw new Error(formatWebGpuError(error))
    }
  }

  async render(composition: CompositionInput, time = 0): Promise<WebGpuCompositionRenderStats> {
    if (!this.device || !this.context || !this.sampler || !this.format || !this.blurDownPipeline || !this.blurUpPipeline) {
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
    const transientBuffers: GPUBuffer[] = []
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
      if (layer.blurRadius && layer.blurRadius > 0) {
        const blurred = await this.prepareBlurredLayer(
          layer,
          composition.canvas.width,
          composition.canvas.height,
          time,
          encoder,
          uniformOffset,
          transientTextures,
          transientBuffers,
          sourceOverride,
        )
        if (blurred) {
          draws.push(blurred.draw)
          uniformOffset += blurred.uniformCount
        }
      } else {
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
      for (const buffer of transientBuffers) buffer.destroy()
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
    this.blurDownPipeline = null
    this.blurUpPipeline = null
    this.format = null
    this.resolveImage = null
    this.resolveSource = null
    this.resolveFont = null
    this.resolveLut = null
    this.resolveMask = null
    this.pipelines.clear()
    this.fastPipelines.clear()
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
    const sourceRect = sourceRectForLayer(layoutLayer)
    const sourceCrop = sourceCropForLayer(
      layoutLayer,
      sourceRect,
      targetRect,
      source.width,
      source.height,
      canvasWidth,
      canvasHeight,
    )
    const targetAspect = Math.max(
      0.0001,
      (targetRect[2] * canvasWidth) / Math.max(targetRect[3] * canvasHeight, 0.0001),
    )
    const sourceAspect = Math.max(
      0.0001,
      (source.width * sourceRect[2]) / Math.max(source.height * sourceRect[3], 0.0001),
    )
    const frameAspect = shouldSwapOrientation(layoutLayer.transform?.orientation ?? 0)
      ? 1 / sourceAspect
      : sourceAspect
    const luts = await this.getLayerLuts(layer)
    const curve = this.getLayerCurve(layer.color)
    const mask = resolvedMask
      ? await this.getMaskTexture(layer, resolvedMask.path)
      : this.getIdentityMask()
    const revealProgress = layer.reveal
      ? compositionRevealProgress(layer.reveal, time)
      : 1
    const uniforms = createLayerUniforms(layer, targetRect, sourceRect, sourceCrop, sourceAspect, frameAspect, targetAspect, canvasWidth, canvasHeight, luts, resolvedMask, revealProgress, time)
    const mode = (layer.blendMode ?? 'normal') as SupportedBlendMode
    const normalizedMode = BLEND_MODES.includes(mode) ? mode : 'normal'
    const pipelineMap = canUseFastCompositionPath(layer, resolvedMask)
      ? this.fastPipelines
      : this.pipelines
    const pipeline = pipelineMap.get(normalizedMode)!
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

  private createTransientTexture(width: number, height: number, label: string): CachedImageTexture {
    if (!this.device || !this.format) throw new Error('WebGPU 合成渲染器尚未初始化')
    const texture = this.device.createTexture({
      label,
      size: { width, height },
      format: this.format,
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureRenderAttachment,
    })
    return { texture, view: texture.createView(), width, height }
  }

  private encodeDualKawasePass(
    encoder: GPUCommandEncoder,
    source: CachedImageTexture,
    target: CachedImageTexture,
    sourceWidth: number,
    sourceHeight: number,
    direction: 'down' | 'up',
    transientBuffers: GPUBuffer[],
  ): void {
    if (!this.device || !this.sampler || !this.blurDownPipeline || !this.blurUpPipeline) {
      throw new Error('WebGPU 合成渲染器尚未初始化')
    }
    const pipeline = direction === 'down' ? this.blurDownPipeline : this.blurUpPipeline
    const uniformBuffer = this.device.createBuffer({
      label: `webgpu-composition-dual-kawase-${direction}-uniforms`,
      size: 16,
      usage: WEBGPU_FLAGS.bufferUniform | WEBGPU_FLAGS.bufferCopyDst,
    })
    transientBuffers.push(uniformBuffer)
    this.device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([Math.max(1, sourceWidth), Math.max(1, sourceHeight), 1, 0]),
    )
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target.view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: source.view },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(6)
    pass.end()
  }

  private async prepareBlurredLayer(
    layer: CompositionLayer,
    canvasWidth: number,
    canvasHeight: number,
    time: number,
    encoder: GPUCommandEncoder,
    uniformOffset: number,
    transientTextures: GPUTexture[],
    transientBuffers: GPUBuffer[],
    sourceOverride?: CachedImageTexture,
  ): Promise<{ draw: PreparedCompositionDraw; uniformCount: number } | null> {
    const sourceLayer: CompositionLayer = {
      ...layer,
      blurRadius: undefined,
      color: undefined,
      restoreLutId: undefined,
      lutId: undefined,
      lutIntensity: undefined,
      opacity: 1,
      blendMode: 'normal',
    }
    const sourceDraw = await this.prepareDraw(sourceLayer, canvasWidth, canvasHeight, time, sourceOverride)
    if (sourceDraw === HIDDEN_MASK) return null

    const blurWidth = Math.max(1, Math.round(canvasWidth * BLUR_BUFFER_SCALE))
    const blurHeight = Math.max(1, Math.round(canvasHeight * BLUR_BUFFER_SCALE))
    const sourceTexture = this.createTransientTexture(blurWidth, blurHeight, 'webgpu-composition-blur-source')
    transientTextures.push(sourceTexture.texture)
    this.encodeDrawPass(encoder, sourceTexture.view, [sourceDraw], uniformOffset)

    const blurStrength = Math.max(1, layer.blurRadius ?? 0)
    const levelCount = Math.max(1, Math.min(3, Math.ceil(blurStrength / 12)))
    const downsampled: CachedImageTexture[] = []
    let current = sourceTexture
    let currentWidth = blurWidth
    let currentHeight = blurHeight
    for (let level = 0; level < levelCount; level += 1) {
      const target = this.createTransientTexture(
        Math.max(1, Math.ceil(currentWidth / 2)),
        Math.max(1, Math.ceil(currentHeight / 2)),
        `webgpu-composition-dual-kawase-down-${level}`,
      )
      downsampled.push(target)
      transientTextures.push(target.texture)
      this.encodeDualKawasePass(
        encoder,
        current,
        target,
        currentWidth,
        currentHeight,
        'down',
        transientBuffers,
      )
      current = target
      currentWidth = target.width
      currentHeight = target.height
    }

    for (let level = downsampled.length - 2; level >= 0; level -= 1) {
      const target = downsampled[level]
      this.encodeDualKawasePass(
        encoder,
        current,
        target,
        currentWidth,
        currentHeight,
        'up',
        transientBuffers,
      )
      current = target
      currentWidth = target.width
      currentHeight = target.height
    }

    const blurredTexture = this.createTransientTexture(blurWidth, blurHeight, 'webgpu-composition-dual-kawase-output')
    transientTextures.push(blurredTexture.texture)
    this.encodeDualKawasePass(
      encoder,
      current,
      blurredTexture,
      currentWidth,
      currentHeight,
      'up',
      transientBuffers,
    )

    const outputLayer: CompositionLayer = {
      ...layer,
      layerType: 'media',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      sourceRect: { x: 0, y: 0, w: 1, h: 1 },
      fit: 'stretch',
      transform: {
        crop: null,
        orientation: 0,
        rotate: 0,
        flipH: false,
        flipV: false,
        scale: 1,
        translateX: 0,
        translateY: 0,
      },
      blurRadius: undefined,
      color: undefined,
      restoreLutId: undefined,
      lutId: undefined,
      lutIntensity: undefined,
      maskPath: undefined,
      maskProjectId: undefined,
      maskOpacity: undefined,
      maskInverted: undefined,
      maskFeather: undefined,
      maskTrack: undefined,
      maskTimeline: undefined,
      pixelStretch: undefined,
      pixelFlow: undefined,
      reveal: undefined,
      cornerRadius: undefined,
      feather: undefined,
      shadowMask: undefined,
    }
    const outputDraw = await this.prepareDraw(outputLayer, canvasWidth, canvasHeight, time, blurredTexture)
    if (outputDraw === HIDDEN_MASK) return null
    return { draw: outputDraw, uniformCount: 1 }
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

    const rasterized = await rasterizeWebGpuLayer(layer, canvasWidth, canvasHeight, {
      resolveFont: this.resolveFont ?? undefined,
    })
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
