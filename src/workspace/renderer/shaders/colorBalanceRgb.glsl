// Color balance: three-way grading wheels + contrast / saturation / vibrance
// Adapted from darktable's WebGL color lab
uniform float u_contrast;
uniform float u_vibrance;
uniform float u_saturation;
uniform float u_gradeShadowsHue;
uniform float u_gradeShadowsAmount;
uniform float u_gradeMidHue;
uniform float u_gradeMidAmount;
uniform float u_gradeHighlightsHue;
uniform float u_gradeHighlightsAmount;

vec3 applyColorBalanceRgb(vec3 c) {
  float y = luma(c);
  float sh = pow(1.0 - y, 2.0);
  float hi = pow(y, 2.0);
  float mid = sat(1.0 - abs(y - 0.5) * 2.0);
  c += colorWheel(u_gradeShadowsHue, u_gradeShadowsAmount) * sh;
  c += colorWheel(u_gradeMidHue, u_gradeMidAmount) * mid;
  c += colorWheel(u_gradeHighlightsHue, u_gradeHighlightsAmount) * hi;

  float pivot = 0.1845;
  c = (c - pivot) * (1.0 + u_contrast * 1.35) + pivot;
  float gray = luma(c);
  c = mix(vec3(gray), c, 1.0 + u_saturation);
  float maxc = max(max(c.r, c.g), c.b);
  float chroma = maxc - min(min(c.r, c.g), c.b);
  c = mix(vec3(gray), c, 1.0 + u_vibrance * (1.0 - sat(chroma)));
  return c;
}
