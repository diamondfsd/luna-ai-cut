// Exposure (gamma power law) — derived from ffmpeg vf_eq.c eq=gamma
// Formula: c' = pow(c, 1/gamma)
// gamma = 1.0 + u_exposure / 10.0, range [0.5, 1.5]
uniform float u_exposure;

vec3 applyExposure(vec3 c) {
  // Exposure as gamma power law (ffmpeg eq=gamma)
  float gamma = 1.0 + u_exposure / 10.0;
  gamma = max(gamma, 0.1);
  return pow(c, vec3(1.0 / gamma));
}
