// Tonal range adjustments (shadows, highlights, whites, blacks) — adapted from darktable's WebGL color lab
uniform float u_shadows;
uniform float u_highlights;
uniform float u_whites;
uniform float u_blacks;

vec3 applyToneEqualizer(vec3 c) {
  float y = luma(c);
  float shadowMask = pow(1.0 - y, 2.0);
  float highMask = pow(y, 2.0);
  c += c * u_shadows * shadowMask * 0.9;
  c += c * u_highlights * highMask * 0.9;
  c += u_blacks * shadowMask * 0.35;
  c += u_whites * highMask * 0.35;
  return c;
}
