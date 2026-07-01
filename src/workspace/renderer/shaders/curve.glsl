// Parametric curves (RGB master, luminance, R/G/B channels) — adapted from darktable's WebGL color lab
uniform float u_curveLift;
uniform float u_curveContrast;

uniform int u_curveRgbPointCount;
uniform int u_curveLuminancePointCount;
uniform int u_curveRedPointCount;
uniform int u_curveGreenPointCount;
uniform int u_curveBluePointCount;
uniform vec2 u_curveRgbPoints[12];
uniform vec2 u_curveLuminancePoints[12];
uniform vec2 u_curveRedPoints[12];
uniform vec2 u_curveGreenPoints[12];
uniform vec2 u_curveBluePoints[12];

float evalCurvePoints(float x, int count, vec2 points[12]) {
  if(count <= 0) return x;

  vec2 previous = vec2(0.0, 0.0);
  for(int i = 0; i < 12; i++) {
    if(i >= count) break;
    vec2 current = points[i];
    if(x <= current.x) {
      float t = smoothstep(previous.x, current.x, x);
      return mix(previous.y, current.y, t);
    }
    previous = current;
  }

  float t = smoothstep(previous.x, 1.0, x);
  return mix(previous.y, 1.0, t);
}

vec3 applyRgbCurve(vec3 c, int count, vec2 points[12]) {
  if(count <= 0) return c;
  return vec3(
    evalCurvePoints(clamp(c.r, 0.0, 1.0), count, points),
    evalCurvePoints(clamp(c.g, 0.0, 1.0), count, points),
    evalCurvePoints(clamp(c.b, 0.0, 1.0), count, points)
  );
}

vec3 applyLuminanceCurve(vec3 c, int count, vec2 points[12]) {
  if(count <= 0) return c;
  float y = clamp(luma(c), 0.0, 1.0);
  float shaped = evalCurvePoints(y, count, points);
  float ratio = y > 0.0001 ? shaped / y : 0.0;
  return c * ratio;
}

vec3 applyCurve(vec3 c) {
  c = applyRgbCurve(c, u_curveRgbPointCount, u_curveRgbPoints);
  c = applyLuminanceCurve(c, u_curveLuminancePointCount, u_curveLuminancePoints);

  if(u_curveRedPointCount > 0) c.r = evalCurvePoints(clamp(c.r, 0.0, 1.0), u_curveRedPointCount, u_curveRedPoints);
  if(u_curveGreenPointCount > 0) c.g = evalCurvePoints(clamp(c.g, 0.0, 1.0), u_curveGreenPointCount, u_curveGreenPoints);
  if(u_curveBluePointCount > 0) c.b = evalCurvePoints(clamp(c.b, 0.0, 1.0), u_curveBluePointCount, u_curveBluePoints);

  float y = clamp(luma(c), 0.0, 1.0);
  float sCurve = y * y * (3.0 - 2.0 * y);
  float shaped = mix(y, sCurve, u_curveContrast);
  shaped = sat(shaped + u_curveLift * (1.0 - abs(2.0 * y - 1.0)));
  float ratio = y > 0.0001 ? shaped / y : 0.0;
  return c * ratio;
}
