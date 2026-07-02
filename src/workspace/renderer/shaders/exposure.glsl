// Exposure (gamma power law) — derived from ffmpeg vf_eq.c eq=gamma
// Formula: c' = pow(c, 1/gamma)
// gamma = 1.0 + u_exposure / 10.0, range [0.5, 1.5]
uniform float u_exposure;
uniform float u_black;

vec3 applyExposure(vec3 c) {
  // Black point subtraction (from ffmpeg vf_exposure.c)
  c = max(c - u_black, 0.0);
  // Exposure as gamma power law (ffmpeg eq=gamma)
  // Negative exposure (darker) → gamma < 1 → pow(c, >1) → darker
  // Positive exposure (brighter) → gamma > 1 → pow(c, <1) → brighter
  float gamma = 1.0 + u_exposure / 10.0;
  gamma = max(gamma, 0.1);
  return pow(c, vec3(1.0 / gamma));
}
