// Tonal range adjustments — EXACTLY matches ffmpeg vf_colorbalance.c get_component()
//
//   l = max(r,g,b) + min(r,g,b)    (same as ffmpeg)
//   shadowMask  = clamp((1/3 - l) * 4 + 0.5, 0, 1) * 0.7
//   highMask    = clamp((l + 1/3 - 1) * 4 + 0.5, 0, 1) * 0.7
//   c' = c + u_shadows * shadowMask + u_highlights * highMask
//
// Whites/blacks handled by colorlevels (to be migrated in Phase 3)
uniform float u_shadows;
uniform float u_highlights;
uniform float u_whites;
uniform float u_blacks;

vec3 applyToneEqualizer(vec3 c) {
  // ffmpeg's luminance: l = max + min  (NOT dot-product luma)
  float l = max(max(c.r, c.g), c.b) + min(min(c.r, c.g), c.b);
  float a = 4.0, b = 0.333, scale = 0.7;

  float shadowMask = clamp((b - l) * a + 0.5, 0.0, 1.0) * scale;
  float highMask = clamp((l + b - 1.0) * a + 0.5, 0.0, 1.0) * scale;

  c += u_shadows * shadowMask;
  c += u_highlights * highMask;

  // Whites/blacks — temporary, will be handled by colorlevels in Phase 3
  c += u_blacks * shadowMask * 0.35;
  c += u_whites * highMask * 0.35;

  return c;
}
