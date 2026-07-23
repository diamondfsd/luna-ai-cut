fn curve_point(base: u32, index: u32) -> vec2<f32> {
    let packed = params.curve_data[base + index / 2u];
    if ((index & 1u) == 0u) {
        return packed.xy;
    }
    return packed.zw;
}

fn eval_curve_points(x: f32, count_f: f32, base: u32) -> f32 {
    let count = u32(clamp(count_f, 0.0, 12.0));
    if (count == 0u) {
        return x;
    }
    var previous = vec2<f32>(0.0, 0.0);
    for (var i = 0u; i < 12u; i = i + 1u) {
        if (i >= count) { break; }
        let current = curve_point(base, i);
        if (x <= current.x) {
            let t = smoothstep(previous.x, current.x, x);
            return mix(previous.y, current.y, t);
        }
        previous = current;
    }
    let t = smoothstep(previous.x, 1.0, x);
    return mix(previous.y, 1.0, t);
}

fn apply_rgb_curve(c: vec3<f32>, count: f32, base: u32) -> vec3<f32> {
    if (count <= 0.0) { return c; }
    return vec3<f32>(
        eval_curve_points(clamp(c.r, 0.0, 1.0), count, base),
        eval_curve_points(clamp(c.g, 0.0, 1.0), count, base),
        eval_curve_points(clamp(c.b, 0.0, 1.0), count, base),
    );
}

fn apply_luminance_curve(c: vec3<f32>, count: f32, base: u32) -> vec3<f32> {
    if (count <= 0.0) { return c; }
    let y = clamp(luminance(c), 0.0, 1.0);
    let shaped = eval_curve_points(y, count, base);
    let ratio = select(0.0, shaped / y, y > 0.0001);
    return c * ratio;
}

