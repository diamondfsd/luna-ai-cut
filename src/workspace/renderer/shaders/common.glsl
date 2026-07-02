// HSL utilities — adapted from darktable's WebGL color lab
const vec3 lumaWeights = vec3(0.2126, 0.7152, 0.0722);

float sat(float v) { return clamp(v, 0.0, 1.0); }
vec3 sat(vec3 v) { return clamp(v, vec3(0.0), vec3(1.0)); }

float luma(vec3 c) {
  return dot(c, lumaWeights);
}

vec3 rgb2hsl(vec3 c) {
  float maxc = max(max(c.r, c.g), c.b);
  float minc = min(min(c.r, c.g), c.b);
  float h = 0.0;
  float s = 0.0;
  float l = (maxc + minc) * 0.5;
  float d = maxc - minc;
  if(d > 0.00001) {
    s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
    if(maxc == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if(maxc == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if(t < 0.0) t += 1.0;
  if(t > 1.0) t -= 1.0;
  if(t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if(t < 1.0 / 2.0) return q;
  if(t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = fract(hsl.x);
  float s = sat(hsl.y);
  float l = sat(hsl.z);
  if(s <= 0.00001) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
}

vec3 colorWheel(float hue, float amount) {
  vec3 hsl = vec3(fract(hue / 360.0), 0.55, 0.5);
  return (hsl2rgb(hsl) - vec3(0.5)) * amount;
}
