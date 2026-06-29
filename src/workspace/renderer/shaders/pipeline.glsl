#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_aspectRatio;
uniform vec4 u_crop;
uniform float u_rotate;
uniform vec2 u_flip;
uniform float u_scale;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_temperature;
uniform float u_tint;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_clarity;
uniform float u_dehaze;
uniform float u_sharpen;
uniform float u_vignette;

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
  vec2 cropUv = u_crop.xy + uv * u_crop.zw;
  vec2 centered = cropUv - 0.5;
  centered /= max(u_scale, 0.01);
  float radiansValue = radians(u_rotate);
  float s = sin(radiansValue);
  float c = cos(radiansValue);
  centered = mat2(c, -s, s, c) * centered;
  centered.x = u_flip.x > 0.5 ? -centered.x : centered.x;
  centered.y = u_flip.y > 0.5 ? -centered.y : centered.y;
  return centered + 0.5;
}

vec3 applyColor(vec3 color) {
  color *= pow(2.0, u_exposure);
  color = (color - 0.5) * (1.0 + u_contrast) + 0.5;

  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = vec3(luma);
  color = mix(gray, color, 1.0 + u_saturation);
  float vibranceMask = clamp(1.0 - abs(max(max(color.r, color.g), color.b) - luma), 0.0, 1.0);
  color = mix(gray, color, 1.0 + u_vibrance * vibranceMask);

  color.r += u_temperature * 0.08 + u_tint * 0.025;
  color.b -= u_temperature * 0.08;
  color.g += u_tint * 0.04;

  float highlightMask = smoothstep(0.45, 1.0, luma);
  float shadowMask = 1.0 - smoothstep(0.0, 0.55, luma);
  color += highlightMask * u_highlights * 0.18;
  color += shadowMask * u_shadows * 0.18;
  color += smoothstep(0.7, 1.0, luma) * u_whites * 0.12;
  color += (1.0 - smoothstep(0.0, 0.3, luma)) * u_blacks * 0.12;
  color = mix(color, (color - 0.5) * (1.0 + u_clarity) + 0.5, 0.35);
  color += (color - gray) * u_dehaze * 0.3;
  return clamp(color, 0.0, 1.0);
}

vec3 applySharpen(vec2 uv, vec3 color) {
  if (u_sharpen <= 0.001) return color;
  vec2 texel = 1.0 / max(u_resolution, vec2(1.0));
  vec3 north = texture(u_texture, uv + vec2(0.0, texel.y)).rgb;
  vec3 south = texture(u_texture, uv - vec2(0.0, texel.y)).rgb;
  vec3 east = texture(u_texture, uv + vec2(texel.x, 0.0)).rgb;
  vec3 west = texture(u_texture, uv - vec2(texel.x, 0.0)).rgb;
  vec3 edge = color * 5.0 - north - south - east - west;
  return clamp(mix(color, edge, u_sharpen), 0.0, 1.0);
}

vec3 applyVignette(vec2 uv, vec3 color) {
  if (u_vignette <= 0.001) return color;
  float distanceFromCenter = distance(uv, vec2(0.5));
  float amount = smoothstep(0.25, 0.75, distanceFromCenter) * u_vignette;
  return color * (1.0 - amount * 0.55);
}

void main() {
  vec2 containedUv = containUv(v_uv);
  if (containedUv.x < 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 uv = transformUv(containedUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec4 source = texture(u_texture, vec2(uv.x, 1.0 - uv.y));
  vec3 color = applyColor(source.rgb);
  color = applySharpen(uv, color);
  color = applyVignette(containedUv, color);
  fragColor = vec4(color, source.a);
}
