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
