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
    let radius = mix(1.0, 3.2, sqrt(strength)) * resolution_scale;
    let texel = vec2<f32>(params.texel_x, params.texel_y) * radius;

    let right = sample_image(uv + vec2<f32>(texel.x, 0.0));
    let left = sample_image(uv - vec2<f32>(texel.x, 0.0));
    let below = sample_image(uv + vec2<f32>(0.0, texel.y));
    let above = sample_image(uv - vec2<f32>(0.0, texel.y));
    let lower_right = sample_image(uv + texel);
    let upper_left = sample_image(uv - texel);
    let upper_right = sample_image(uv + vec2<f32>(texel.x, -texel.y));
    let lower_left = sample_image(uv + vec2<f32>(-texel.x, texel.y));

    let mean = (
        center * 4.0
        + (right + left + below + above) * 2.0
        + lower_right + upper_left + upper_right + lower_left
    ) / 16.0;
    let center_delta = center - mean;
    var variance = dot(center_delta, center_delta) * 4.0;
    variance = variance + dot(right - mean, right - mean) * 2.0;
    variance = variance + dot(left - mean, left - mean) * 2.0;
    variance = variance + dot(below - mean, below - mean) * 2.0;
    variance = variance + dot(above - mean, above - mean) * 2.0;
    variance = variance + dot(lower_right - mean, lower_right - mean);
    variance = variance + dot(upper_left - mean, upper_left - mean);
    variance = variance + dot(upper_right - mean, upper_right - mean);
    variance = variance + dot(lower_left - mean, lower_left - mean);
    return vec4<f32>(mean, variance / 48.0);
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
