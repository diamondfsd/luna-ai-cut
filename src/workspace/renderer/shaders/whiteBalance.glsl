// White balance (temperature / tint) — adapted from darktable's WebGL color lab
uniform float u_temperature;
uniform float u_tint;

vec3 applyWhiteBalance(vec3 c) {
  vec3 coeffs = vec3(
    1.0 + u_temperature * 0.18 - u_tint * 0.04,
    1.0 + u_tint * 0.12,
    1.0 - u_temperature * 0.18 - u_tint * 0.04
  );
  return c * coeffs;
}
