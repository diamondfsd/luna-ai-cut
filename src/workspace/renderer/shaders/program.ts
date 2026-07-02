import brightness from './brightness.glsl?raw'
import colorBalanceRgb from './colorBalanceRgb.glsl?raw'
import common from './common.glsl?raw'
import curve from './curve.glsl?raw'
import detail from './detail.glsl?raw'
import exposure from './exposure.glsl?raw'
import hsl from './hsl.glsl?raw'
import levels from './levels.glsl?raw'
import toneEqualizer from './toneEqualizer.glsl?raw'
import transform from './transform.glsl?raw'
import vertex from './vertex.glsl?raw'
import whiteBalance from './whiteBalance.glsl?raw'

export const vertexSource = vertex

export const fragmentSource = `#version 300 es
precision highp float;

uniform sampler2D u_image;

in vec2 v_uv;
out vec4 fragColor;

${brightness}
${common}
${transform}
${detail}
${exposure}
${whiteBalance}
${toneEqualizer}
${levels}
${colorBalanceRgb}
${curve}
${hsl}

void main() {
  vec2 contained = containUv(v_uv);
  if (contained.x < 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 uv = transformUv(contained);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 raw = sampleImage(uv);
  vec3 blurred = blur3(uv);
  vec3 detail = raw - blurred;
  vec3 c = applyDenoise(raw, blurred);

  // ── Color pipeline (matches ffmpeg filter order) ──
  // 1. eq: gamma + brightness + contrast + saturation (combined LUT)
  c = applyEq(c);
  // 2. vibrance
  c = applyVibrance(c);
  // 3. colortemperature + tint
  c = applyWhiteBalance(c);
  // 4. colorbalance (shadows/highlights)
  c = applyToneEqualizer(c);
  // 5. colorlevels
  c = applyLevels(c);
  // 6. curves
  c = applyCurve(c);
  // 7. three-way color grading wheels
  c = applyColorGrading(c);

  // ── Detail (unsharp / hqdn3d) ──
  c = applyLocalContrast(c, detail);
  c = applySharpen(c, detail);

  fragColor = vec4(sat(c), 1.0);
}`
