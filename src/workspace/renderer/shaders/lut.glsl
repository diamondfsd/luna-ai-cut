uniform highp sampler3D u_lut3d;
uniform bool u_useLut;

/**
 * 3D LUT 采样：将调色参数烘焙到 .cube 后再用三线性插值回读。
 * LUT 生成走 electron 主进程的 lutGenerator.ts，预览端不再逐个计算调色滤镜。
 */
vec3 applyLut(vec3 color) {
  if (!u_useLut) return color;
  return texture(u_lut3d, clamp(color, 0.0, 1.0)).rgb;
}
