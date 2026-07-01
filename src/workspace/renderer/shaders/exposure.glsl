// Exposure & black point — adapted from darktable's WebGL color lab
uniform float u_exposure;
uniform float u_black;

vec3 applyExposure(vec3 c) {
  return (c - u_black) * exp2(u_exposure);
}
