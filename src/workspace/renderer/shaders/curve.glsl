// Parametric curves (5 channels: RGB master / luminance / R / G / B)
// Point interpolation — derived from ffmpeg vf_curves.c
// ffmpeg uses cubic spline (natural/PCHIP); GLSL uses linear for simplicity
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
      float t = (x - previous.x) / max(current.x - previous.x, 0.0001);
      return mix(previous.y, current.y, t);
    }
    previous = current;
  }

  float t = (x - previous.x) / max(1.0 - previous.x, 0.0001);
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

  return c;
}
