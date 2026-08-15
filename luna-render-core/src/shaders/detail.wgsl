fn sample_image(uv: vec2<f32>) -> vec3<f32> {
    return textureSample(src_texture, src_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
}

fn blur3(uv: vec2<f32>) -> vec3<f32> {
    let texel = vec2<f32>(params.texel_x, params.texel_y);
    var sum = sample_image(uv) * 4.0;
    sum = sum + sample_image(uv + vec2<f32>(texel.x, 0.0)) * 2.0;
    sum = sum + sample_image(uv - vec2<f32>(texel.x, 0.0)) * 2.0;
    sum = sum + sample_image(uv + vec2<f32>(0.0, texel.y)) * 2.0;
    sum = sum + sample_image(uv - vec2<f32>(0.0, texel.y)) * 2.0;
    sum = sum + sample_image(uv + texel);
    sum = sum + sample_image(uv - texel);
    sum = sum + sample_image(uv + vec2<f32>(texel.x, -texel.y));
    sum = sum + sample_image(uv + vec2<f32>(-texel.x, texel.y));
    return sum / 16.0;
}

// Return the local low-frequency color and variance in one nine-sample pass.
// The variance lets the caller smooth flat skin while protecting facial
// features and illumination boundaries.
fn beauty_statistics(uv: vec2<f32>, strength: f32) -> vec4<f32> {
    let center = sample_image(uv);
    let source_short_side = min(1.0 / params.texel_x, 1.0 / params.texel_y);
    let resolution_scale = clamp(source_short_side / 1080.0, 1.0, 1.8);
    let radius = mix(1.25, 5.5, sqrt(strength)) * resolution_scale;
    let texel = vec2<f32>(params.texel_x, params.texel_y) * radius;

    let right = sample_image(uv + vec2<f32>(texel.x, 0.0));
    let left = sample_image(uv - vec2<f32>(texel.x, 0.0));
    let below = sample_image(uv + vec2<f32>(0.0, texel.y));
    let above = sample_image(uv - vec2<f32>(0.0, texel.y));
    let lower_right = sample_image(uv + texel);
    let upper_left = sample_image(uv - texel);
    let upper_right = sample_image(uv + vec2<f32>(texel.x, -texel.y));
    let lower_left = sample_image(uv + vec2<f32>(-texel.x, texel.y));

    let range_scale = mix(0.0025, 0.012, strength);
    let right_weight = 2.0 * exp(-dot(right - center, right - center) / range_scale);
    let left_weight = 2.0 * exp(-dot(left - center, left - center) / range_scale);
    let below_weight = 2.0 * exp(-dot(below - center, below - center) / range_scale);
    let above_weight = 2.0 * exp(-dot(above - center, above - center) / range_scale);
    let lower_right_weight = exp(-dot(lower_right - center, lower_right - center) / range_scale);
    let upper_left_weight = exp(-dot(upper_left - center, upper_left - center) / range_scale);
    let upper_right_weight = exp(-dot(upper_right - center, upper_right - center) / range_scale);
    let lower_left_weight = exp(-dot(lower_left - center, lower_left - center) / range_scale);
    let weight_sum = 4.0 + right_weight + left_weight + below_weight + above_weight
        + lower_right_weight + upper_left_weight + upper_right_weight + lower_left_weight;
    let mean = (
        center * 4.0
        + right * right_weight
        + left * left_weight
        + below * below_weight
        + above * above_weight
        + lower_right * lower_right_weight
        + upper_left * upper_left_weight
        + upper_right * upper_right_weight
        + lower_left * lower_left_weight
    ) / weight_sum;
    var variance = dot(center - mean, center - mean) * 4.0;
    variance = variance + dot(right - mean, right - mean) * right_weight;
    variance = variance + dot(left - mean, left - mean) * left_weight;
    variance = variance + dot(below - mean, below - mean) * below_weight;
    variance = variance + dot(above - mean, above - mean) * above_weight;
    variance = variance + dot(lower_right - mean, lower_right - mean) * lower_right_weight;
    variance = variance + dot(upper_left - mean, upper_left - mean) * upper_left_weight;
    variance = variance + dot(upper_right - mean, upper_right - mean) * upper_right_weight;
    variance = variance + dot(lower_left - mean, lower_left - mean) * lower_left_weight;
    return vec4<f32>(mean, variance / max(weight_sum * 3.0, 0.0001));
}

// 13×13 高斯核仅供柔焦版式背景使用。半径按源纹理像素计算，
// 连续取样而不是跨大步长抽点，避免出现重影和方块状虚化。
fn aperture_blur(uv: vec2<f32>, radius: f32) -> vec3<f32> {
    let texel = vec2<f32>(params.texel_x, params.texel_y);
    let step_size = max(radius, 1.0) / 6.0;
    var sum = vec3<f32>(0.0);
    var weight_sum = 0.0;
    for (var y = -6; y <= 6; y = y + 1) {
        for (var x = -6; x <= 6; x = x + 1) {
            let distance_squared = f32(x * x + y * y);
            let weight = exp(-distance_squared / 18.0);
            let offset = vec2<f32>(f32(x), f32(y)) * texel * step_size;
            sum = sum + sample_image(uv + offset) * weight;
            weight_sum = weight_sum + weight;
        }
    }
    return sum / max(weight_sum, 0.0001);
}

fn aperture_highlight_blur(uv: vec2<f32>, radius: f32, threshold: f32) -> vec3<f32> {
    let texel = vec2<f32>(params.texel_x, params.texel_y);
    let step_size = max(radius, 1.0) / 6.0;
    var sum = vec3<f32>(0.0);
    var weight_sum = 0.0;
    for (var y = -6; y <= 6; y = y + 1) {
        for (var x = -6; x <= 6; x = x + 1) {
            let distance_squared = f32(x * x + y * y);
            let kernel_weight = exp(-distance_squared / 18.0);
            let offset = vec2<f32>(f32(x), f32(y)) * texel * step_size;
            let sample = sample_image(uv + offset);
            let encoded_luma = pow(sat1(luminance(sample)), 1.0 / 2.2);
            let highlight_weight = smoothstep(max(0.0, threshold - 0.12), min(1.0, threshold + 0.12), encoded_luma);
            sum = sum + sample * highlight_weight * kernel_weight;
            weight_sum = weight_sum + kernel_weight;
        }
    }
    return sum / max(weight_sum, 0.0001);
}
