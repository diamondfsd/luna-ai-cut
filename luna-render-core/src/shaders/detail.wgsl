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

