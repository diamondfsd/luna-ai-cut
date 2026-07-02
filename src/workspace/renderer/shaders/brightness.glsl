// Brightness (additive offset) — derived from ffmpeg vf_eq.c eq=brightness
// Formula: c' = c + brightness
// u_brightness: -100 ~ 100, maps to additive offset [-1.0, 1.0]
uniform float u_brightness;

vec3 applyBrightness(vec3 c) {
  return c + u_brightness / 100.0;
}
