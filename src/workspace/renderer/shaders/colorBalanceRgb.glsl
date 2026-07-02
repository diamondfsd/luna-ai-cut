// Color balance: three-way grading wheels + contrast / saturation / vibrance
// Contrast & saturation formulas derived from ffmpeg vf_eq.c (eq filter)
// Vibrance & grading derived from ffmpeg vf_vibrance.c / vf_colorbalance.c
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

  // Contrast: ffmpeg eq=contrast formula — c' = (c - 0.5) * contrast + 0.5
  // u_contrast: -100..100, maps to multiplier 0..2 (default 1.0)
  float pivot = 0.5;
  c = (c - pivot) * (1.0 + u_contrast) + pivot;

  // Saturation: ffmpeg eq=saturation — c' = mix(gray, c, saturation)
  // u_saturation: -100..100, maps to saturation factor 0..2 (default 1.0)
  float gray = luma(c);
  c = mix(vec3(gray), c, 1.0 + u_saturation);

  // Vibrance: ffmpeg vf_vibrance.c — protect high-chroma areas
  float maxc = max(max(c.r, c.g), c.b);
  float chroma = maxc - min(min(c.r, c.g), c.b);
  c = mix(vec3(gray), c, 1.0 + u_vibrance * (1.0 - sat(chroma)));
  return c;
}
