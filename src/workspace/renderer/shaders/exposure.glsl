// ffmpeg eq filter (vf_eq.c) — combined gamma + brightness + contrast + saturation
//
// ffmpeg create_lut() applies in order:
//   v = contrast * (v - 0.5) + 0.5 + brightness
//   v = pow(v, 1/gamma)                    (gamma_weight=1)
uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;

vec3 applyEq(vec3 c) {
  // 1. Contrast: c' = (c - 0.5) * contrast + 0.5
  // u_contrast: -100..100 → multiplier 0..2 (ffmpeg eq=contrast)
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;

  // 2. Brightness: c' = c + brightness (ffmpeg eq=brightness)
  c += u_brightness / 100.0;

  // 3. Gamma (exposure): c' = pow(c, 1/gamma) (ffmpeg eq=gamma)
  // u_exposure: -5..5 EV → gamma 0.5..1.5
  float gamma = 1.0 + u_exposure / 10.0;
  gamma = max(gamma, 0.1);
  c = pow(max(c, 0.0), vec3(1.0 / gamma));

  // 4. Saturation: c' = mix(luma, c, sat) (ffmpeg eq=saturation)
  float gray = luma(c);
  c = mix(vec3(gray), c, 1.0 + u_saturation);

  return c;
}

// Vibrance (ffmpeg vf_vibrance.c — protect high-chroma areas)
uniform float u_vibrance;
vec3 applyVibrance(vec3 c) {
  float gray = luma(c);
  float maxc = max(max(c.r, c.g), c.b);
  float chroma = maxc - min(min(c.r, c.g), c.b);
  return mix(vec3(gray), c, 1.0 + u_vibrance * (1.0 - sat(chroma)));
}
