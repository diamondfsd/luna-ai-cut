// Color temperature (Kelvin→RGB) — from ffmpeg vf_colortemperature.c kelvin2rgb()
// Tint (hue rotation) — from ffmpeg vf_hue.c compute_sin_and_cos()
uniform float u_temperature;
uniform float u_tint;

float _saturate_f(float v) { return clamp(v, 0.0, 1.0); }

vec3 _kelvin2rgb(float k) {
  float kelvin = k / 100.0;
  vec3 rgb;
  if (kelvin <= 66.0) {
    rgb.r = 1.0;
    rgb.g = _saturate_f(0.39008157876901960784 * log(kelvin) - 0.63184144378862745098);
  } else {
    float t = max(kelvin - 60.0, 0.0);
    rgb.r = _saturate_f(1.29293618606274509804 * pow(t, -0.1332047592));
    rgb.g = _saturate_f(1.12989086089529411765 * pow(t, -0.0755148492));
  }
  if (kelvin >= 66.0)
    rgb.b = 1.0;
  else if (kelvin <= 19.0)
    rgb.b = 0.0;
  else
    rgb.b = _saturate_f(0.54320678911019607843 * log(kelvin - 10.0) - 1.19625408914);
  return rgb;
}

// ffmpeg vf_hue.c: hue rotation in RGB using HSL conversion
// tint: -100~100 → angle ±8° (matches colorGrading.ts: hue=H=±0.08 rad ≈ ±4.6°)
vec3 _hueRotate(vec3 c, float angleDeg) {
  vec3 hsl = rgb2hsl(c);
  hsl.x = fract(hsl.x + angleDeg / 360.0);
  return hsl2rgb(hsl);
}

vec3 applyWhiteBalance(vec3 c) {
  // Temperature (kelvin2rgb)
  float kelvin = 5500.0 - u_temperature * 3000.0;
  kelvin = clamp(kelvin, 1000.0, 40000.0);
  vec3 tempMult = _kelvin2rgb(kelvin);
  c *= tempMult;

  // Tint (hue rotation — ffmpeg vf_hue.c)
  // u_tint: -1..1 → angle: ±8°
  float angle = u_tint * 8.0;
  c = _hueRotate(c, angle);

  return c;
}
