fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn sat1(v: f32) -> f32 {
    return clamp(v, 0.0, 1.0);
}

fn sat3(v: vec3<f32>) -> vec3<f32> {
    return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn hue_to_rgb(p: f32, q: f32, t_in: f32) -> f32 {
    var t = t_in;
    if (t < 0.0) { t = t + 1.0; }
    if (t > 1.0) { t = t - 1.0; }
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 1.0 / 2.0) { return q; }
    if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
}

fn rgb_to_hsl(c: vec3<f32>) -> vec3<f32> {
    let maxc = max(c.r, max(c.g, c.b));
    let minc = min(c.r, min(c.g, c.b));
    var h = 0.0;
    var s = 0.0;
    let l = (maxc + minc) * 0.5;
    let d = maxc - minc;
    if (d > 0.00001) {
        s = select(d / (maxc + minc), d / (2.0 - maxc - minc), l > 0.5);
        if (maxc == c.r) {
            h = (c.g - c.b) / d + select(0.0, 6.0, c.g < c.b);
        } else if (maxc == c.g) {
            h = (c.b - c.r) / d + 2.0;
        } else {
            h = (c.r - c.g) / d + 4.0;
        }
        h = h / 6.0;
    }
    return vec3<f32>(h, s, l);
}

fn hsl_to_rgb(hsl: vec3<f32>) -> vec3<f32> {
    let h = fract(hsl.x);
    let s = sat1(hsl.y);
    let l = sat1(hsl.z);
    if (s <= 0.00001) {
        return vec3<f32>(l);
    }
    let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
    let p = 2.0 * l - q;
    return vec3<f32>(
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    );
}

fn color_wheel(hue: f32, amount: f32) -> vec3<f32> {
    let hsl = vec3<f32>(fract(hue / 360.0), 0.55, 0.5);
    return (hsl_to_rgb(hsl) - vec3<f32>(0.5)) * amount;
}

