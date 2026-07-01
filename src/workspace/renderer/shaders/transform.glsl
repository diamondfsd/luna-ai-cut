// UV containment & geometric transform (crop, rotate, flip, scale)
uniform vec2 u_aspectRatio;
uniform vec4 u_crop;
uniform float u_rotate;
uniform vec2 u_flip;
uniform float u_scale;
uniform float u_cropAspect;
uniform vec2 u_frameSize;
uniform float u_fillScale;

vec2 containUv(vec2 uv) {
  float imageAspect = max(u_aspectRatio.x, 0.0001);
  float canvasAspect = max(u_aspectRatio.y, 0.0001);
  vec2 size = vec2(1.0);
  if (canvasAspect > imageAspect) {
    size.x = imageAspect / canvasAspect;
  } else {
    size.y = canvasAspect / imageAspect;
  }
  vec2 origin = (vec2(1.0) - size) * 0.5;
  if (uv.x < origin.x || uv.y < origin.y || uv.x > origin.x + size.x || uv.y > origin.y + size.y) {
    return vec2(-1.0);
  }
  return (uv - origin) / size;
}

vec2 transformUv(vec2 uv) {
  float radiansValue = radians(u_rotate);
  float s = sin(radiansValue);
  float c = cos(radiansValue);
  vec2 outputUv = vec2(uv.x, 1.0 - uv.y);
  vec2 frameUv = u_crop.xy + outputUv * u_crop.zw;
  vec2 centered = (frameUv - 0.5) * max(u_frameSize, vec2(0.0001));
  centered /= max(u_fillScale * u_scale, 0.01);
  centered = mat2(c, -s, s, c) * centered;
  centered.x = u_flip.x > 0.5 ? -centered.x : centered.x;
  centered.y = u_flip.y > 0.5 ? -centered.y : centered.y;
  return centered / vec2(max(u_cropAspect, 0.0001), 1.0) + 0.5;
}
