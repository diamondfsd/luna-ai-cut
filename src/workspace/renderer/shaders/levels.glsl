// Input levels (black / gray / white points with gamma) — adapted from darktable's WebGL color lab
uniform float u_levelsBlack;
uniform float u_levelsGray;
uniform float u_levelsWhite;

vec3 applyLevels(vec3 c) {
  float black = u_levelsBlack;
  float white = max(u_levelsWhite, black + 0.01);
  float gray = clamp(u_levelsGray, black + 0.01, white - 0.01);
  float gamma = log(0.5) / log((gray - black) / (white - black));
  c = clamp((c - black) / (white - black), vec3(0.0), vec3(4.0));
  return pow(c, vec3(gamma));
}
