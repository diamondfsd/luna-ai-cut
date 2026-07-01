// Brightness (gamma curve) — adapted from darktable's basicadj module
uniform float u_brightness;

vec3 applyBrightness(vec3 c) {
  // u_brightness: -100 ~ 100, scale to gamma factor range ~[-4, 4]
  float gammaFactor = u_brightness / 100.0 * 4.0;
  float gamma = gammaFactor >= 0.0
    ? 1.0 / (1.0 + gammaFactor)
    : 1.0 - gammaFactor;
  return pow(max(c, 0.0), vec3(gamma));
}
