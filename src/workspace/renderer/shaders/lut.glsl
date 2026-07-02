uniform highp sampler3D u_lut3d;
uniform float u_useLut;

/**
 * 当 LUT 可用时，用 3D 纹理采样替代逐级颜色计算。
 * LUT 输入/输出均为 RGB，用 GL_LINEAR 做三线性插值。
 */
vec3 applyLut(vec3 color) {
  return texture(u_lut3d, clamp(color, 0.0, 1.0)).rgb;
}
