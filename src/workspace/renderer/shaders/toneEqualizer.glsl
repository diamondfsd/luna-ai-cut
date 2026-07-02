// Tonal range adjustments (shadows, highlights, midtones) — derived from ffmpeg vf_colorbalance.c
// Formula: c' = c + rs * shadowMask + rm * midMask + rh * highMask
//   shadowMask = (1 - luma)²
//   midMask    = 1 - |luma - 0.5| * 2
//   highMask   = luma²
// Whites/blacks handled by colorlevels (Phase 3)
uniform float u_shadows;
uniform float u_highlights;
uniform float u_whites;
uniform float u_blacks;

vec3 applyToneEqualizer(vec3 c) {
  float y = luma(c);
  float shadowMask = pow(1.0 - y, 2.0);
  float highMask = pow(y, 2.0);
  // ffmpeg colorbalance additive formula (removed multiplicative on c)
  c += u_shadows * shadowMask * 0.9;
  c += u_highlights * highMask * 0.9;
  // Whites/blacks — temporary, will be handled by colorlevels in Phase 3
  c += u_blacks * shadowMask * 0.35;
  c += u_whites * highMask * 0.35;
  return c;
}
