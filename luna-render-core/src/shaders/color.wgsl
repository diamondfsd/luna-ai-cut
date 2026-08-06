fn apply_color(input: vec3<f32>, tex_coord: vec2<f32>, layer_x: f32) -> vec3<f32> {
    let raw = apply_restore_lut(input);
    var blurred = raw;
    var smoothing_mix = 0.0;
    if (params.denoise > 100.0) {
        blurred = apply_restore_lut(aperture_blur(tex_coord, (params.denoise - 100.0) / 100.0));
        smoothing_mix = 1.0;
    } else if (params.denoise > 0.0 || abs(params.texture) > 0.0 || abs(params.clarity) > 0.0 || abs(params.sharpen) > 0.0) {
        let strength = sat1(params.denoise / 100.0);
        let detail_strength = max(strength, 0.35);
        let statistics = beauty_statistics(tex_coord, detail_strength);
        blurred = apply_restore_lut(statistics.rgb);
        if (params.denoise > 0.0) {
            let flat_skin = 1.0 - smoothstep(0.0002, 0.003, statistics.a);
            let local_detail = length(raw - blurred);
            let feature_protection = smoothstep(0.018, 0.075, local_detail);
            let strength_curve = pow(strength, 1.25);
            smoothing_mix = strength_curve * 0.52 * flat_skin * (1.0 - feature_protection * 0.9);
        }
    }
    let detail = raw - blurred;
    var c = raw;
    c = mix(raw, blurred, smoothing_mix);

    c = (c - params.black) * exp2(params.exposure);
    let brightness_amount = params.brightness / 100.0;
    let bounded_brightness = sat3(c);
    let midtone_weight = bounded_brightness * (vec3<f32>(1.0) - bounded_brightness);
    let brightness_strength = select(0.9, 1.25, brightness_amount >= 0.0);
    c = c + midtone_weight * brightness_amount * brightness_strength;

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
    // Keep the black point anchored. Additive lifting turned neutral shadows
    // into a gray veil, especially when the slider was raised.
    c = c - c * (params.blacks / 100.0) * shadow_mask * 0.85;
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

    let contrast_amount = params.contrast / 100.0;
    if (contrast_amount >= 0.0) {
        // Shape contrast in display space so small positive adjustments do not
        // crush linear shadows or clip highlights around the mid-gray pivot.
        let pivot = 0.466;
        let strength = 1.0 + contrast_amount * 0.55;
        let encoded = linear_to_srgb(sat3(c));
        let below = pivot * pow(max(encoded / pivot, vec3<f32>(0.0)), vec3<f32>(strength));
        let above = 1.0 - (1.0 - pivot) * pow(
            max((vec3<f32>(1.0) - encoded) / (1.0 - pivot), vec3<f32>(0.0)),
            vec3<f32>(strength),
        );
        c = srgb_to_linear(select(below, above, encoded >= vec3<f32>(pivot)));
    } else {
        // Compress brighter tones toward the existing shadows instead of
        // lifting the whole image toward a gray pivot.
        let compression = -contrast_amount;
        let positive = max(c, vec3<f32>(0.0));
        c = positive * (1.0 + compression * 0.15)
            / (vec3<f32>(1.0) + positive * compression * 0.75);
    }
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

    // HSL is a perceptual control, so perform it in display-encoded space.
    // Linear-light HSL exaggerates small channel differences in smooth skies.
    var hsl = rgb_to_hsl(linear_to_srgb(sat3(c)));
    var source_hsl = hsl;
    var hsl_activity = 0.0;
    for (var i = 0u; i < 12u; i = i + 1u) {
        let channel = params.hsl_data[i];
        hsl_activity = max(hsl_activity, max(abs(channel.y), max(abs(channel.z), abs(channel.w))));
    }
    if (hsl_activity > 0.001) {
        var stable_color = apply_restore_lut(blur3(tex_coord));
        stable_color = (stable_color - params.black) * exp2(params.exposure);
        let stable_bounded = sat3(stable_color);
        let stable_midtone_weight = stable_bounded * (vec3<f32>(1.0) - stable_bounded);
        stable_color = stable_color + stable_midtone_weight * brightness_amount * brightness_strength;
        stable_color = stable_color * wb;
        source_hsl = rgb_to_hsl(linear_to_srgb(sat3(stable_color)));
    }
    // Low-chroma pixels have an unstable hue. Excluding them prevents neutral
    // texture and sensor noise from turning into saturated color speckles.
    let chroma_weight = smoothstep(0.06, 0.22, source_hsl.y);
    let shadow_weight = smoothstep(0.02, 0.1, source_hsl.z);
    let highlight_weight = 1.0 - smoothstep(0.92, 0.995, source_hsl.z);
    var hue_adjustment = 0.0;
    var saturation_adjustment = 0.0;
    var luminance_adjustment = 0.0;
    for (var i = 0u; i < 12u; i = i + 1u) {
        let channel = params.hsl_data[i];
        let target_hue = channel.x / 360.0;
        let distance_to_target = abs(fract(source_hsl.x - target_hue + 0.5) - 0.5);
        let band = (1.0 - smoothstep(0.04, 0.13, distance_to_target))
            * chroma_weight * shadow_weight * highlight_weight;
        hue_adjustment = hue_adjustment + channel.y / 360.0 * band;
        saturation_adjustment = saturation_adjustment + channel.z / 100.0 * band;
        luminance_adjustment = luminance_adjustment + channel.w / 100.0 * band;
    }
    let stable_hue_delta = fract(source_hsl.x - hsl.x + 0.5) - 0.5;
    let hue_stabilization = sat1(abs(hue_adjustment) * 4.0)
        * (1.0 - smoothstep(0.45, 0.85, source_hsl.y)) * 0.65;
    hsl.x = fract(hsl.x + stable_hue_delta * hue_stabilization + clamp(hue_adjustment, -0.5, 0.5));
    // Positive saturation now scales existing chroma instead of forcing every
    // selected pixel to full saturation. Adjacent bands are applied once.
    hsl.y = sat1(hsl.y * (1.0 + clamp(saturation_adjustment, -1.0, 1.0)));
    let safe_luminance_adjustment = clamp(luminance_adjustment, -1.0, 1.0);
    if (safe_luminance_adjustment >= 0.0) {
        hsl.z = hsl.z + (1.0 - hsl.z) * safe_luminance_adjustment;
    } else {
        hsl.z = hsl.z * (1.0 + safe_luminance_adjustment);
    }
    c = srgb_to_linear(hsl_to_rgb(hsl));

    c = c + detail * params.sharpen / 100.0 * 1.5;
    c = apply_lut(c);
    if (params.glow.x > 0.001) {
        let glow_radius = mix(3.0, 30.0, params.glow.y / 100.0);
        let threshold = params.glow.z / 100.0;
        let glow_sample = apply_restore_lut(aperture_highlight_blur(tex_coord, glow_radius, threshold));
        let glow = sat3(glow_sample * params.glow.x / 100.0 * 0.9);
        c = vec3<f32>(1.0) - (vec3<f32>(1.0) - sat3(c)) * (vec3<f32>(1.0) - glow);
    }
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
    let encoded_color = linear_to_srgb(sat3(color));
    let lut_size = params.lut_size;
    let scale = (lut_size - 1.0) / lut_size;
    let offset = 0.5 / lut_size;
    let uvw = encoded_color * scale + offset;
    let lut_color = textureSampleLevel(lut_texture, lut_sampler, uvw, 0.0).rgb;
    let intensity = sat1(params.lut_intensity / 100.0);
    return srgb_to_linear(mix(encoded_color, lut_color, intensity));
}

fn apply_restore_lut(color: vec3<f32>) -> vec3<f32> {
    if (params.restore_lut_size <= 0.0) {
        return color;
    }
    let encoded_color = linear_to_srgb(sat3(color));
    let scale = (params.restore_lut_size - 1.0) / params.restore_lut_size;
    let offset = 0.5 / params.restore_lut_size;
    let lut_color = textureSampleLevel(
        restore_lut_texture,
        lut_sampler,
        encoded_color * scale + offset,
        0.0,
    ).rgb;
    return srgb_to_linear(lut_color);
}

fn linear_to_srgb(color: vec3<f32>) -> vec3<f32> {
    let low = color * 12.92;
    let high = 1.055 * pow(color, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(high, low, color <= vec3<f32>(0.0031308));
}

fn srgb_to_linear(color: vec3<f32>) -> vec3<f32> {
    let low = color / 12.92;
    let high = pow((color + 0.055) / 1.055, vec3<f32>(2.4));
    return select(high, low, color <= vec3<f32>(0.04045));
}
