// HSL single-band adjustment (target hue + hue/saturation/luminance shifts) — adapted from darktable's WebGL color lab
uniform float u_hue;
uniform float u_hslHue;
uniform float u_hslSat;
uniform float u_hslLum;

vec3 applyHsl(vec3 c) {
  vec3 hsl = rgb2hsl(sat(c));
  float distanceToTarget = abs(fract(hsl.x - u_hslHue / 360.0 + 0.5) - 0.5);
  float band = 1.0 - smoothstep(0.08, 0.28, distanceToTarget);
  hsl.x = fract(hsl.x + u_hue / 360.0);
  hsl.y = sat(hsl.y + u_hslSat * band);
  hsl.z = sat(hsl.z + u_hslLum * band);
  return hsl2rgb(hsl);
}
