// Color temperature (Kelvin→RGB) — from ffmpeg vf_colortemperature.c kelvin2rgb()
// Tint (green-magenta balance) — from ffmpeg vf_colorbalance.c green channel adjustment
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

vec3 applyWhiteBalance(vec3 c) {
  // Temperature (kelvin2rgb) + luminance preservation
  float kelvin = 5500.0 - u_temperature * 3000.0;
  kelvin = clamp(kelvin, 1000.0, 40000.0);
  vec3 tempMult = _kelvin2rgb(kelvin);
  vec3 adjusted = c * tempMult;

  // Luminance preservation (ffmpeg vf_colortemperature.c PROCESS())
  float l0 = max(max(c.r, c.g), c.b) + min(min(c.r, c.g), c.b) + 0.0001;
  float l1 = max(max(adjusted.r, adjusted.g), adjusted.b) + min(min(adjusted.r, adjusted.g), adjusted.b) + 0.0001;
  c = adjusted * (l0 / l1);

  // Tint: green-magenta balance (NOT hue rotation!)
  // u_tint: -1..1
  // Positive tint → reduce green → more magenta
  // Negative tint → increase green → more green
  // Matches ffmpeg colorbalance gs/gm/gh = -tint*0.214
  c.g -= u_tint * 0.15;

  return c;
}
