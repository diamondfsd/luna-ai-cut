@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let pixel_x = in.position.x;
    let pixel_y = in.position.y;

    let in_rect = pixel_x >= params.dst_x
        && pixel_x < params.dst_x + params.dst_w
        && pixel_y >= params.dst_y
        && pixel_y < params.dst_y + params.dst_h;

    if (!in_rect) {
        discard;
    }

    let local_x = (pixel_x - params.dst_x) / params.dst_w;
    let local_y = (pixel_y - params.dst_y) / params.dst_h;
    let frame_uv = vec2<f32>(
        params.crop_x + local_x * params.crop_w,
        params.crop_y + local_y * params.crop_h,
    );
    var centered = (frame_uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(
        max(params.frame_w, 0.0001),
        max(params.frame_h, 0.0001),
    );
    centered = centered / max(params.scale, 0.0001) - vec2<f32>(params.translate_x, params.translate_y);
    let radians_value = (params.orientation + params.rotate) * 0.017453292519943295;
    let s = sin(radians_value);
    let c = cos(radians_value);
    centered = vec2<f32>(
        centered.x * c + centered.y * s,
        -centered.x * s + centered.y * c,
    );
    if (params.flip_h > 0.5) {
        centered.x = -centered.x;
    }
    if (params.flip_v > 0.5) {
        centered.y = -centered.y;
    }
    let source_local = centered / vec2<f32>(max(params.source_aspect, 0.0001), 1.0) + vec2<f32>(0.5, 0.5);
    if (source_local.x < 0.0 || source_local.x > 1.0 || source_local.y < 0.0 || source_local.y > 1.0) {
        discard;
    }
    let tex_coord = vec2<f32>(
        params.src_x + source_local.x * params.src_w,
        params.src_y + source_local.y * params.src_h,
    );

    var color = textureSample(src_texture, src_sampler, tex_coord);
    color = vec4<f32>(apply_color(color.rgb, tex_coord), color.a);
    color.a = color.a * params.opacity;
    return color;
}
