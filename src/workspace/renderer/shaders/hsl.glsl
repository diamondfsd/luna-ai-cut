// HSL panel removed — ffmpeg has no equivalent filter (see Phase 5)
// ffmpeg huesaturation only supports 6 fixed color regions (R/Y/G/C/B/M)
// with bitmask mode, cannot match the continuous hue range + variable radius

vec3 applyHsl(vec3 c) {
  return c;
}
