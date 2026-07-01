// Detail operations: image sample, blur, denoise, local contrast, sharpen
// Adapted from darktable's WebGL color lab
uniform vec2 u_texel;
uniform float u_clarity;
uniform float u_texture;
uniform float u_sharpen;
uniform float u_denoise;

vec3 sampleImage(vec2 uv) {
  return texture(u_image, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

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

vec3 applyDenoise(vec3 raw, vec3 blurred) {
  return mix(raw, blurred, sat(u_denoise));
}

vec3 applyLocalContrast(vec3 c, vec3 detail) {
  return c + detail * (u_texture * 1.2 + u_clarity * 1.8);
}

vec3 applySharpen(vec3 c, vec3 detail) {
  return c + detail * u_sharpen * 1.5;
}
