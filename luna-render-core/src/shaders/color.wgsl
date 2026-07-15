fn apply_color(input: vec3<f32>, tex_coord: vec2<f32>, layer_x: f32) -> vec3<f32> {
    let raw = input;
    let blurred = blur3(tex_coord);
    let detail = raw - blurred;
    var c = input;
    c = mix(raw, blurred, sat1(params.denoise / 100.0));

    c = (c - params.black) * exp2(params.exposure);
    c = c + vec3<f32>(params.brightness / 100.0);

    let wb = vec3<f32>(
        1.0 + params.temperature / 100.0 * 0.18 + params.tint / 100.0 * 0.04,
        1.0 - params.tint / 100.0 * 0.12,
        1.0 - params.temperature / 100.0 * 0.18 + params.tint / 100.0 * 0.04,
    );
    c = c * wb;

    var y = luminance(c);
    let shadow_mask = pow(1.0 - y, 2.0);
    let high_mask = pow(y, 2.0);
    c = c + c * (params.shadows / 100.0) * shadow_mask * 0.9;
    c = c + c * (params.highlights / 100.0) * high_mask * 0.9;
    c = c + (params.blacks / 100.0) * shadow_mask * 0.35;
    c = c + (params.whites / 100.0) * high_mask * 0.35;

    c = c + detail * (params.texture / 100.0 * 1.2 + params.clarity / 100.0 * 1.8);

    let black = params.levels_black;
    let white = max(params.levels_white, black + 0.01);
    let gray = clamp(params.levels_gray, black + 0.01, white - 0.01);
    let gamma = log(0.5) / log((gray - black) / (white - black));
    c = clamp((c - black) / (white - black), vec3<f32>(0.0), vec3<f32>(4.0));
    c = pow(c, vec3<f32>(gamma));

    y = luminance(c);
    let sh = pow(1.0 - y, 2.0);
    let hi = pow(y, 2.0);
    let mid = sat1(1.0 - abs(y - 0.5) * 2.0);
    c = c + color_wheel(params.grade_shadows_hue, params.grade_shadows_amount / 100.0) * sh;
    c = c + color_wheel(params.grade_mid_hue, params.grade_mid_amount / 100.0) * mid;
    c = c + color_wheel(params.grade_highlights_hue, params.grade_highlights_amount / 100.0) * hi;

    let pivot = 0.1845;
    c = (c - pivot) * (1.0 + params.contrast / 100.0 * 1.35) + pivot;
    let gray_luma = luminance(c);
    c = mix(vec3<f32>(gray_luma), c, 1.0 + params.saturation / 100.0);
    let maxc = max(c.r, max(c.g, c.b));
    let minc = min(c.r, min(c.g, c.b));
    let chroma = maxc - minc;
    c = mix(vec3<f32>(gray_luma), c, 1.0 + params.vibrance / 100.0 * (1.0 - sat1(chroma)));

    c = apply_rgb_curve(c, params.curve_rgb_count, 0u);
    c = apply_luminance_curve(c, params.curve_luminance_count, 6u);
    if (params.curve_red_count > 0.0) {
        c.r = eval_curve_points(clamp(c.r, 0.0, 1.0), params.curve_red_count, 12u);
    }
    if (params.curve_green_count > 0.0) {
        c.g = eval_curve_points(clamp(c.g, 0.0, 1.0), params.curve_green_count, 18u);
    }
    if (params.curve_blue_count > 0.0) {
        c.b = eval_curve_points(clamp(c.b, 0.0, 1.0), params.curve_blue_count, 24u);
    }

    y = clamp(luminance(c), 0.0, 1.0);
    let s_curve = y * y * (3.0 - 2.0 * y);
    var shaped = mix(y, s_curve, params.curve_contrast / 100.0);
    shaped = sat1(shaped + params.curve_lift / 100.0 * (1.0 - abs(2.0 * y - 1.0)));
    let ratio = select(0.0, shaped / y, y > 0.0001);
    c = c * ratio;

    var hsl = rgb_to_hsl(sat3(c));
    for (var i = 0u; i < 8u; i = i + 1u) {
        let channel = params.hsl_data[i];
        let target_hue = channel.x / 360.0;
        let distance_to_target = abs(fract(hsl.x - target_hue + 0.5) - 0.5);
        let band = 1.0 - smoothstep(0.08, 0.28, distance_to_target);
        hsl.x = fract(hsl.x + channel.y / 360.0 * band);
        hsl.y = sat1(hsl.y + channel.z / 100.0 * band);
        hsl.z = sat1(hsl.z + channel.w / 100.0 * band);
    }
    c = hsl_to_rgb(hsl);

    c = c + detail * params.sharpen / 100.0 * 1.5;
    c = apply_lut(c);
    let reveal_progress = params.text_meta.w;
    if (reveal_progress > 0.001 && reveal_progress < 0.999) {
        let edge_distance_px = (reveal_progress - layer_x) * params.dst_w;
        let edge_alpha = (1.0 - smoothstep(0.0, 0.8, edge_distance_px)) * 0.28;
        c = mix(c, vec3<f32>(1.0), sat1(edge_alpha));
    }
    return sat3(c);
}

fn apply_lut(color: vec3<f32>) -> vec3<f32> {
    if (params.lut_size <= 0.0) {
        return color;
    }
    let lut_size = params.lut_size;
    let scale = (lut_size - 1.0) / lut_size;
    let offset = 0.5 / lut_size;
    let uvw = sat3(color) * scale + offset;
    let lut_color = textureSampleLevel(lut_texture, lut_sampler, uvw, 0.0).rgb;
    let intensity = sat1(params.lut_intensity / 100.0);
    return mix(color, lut_color, intensity);
}
