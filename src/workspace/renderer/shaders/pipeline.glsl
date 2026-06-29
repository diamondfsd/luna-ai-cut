#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_aspectRatio;
uniform vec4 u_crop;
uniform float u_rotate;
uniform vec2 u_flip;
uniform float u_scale;
uniform float u_lensDistortion;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_temperature;
uniform float u_tint;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_textureAmount;
uniform float u_clarity;
uniform float u_dehaze;
uniform float u_sharpen;
uniform float u_sharpenRadius;
uniform float u_sharpenDetail;
uniform float u_sharpenMasking;
uniform float u_noiseReduction;
uniform float u_colorNoiseReduction;
uniform float u_vignette;
uniform float u_grainAmount;
uniform float u_grainSize;
uniform float u_grainRoughness;
uniform float u_lensVignetting;
uniform float u_chromaticAberration;
uniform float u_hslHue[8];
uniform float u_hslSaturation[8];
uniform float u_hslLuminance[8];
uniform vec3 u_gradingShadows;
uniform vec3 u_gradingMidtones;
uniform vec3 u_gradingHighlights;
uniform float u_gradingBlending;
uniform float u_gradingBalance;
uniform vec3 u_calibration;

vec2 containUv(vec2 uv) {
  float imageAspect = max(u_aspectRatio.x, 0.0001);
  float canvasAspect = max(u_aspectRatio.y, 0.0001);
  vec2 size = vec2(1.0);
  if (canvasAspect > imageAspect) {
    size.x = imageAspect / canvasAspect;
  } else {
    size.y = canvasAspect / imageAspect;
  }
  vec2 origin = (vec2(1.0) - size) * 0.5;
  if (uv.x < origin.x || uv.y < origin.y || uv.x > origin.x + size.x || uv.y > origin.y + size.y) {
    return vec2(-1.0);
  }
  return (uv - origin) / size;
}

vec2 transformUv(vec2 uv) {
  vec2 lensCentered = uv - 0.5;
  float r2 = dot(lensCentered, lensCentered);
  uv = 0.5 + lensCentered * (1.0 + u_lensDistortion * r2 * 0.32);
  vec2 cropUv = u_crop.xy + uv * u_crop.zw;
  vec2 centered = cropUv - 0.5;
  centered /= max(u_scale, 0.01);
  float radiansValue = radians(u_rotate);
  float s = sin(radiansValue);
  float c = cos(radiansValue);
  centered = mat2(c, -s, s, c) * centered;
  centered.x = u_flip.x > 0.5 ? -centered.x : centered.x;
  centered.y = u_flip.y > 0.5 ? -centered.y : centered.y;
  return centered + 0.5;
}

float randomValue(vec2 uv) {
  return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453123);
}

vec3 hueToRgb(float hue) {
  return clamp(abs(fract(hue + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

vec3 rgbToHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsvToRgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float hueDistance(float a, float b) {
  float d = abs(a - b);
  return min(d, 1.0 - d);
}

vec3 applyHslMix(vec3 color) {
  vec3 hsv = rgbToHsv(color);
  float centers[8] = float[8](0.0, 0.083, 0.16, 0.333, 0.50, 0.62, 0.75, 0.88);
  float hueShift = 0.0;
  float satShift = 0.0;
  float lumShift = 0.0;
  for (int i = 0; i < 8; i++) {
    float weight = smoothstep(0.17, 0.0, hueDistance(hsv.x, centers[i])) * hsv.y;
    hueShift += u_hslHue[i] * weight;
    satShift += u_hslSaturation[i] * weight;
    lumShift += u_hslLuminance[i] * weight;
  }
  hsv.x = fract(hsv.x + hueShift * 0.08);
  hsv.y = clamp(hsv.y * (1.0 + satShift), 0.0, 1.0);
  hsv.z = clamp(hsv.z + lumShift * 0.24, 0.0, 1.0);
  return hsvToRgb(hsv);
}

vec3 applyColorGrading(vec3 color) {
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float blend = mix(0.12, 0.32, u_gradingBlending);
  float shadowWeight = smoothstep(0.55 + u_gradingBalance * 0.22, 0.08, luma);
  float highlightWeight = smoothstep(0.45 + u_gradingBalance * 0.22, 0.92, luma);
  float midWeight = smoothstep(0.12, 0.5, luma) * (1.0 - smoothstep(0.5, 0.88, luma));
  vec3 shadows = hueToRgb(u_gradingShadows.x);
  vec3 midtones = hueToRgb(u_gradingMidtones.x);
  vec3 highlights = hueToRgb(u_gradingHighlights.x);
  color = mix(color, color * shadows, shadowWeight * u_gradingShadows.y * blend);
  color = mix(color, color * midtones, midWeight * u_gradingMidtones.y * blend);
  color = mix(color, color * highlights, highlightWeight * u_gradingHighlights.y * blend);
  return color;
}

vec3 applyColor(vec3 color) {
  color *= pow(2.0, u_exposure);
  color += u_brightness * 0.25;
  color = (color - 0.5) * (1.0 + u_contrast) + 0.5;

  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = vec3(luma);
  color = mix(gray, color, 1.0 + u_saturation);
  float vibranceMask = clamp(1.0 - abs(max(max(color.r, color.g), color.b) - luma), 0.0, 1.0);
  color = mix(gray, color, 1.0 + u_vibrance * vibranceMask);

  color.r += u_temperature * 0.08 + u_tint * 0.025;
  color.b -= u_temperature * 0.08;
  color.g += u_tint * 0.04;

  float highlightMask = smoothstep(0.45, 1.0, luma);
  float shadowMask = 1.0 - smoothstep(0.0, 0.55, luma);
  color += highlightMask * u_highlights * 0.18;
  color += shadowMask * u_shadows * 0.18;
  color += smoothstep(0.7, 1.0, luma) * u_whites * 0.12;
  color += (1.0 - smoothstep(0.0, 0.3, luma)) * u_blacks * 0.12;
  color *= 1.0 + u_calibration * 0.16;
  color = applyHslMix(color);
  color = applyColorGrading(color);
  color = mix(color, (color - 0.5) * (1.0 + u_clarity) + 0.5, 0.35);
  color += (color - gray) * u_dehaze * 0.3;
  return clamp(color, 0.0, 1.0);
}

vec3 applySharpen(vec2 uv, vec3 color) {
  if (u_sharpen <= 0.001 && abs(u_textureAmount) <= 0.001 && u_noiseReduction <= 0.001 && u_colorNoiseReduction <= 0.001) return color;
  vec2 texel = u_sharpenRadius / max(u_resolution, vec2(1.0));
  vec2 sampleUv = vec2(uv.x, 1.0 - uv.y);
  vec3 north = texture(u_texture, sampleUv - vec2(0.0, texel.y)).rgb;
  vec3 south = texture(u_texture, sampleUv + vec2(0.0, texel.y)).rgb;
  vec3 east = texture(u_texture, sampleUv + vec2(texel.x, 0.0)).rgb;
  vec3 west = texture(u_texture, sampleUv - vec2(texel.x, 0.0)).rgb;
  vec3 blur = (north + south + east + west + color) / 5.0;
  color = mix(color, blur, u_noiseReduction * 0.38);
  float colorLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(color, vec3(colorLuma) + (color - vec3(colorLuma)) * (1.0 - u_colorNoiseReduction * 0.42), u_colorNoiseReduction);
  vec3 edge = color * 5.0 - north - south - east - west;
  float edgeMask = smoothstep(u_sharpenMasking, 1.0, length(edge - color));
  color = mix(color, edge, u_sharpen * mix(0.45, 1.0, u_sharpenDetail) * edgeMask);
  color += (color - blur) * u_textureAmount * 0.42;
  return clamp(color, 0.0, 1.0);
}

vec3 applyVignette(vec2 uv, vec3 color) {
  float distanceFromCenter = distance(uv, vec2(0.5));
  float vignette = smoothstep(0.25, 0.75, distanceFromCenter) * (u_vignette - u_lensVignetting);
  color *= 1.0 - vignette * 0.55;
  if (u_grainAmount > 0.001) {
    float grainScale = mix(180.0, 34.0, u_grainSize);
    float grain = randomValue(floor(uv * grainScale) + u_grainRoughness * 41.0) - 0.5;
    color += grain * u_grainAmount * mix(0.05, 0.16, u_grainRoughness);
  }
  return clamp(color, 0.0, 1.0);
}

void main() {
  vec2 containedUv = containUv(v_uv);
  if (containedUv.x < 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 uv = transformUv(containedUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  float aberration = u_chromaticAberration * 0.004 * distance(containedUv, vec2(0.5));
  vec2 sampleUv = vec2(uv.x, 1.0 - uv.y);
  vec4 source = texture(u_texture, sampleUv);
  source.r = texture(u_texture, sampleUv + vec2(aberration, 0.0)).r;
  source.b = texture(u_texture, sampleUv - vec2(aberration, 0.0)).b;
  vec3 color = applyColor(source.rgb);
  color = applySharpen(uv, color);
  color = applyVignette(containedUv, color);
  fragColor = vec4(color, source.a);
}
