// Color grading: three-way color wheels (shadows/midtones/highlights)
// Derived from ffmpeg vf_colorbalance.c get_component() mask formulas
//
// Contrast, saturation, vibrance moved to exposure.glsl (applyEq) to match
// ffmpeg eq filter's combined LUT order.
uniform float u_gradeShadowsHue;
uniform float u_gradeShadowsAmount;
uniform float u_gradeMidHue;
uniform float u_gradeMidAmount;
uniform float u_gradeHighlightsHue;
uniform float u_gradeHighlightsAmount;

vec3 applyColorGrading(vec3 c) {
  float y = luma(c);
  float sh = pow(1.0 - y, 2.0);
  float hi = pow(y, 2.0);
  float mid = sat(1.0 - abs(y - 0.5) * 2.0);
  c += colorWheel(u_gradeShadowsHue, u_gradeShadowsAmount) * sh;
  c += colorWheel(u_gradeMidHue, u_gradeMidAmount) * mid;
  c += colorWheel(u_gradeHighlightsHue, u_gradeHighlightsAmount) * hi;
  return c;
}
