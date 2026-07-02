import common from './common.glsl?raw'
import detail from './detail.glsl?raw'
import transform from './transform.glsl?raw'
import vertex from './vertex.glsl?raw'
import lut from './lut.glsl?raw'

export const vertexSource = vertex

export const fragmentSource = `#version 300 es
precision highp float;

uniform sampler2D u_image;

in vec2 v_uv;
out vec4 fragColor;

${common}
${transform}
${detail}
${lut}

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

  // 颜色调校已烘焙进 LUT，预览端只处理空间滤镜（降噪/清晰度/锐化）
  vec3 c = applyLut(raw);
  vec3 lutBlurred = applyLut(blurred);
  vec3 lutDetail = c - lutBlurred;
  c = applyDenoise(c, lutBlurred);
  c = applyLocalContrast(c, lutDetail);
  c = applySharpen(c, lutDetail);

  fragColor = vec4(sat(c), 1.0);
}`
