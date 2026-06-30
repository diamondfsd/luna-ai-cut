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
uniform float u_cropAspect;
uniform vec2 u_frameSize;
uniform float u_fillScale;
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
uniform vec4 u_curve[5];
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
uniform vec4 u_colorEditor;
uniform vec4 u_colorEditorExtra;
uniform vec3 u_gradingShadows;
uniform vec3 u_gradingMidtones;
uniform vec3 u_gradingHighlights;
uniform float u_gradingBlending;
uniform float u_gradingBalance;
uniform vec4 u_selectiveColor[9];
uniform float u_selectiveColorMode;
uniform vec3 u_calibrationHue;
uniform vec3 u_calibrationSaturation;

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
  float radiansValue = radians(u_rotate);
  float s = sin(radiansValue);
  float c = cos(radiansValue);
  vec2 outputUv = vec2(uv.x, 1.0 - uv.y);
  vec2 frameUv = u_crop.xy + outputUv * u_crop.zw;
  vec2 centered = (frameUv - 0.5) * max(u_frameSize, vec2(0.0001));
  centered /= max(u_fillScale * u_scale, 0.01);
  centered = mat2(c, -s, s, c) * centered;
  centered.x = u_flip.x > 0.5 ? -centered.x : centered.x;
  centered.y = u_flip.y > 0.5 ? -centered.y : centered.y;
  return centered / vec2(max(u_cropAspect, 0.0001), 1.0) + 0.5;
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

float hueWeight(float hue, float center, float radius) {
  return 1.0 - smoothstep(0.0, radius, hueDistance(hue, center));
}

vec3 applyHslMix(vec3 color) {
  vec3 hsv = rgbToHsv(color);
  float centers[8] = float[8](0.0, 0.083, 0.16, 0.333, 0.50, 0.62, 0.75, 0.88);
  float hueShift = 0.0;
  float satShift = 0.0;
  float lumShift = 0.0;
  for (int i = 0; i < 8; i++) {
    float weight = hueWeight(hsv.x, centers[i], 0.17) * hsv.y;
    hueShift += u_hslHue[i] * weight;
    satShift += u_hslSaturation[i] * weight;
    lumShift += u_hslLuminance[i] * weight;
  }
  hsv.x = fract(hsv.x + hueShift * 0.08);
  hsv.y = clamp(hsv.y * (1.0 + satShift), 0.0, 1.0);
  hsv.z = clamp(hsv.z + lumShift * 0.24, 0.0, 1.0);
  return hsvToRgb(hsv);
}

float applyCurveValue(float value, vec4 curve) {
  float shadowMask = 1.0 - smoothstep(0.0, 0.34, value);
  float darkMask = smoothstep(0.08, 0.34, value) * (1.0 - smoothstep(0.36, 0.58, value));
  float lightMask = smoothstep(0.42, 0.64, value) * (1.0 - smoothstep(0.66, 0.9, value));
  float highlightMask = smoothstep(0.66, 1.0, value);
  float lift = curve.x * shadowMask * 0.18
    + curve.y * darkMask * 0.14
    + curve.z * lightMask * 0.14
    + curve.w * highlightMask * 0.18;
  float contrast = (curve.z + curve.w - curve.x - curve.y) * 0.08;
  float sCurve = value + (value - 0.5) * (1.0 - abs(value - 0.5) * 2.0) * contrast;
  return clamp(sCurve + lift, 0.0, 1.0);
}

vec3 applyToneCurve(vec3 color) {
  color = vec3(applyCurveValue(color.r, u_curve[0]), applyCurveValue(color.g, u_curve[0]), applyCurveValue(color.b, u_curve[0]));
  float luma = max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.0001);
  float mapped = applyCurveValue(luma, u_curve[1]);
  color *= mapped / luma;
  color.r = applyCurveValue(color.r, u_curve[2]);
  color.g = applyCurveValue(color.g, u_curve[3]);
  color.b = applyCurveValue(color.b, u_curve[4]);
  return clamp(color, 0.0, 1.0);
}

vec3 applyColorEditor(vec3 color) {
  vec3 hsv = rgbToHsv(color);
  float hueMask = hueWeight(hsv.x, u_colorEditor.x, 0.28);
  float satWeight = smoothstep(0.0, 0.28, hsv.y) * (1.0 - smoothstep(0.25, 1.0, abs(hsv.y - u_colorEditor.y)));
  float lumWeight = smoothstep(0.0, 0.35, hsv.z) * (1.0 - smoothstep(0.82, 1.0, hsv.z));
  float weight = hueMask * mix(0.45, 1.0, u_colorEditor.z) * mix(0.55, 1.0, u_colorEditor.w) * max(satWeight, 0.25) * max(lumWeight, 0.35);
  hsv.x = fract(hsv.x + u_colorEditorExtra.x * 0.1 * weight);
  hsv.y = clamp(hsv.y * (1.0 + u_colorEditorExtra.y * weight), 0.0, 1.0);
  hsv.z = clamp(hsv.z + u_colorEditorExtra.z * 0.24 * weight, 0.0, 1.0);
  vec3 edited = hsvToRgb(hsv);
  float uniformity = u_colorEditorExtra.w * weight;
  edited = mix(edited, vec3(dot(edited, vec3(0.2126, 0.7152, 0.0722))) + (hueToRgb(u_colorEditor.x) - 0.5) * hsv.y, uniformity * 0.18);
  return clamp(edited, 0.0, 1.0);
}

vec3 applyColorGrading(vec3 color) {
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float blend = mix(0.12, 0.32, u_gradingBlending);
  float shadowWeight = 1.0 - smoothstep(0.08, 0.55 + u_gradingBalance * 0.22, luma);
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

float colorBandWeight(vec3 hsv, int index, float luma) {
  float centers[6] = float[6](0.0, 0.16, 0.333, 0.50, 0.62, 0.88);
  if (index < 6) return hueWeight(hsv.x, centers[index], 0.16) * smoothstep(0.04, 0.3, hsv.y);
  if (index == 6) return smoothstep(0.68, 0.98, luma) * (1.0 - smoothstep(0.0, 0.32, hsv.y));
  if (index == 7) return (1.0 - smoothstep(0.0, 0.28, abs(luma - 0.5))) * (1.0 - smoothstep(0.0, 0.36, hsv.y));
  return (1.0 - smoothstep(0.05, 0.32, luma)) * (1.0 - smoothstep(0.0, 0.42, hsv.y));
}

vec3 applySelectiveColor(vec3 color) {
  vec3 hsv = rgbToHsv(color);
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 result = color;
  for (int i = 0; i < 9; i++) {
    float weight = colorBandWeight(hsv, i, luma);
    vec4 cmyk = u_selectiveColor[i];
    vec3 rgbDelta = vec3(-cmyk.x, -cmyk.y, -cmyk.z) * 0.18 - vec3(cmyk.w) * 0.12;
    float modeGain = mix(1.0, 1.45, u_selectiveColorMode);
    result += rgbDelta * weight * modeGain;
  }
  return clamp(result, 0.0, 1.0);
}

vec3 applyCalibration(vec3 color) {
  vec3 hsv = rgbToHsv(color);
  float redWeight = hueWeight(hsv.x, 0.0, 0.17);
  float greenWeight = hueWeight(hsv.x, 0.333, 0.2);
  float blueWeight = hueWeight(hsv.x, 0.62, 0.2);
  hsv.x = fract(hsv.x + (u_calibrationHue.r * redWeight + u_calibrationHue.g * greenWeight + u_calibrationHue.b * blueWeight) * 0.08);
  hsv.y = clamp(hsv.y * (1.0 + u_calibrationSaturation.r * redWeight * 0.45 + u_calibrationSaturation.g * greenWeight * 0.45 + u_calibrationSaturation.b * blueWeight * 0.45), 0.0, 1.0);
  return hsvToRgb(hsv);
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
  color = applyToneCurve(color);
  color = applyHslMix(color);
  color = applyColorEditor(color);
  color = applyColorGrading(color);
  color = applySelectiveColor(color);
  color = applyCalibration(color);
  color += (color - gray) * u_dehaze * 0.12;
  return clamp(color, 0.0, 1.0);
}

vec3 sampleSource(vec2 uv, vec2 offset) {
  vec2 sampleUv = uv;
  return texture(u_texture, sampleUv + offset).rgb;
}

vec3 crossBlur(vec2 uv, vec2 texel) {
  vec3 north = sampleSource(uv, -vec2(0.0, texel.y));
  vec3 south = sampleSource(uv, vec2(0.0, texel.y));
  vec3 east = sampleSource(uv, vec2(texel.x, 0.0));
  vec3 west = sampleSource(uv, -vec2(texel.x, 0.0));
  vec3 center = sampleSource(uv, vec2(0.0));
  return (north + south + east + west + center) / 5.0;
}

vec3 applyDetail(vec2 uv, vec3 color) {
  if (u_sharpen <= 0.001 && abs(u_textureAmount) <= 0.001 && abs(u_clarity) <= 0.001 && abs(u_dehaze) <= 0.001 && u_noiseReduction <= 0.001 && u_colorNoiseReduction <= 0.001) return color;
  vec2 baseTexel = 1.0 / max(u_resolution, vec2(1.0));
  vec3 smallBlur = crossBlur(uv, baseTexel * 1.4);
  vec3 midBlur = crossBlur(uv, baseTexel * 6.0);
  vec3 largeBlur = crossBlur(uv, baseTexel * 14.0);
  vec2 sharpTexel = baseTexel * u_sharpenRadius;
  vec3 north = sampleSource(uv, -vec2(0.0, sharpTexel.y));
  vec3 south = sampleSource(uv, vec2(0.0, sharpTexel.y));
  vec3 east = sampleSource(uv, vec2(sharpTexel.x, 0.0));
  vec3 west = sampleSource(uv, -vec2(sharpTexel.x, 0.0));
  vec3 blur = (north + south + east + west + color) / 5.0;
  color = mix(color, blur, u_noiseReduction * 0.38);
  float colorLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(color, vec3(colorLuma) + (color - vec3(colorLuma)) * (1.0 - u_colorNoiseReduction * 0.42), u_colorNoiseReduction);
  vec3 edge = color * 5.0 - north - south - east - west;
  float edgeMask = smoothstep(u_sharpenMasking, 1.0, length(edge - color));
  color = mix(color, edge, u_sharpen * mix(0.45, 1.0, u_sharpenDetail) * edgeMask);
  color += (color - smallBlur) * u_textureAmount * 0.42;
  color += (color - midBlur) * u_clarity * 0.24;
  color += (color - largeBlur) * u_dehaze * 0.18;
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
  vec2 sampleUv = uv;
  vec4 source = texture(u_texture, sampleUv);
  source.r = texture(u_texture, sampleUv + vec2(aberration, 0.0)).r;
  source.b = texture(u_texture, sampleUv - vec2(aberration, 0.0)).b;
  vec3 color = applyColor(source.rgb);
  color = applyDetail(uv, color);
  color = applyVignette(containedUv, color);
  fragColor = vec4(color, source.a);
}
