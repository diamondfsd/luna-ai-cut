export const LIVE_VIDEO_PREVIEW_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Resolution {
  lutIntensity: f32,
  lutSize: f32,
  exposure: f32,
  black: f32,
  brightness: f32,
  contrast: f32,
  saturation: f32,
  vibrance: f32,
  temperature: f32,
  tint: f32,
  highlights: f32,
  shadows: f32,
  whites: f32,
  blacks: f32,
  sharpen: f32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var lutTexture: texture_3d<f32>;
@group(0) @binding(3) var lutSampler: sampler;
@group(1) @binding(0) var<uniform> resolution: Resolution;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0),
  );
  let coordinates = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[index], 0.0, 1.0);
  output.uv = coordinates[index];
  return output;
}

fn liveLuminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn srgbToLinear(color: vec3<f32>) -> vec3<f32> {
  let low = color / 12.92;
  let high = pow((color + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(high, low, color <= vec3<f32>(0.04045));
}

fn linearToSrgb(color: vec3<f32>) -> vec3<f32> {
  let low = color * 12.92;
  let high = 1.055 * pow(color, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(high, low, color <= vec3<f32>(0.0031308));
}

fn applyLiveColorAdjustments(encodedColor: vec3<f32>) -> vec3<f32> {
  var color = srgbToLinear(clamp(encodedColor, vec3<f32>(0.0), vec3<f32>(1.0)));
  color = (color - vec3<f32>(resolution.black)) * exp2(resolution.exposure);

  let brightnessAmount = resolution.brightness / 100.0;
  let boundedBrightness = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  let midtoneWeight = boundedBrightness * (vec3<f32>(1.0) - boundedBrightness);
  let brightnessStrength = select(0.9, 1.25, brightnessAmount >= 0.0);
  color += midtoneWeight * brightnessAmount * brightnessStrength;

  let whiteBalance = vec3<f32>(
    1.0 + resolution.temperature / 100.0 * 0.18 + resolution.tint / 100.0 * 0.04,
    1.0 - resolution.tint / 100.0 * 0.12,
    1.0 - resolution.temperature / 100.0 * 0.18 + resolution.tint / 100.0 * 0.04,
  );
  color *= whiteBalance;

  let luma = liveLuminance(color);
  let shadowMask = pow(1.0 - luma, 2.0);
  let highlightMask = pow(luma, 2.0);
  color += color * (resolution.shadows / 100.0) * shadowMask * 0.9;
  color += color * (resolution.highlights / 100.0) * highlightMask * 0.9;
  color -= color * (resolution.blacks / 100.0) * shadowMask * 0.85;
  color += (resolution.whites / 100.0) * highlightMask * 0.35;

  let contrastAmount = resolution.contrast / 100.0;
  if (contrastAmount >= 0.0) {
    let pivot = 0.1845;
    color = (color - vec3<f32>(pivot)) * (1.0 + contrastAmount * 1.35) + vec3<f32>(pivot);
  } else {
    let compression = -contrastAmount;
    let positive = max(color, vec3<f32>(0.0));
    color = positive * (1.0 + compression * 0.15)
      / (vec3<f32>(1.0) + positive * compression * 0.75);
  }

  let grayLuma = liveLuminance(color);
  color = mix(vec3<f32>(grayLuma), color, 1.0 + resolution.saturation / 100.0);
  let maxChannel = max(color.r, max(color.g, color.b));
  let minChannel = min(color.r, min(color.g, color.b));
  let chroma = maxChannel - minChannel;
  color = mix(vec3<f32>(grayLuma), color, 1.0 + resolution.vibrance / 100.0 * (1.0 - clamp(chroma, 0.0, 1.0)));

  return linearToSrgb(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)));
}

@fragment
fn previewMain(input: VertexOutput) -> @location(0) vec4<f32> {
  var color = textureSample(sourceTexture, sourceSampler, input.uv).rgb;

  if (resolution.sharpen > 0.0) {
    let texel = vec2<f32>(1.0) / vec2<f32>(textureDimensions(sourceTexture, 0));
    let left = textureSample(sourceTexture, sourceSampler, input.uv - vec2<f32>(texel.x, 0.0)).rgb;
    let right = textureSample(sourceTexture, sourceSampler, input.uv + vec2<f32>(texel.x, 0.0)).rgb;
    let top = textureSample(sourceTexture, sourceSampler, input.uv - vec2<f32>(0.0, texel.y)).rgb;
    let bottom = textureSample(sourceTexture, sourceSampler, input.uv + vec2<f32>(0.0, texel.y)).rgb;
    let softened = color * 0.5 + (left + right + top + bottom) * 0.125;
    color = clamp(color + (color - softened) * (resolution.sharpen / 100.0 * 1.5), vec3<f32>(0.0), vec3<f32>(1.0));
  }

  if (
    resolution.exposure != 0.0 || resolution.black != 0.0 || resolution.brightness != 0.0 ||
    resolution.contrast != 0.0 || resolution.saturation != 0.0 || resolution.vibrance != 0.0 ||
    resolution.temperature != 0.0 || resolution.tint != 0.0 || resolution.highlights != 0.0 ||
    resolution.shadows != 0.0 || resolution.whites != 0.0 || resolution.blacks != 0.0
  ) {
    color = applyLiveColorAdjustments(color);
  }

  if (resolution.lutIntensity > 0.0 && resolution.lutSize >= 2.0) {
    let lutScale = (resolution.lutSize - 1.0) / resolution.lutSize;
    let lutOffset = 0.5 / resolution.lutSize;
    let lutCoordinates = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)) * lutScale + vec3<f32>(lutOffset);
    let lutColor = textureSampleLevel(lutTexture, lutSampler, lutCoordinates, 0.0).rgb;
    color = mix(color, lutColor, clamp(resolution.lutIntensity, 0.0, 1.0));
  }
  return vec4<f32>(color, 1.0);
}
`
