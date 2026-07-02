// Input levels (black / white points) — derived from ffmpeg vf_colorlevels.c
// Formula: output = clamp((input - imin) / (imax - imin), 0, 1)
// ffmpeg colorlevels also supports per-channel and output min/max, simplified here
uniform float u_levelsBlack;
uniform float u_levelsWhite;

vec3 applyLevels(vec3 c) {
  float black = u_levelsBlack;
  float white = max(u_levelsWhite, black + 0.01);
  // ffmpeg colorlevels formula: (input - imin) / (imax - imin)
  c = clamp((c - black) / (white - black), vec3(0.0), vec3(1.0));
  return c;
}
