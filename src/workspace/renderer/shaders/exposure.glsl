// Exposure — adapted from darktable's basicadj module
uniform float u_exposure;

vec3 applyExposure(vec3 c) {
  return c * exp2(u_exposure);
}
