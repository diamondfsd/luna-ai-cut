// Detail operations: USM sharpening & spatial denoise
// Derived from ffmpeg vf_unsharp.c (unsharp mask) and vf_hqdn3d.c (denoise)
//
// Unsharp mask:  detail = raw - blur(raw),  output = raw + detail * amount
//   clarity  → large radius unsharp (ffmpeg: luma_msize=9)
//   texture  → medium radius unsharp (ffmpeg: luma_msize=5)
//   sharpen  → small radius unsharp (ffmpeg: luma_msize=3)
//
// Denoise: hqdn3d spatial low-pass (simplified single-frame mix)
uniform vec2 u_texel;
uniform float u_clarity;
uniform float u_texture;
uniform float u_sharpen;
uniform float u_denoise;

vec3 sampleImage(vec2 uv) {
  return texture(u_image, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

// 3×3 binomial-weighted blur (center weight 4, edge 2, corner 1, sum 16)
vec3 blur3(vec2 uv) {
  vec3 sum = sampleImage(uv) * 4.0;
  sum += sampleImage(uv + vec2(u_texel.x, 0.0)) * 2.0;
  sum += sampleImage(uv - vec2(u_texel.x, 0.0)) * 2.0;
  sum += sampleImage(uv + vec2(0.0, u_texel.y)) * 2.0;
  sum += sampleImage(uv - vec2(0.0, u_texel.y)) * 2.0;
  sum += sampleImage(uv + u_texel);
  sum += sampleImage(uv - u_texel);
  sum += sampleImage(uv + vec2(u_texel.x, -u_texel.y));
  sum += sampleImage(uv + vec2(-u_texel.x, u_texel.y));
  return sum / 16.0;
}

// Spatial denoise — simplified single-frame version of hqdn3d's lowpass
// Mixes raw input with blurred result; the strength controls blending
vec3 applyDenoise(vec3 raw, vec3 blurred) {
  return mix(raw, blurred, sat(u_denoise));
}

// Apply unsharp mask detail for clarity & texture (medium/large radius)
vec3 applyLocalContrast(vec3 c, vec3 detail) {
  return c + detail * (u_texture * 1.2 + u_clarity * 1.8);
}

// Apply unsharp mask detail for sharpen (small radius)
vec3 applySharpen(vec3 c, vec3 detail) {
  return c + detail * u_sharpen * 1.5;
}
