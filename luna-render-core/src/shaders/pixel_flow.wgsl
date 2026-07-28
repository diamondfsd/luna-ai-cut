fn pixel_flow_hash(cell: vec2<f32>) -> f32 {
    return fract(sin(dot(cell, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

// Returns arrival time plus sky/background/subject weights encoded in the depth mask.
fn pixel_flow_cell(cell_uv: vec2<f32>, cell_index: vec2<f32>, source_size: vec2<f32>, cell_px: f32) -> vec4<f32> {
    let depth = textureSampleLevel(mask_texture, src_sampler, clamp(cell_uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).r;
    let sky = 1.0 - smoothstep(0.22, 0.4, depth);
    let subject = smoothstep(0.66, 0.84, depth);
    let background = max(0.0, 1.0 - sky - subject);
    let origin = params.pixel_flow_geometry.xy;
    let impact = params.pixel_flow_geometry.zw;
    let origin_px = origin * source_size;
    let impact_px = impact * source_size;
    let cell_center_px = cell_uv * source_size;
    let coarse_noise = pixel_flow_hash(cell_index);
    let fine_noise = pixel_flow_hash(cell_index * vec2<f32>(2.71, 1.93) + vec2<f32>(19.0, 47.0));
    let timing_jitter = (coarse_noise - 0.5) * 0.07 + (fine_noise - 0.5) * 0.035;
    let delta = cell_center_px - impact_px;
    let impact_distance = length(delta);
    let impact_maximum_distance = max(
        max(length(impact_px), length(vec2<f32>(source_size.x - impact_px.x, impact_px.y))),
        max(length(vec2<f32>(impact_px.x, source_size.y - impact_px.y)), length(source_size - impact_px)),
    );
    let impact_radius = impact_distance / max(1.0, impact_maximum_distance);
    let sky_delta = cell_center_px - origin_px;
    let sky_maximum_distance = max(
        max(length(origin_px), length(vec2<f32>(source_size.x - origin_px.x, origin_px.y))),
        max(length(vec2<f32>(origin_px.x, source_size.y - origin_px.y)), length(source_size - origin_px)),
    );
    let sky_radius = length(sky_delta) / max(1.0, sky_maximum_distance);
    let vertical_fall = clamp((cell_uv.y - impact.y * 0.72) / max(0.08, 1.0 - impact.y * 0.72), 0.0, 1.0);
    let depth_strength = clamp(params.pixel_flow_depth.x / 100.0, 0.0, 1.0);
    let sky_arrival = 0.025 + sky_radius * 0.25 + timing_jitter * 0.28;
    let background_arrival = 0.27
        + vertical_fall * 0.34
        + depth_strength * 0.045
        + timing_jitter;
    let subject_arrival = 0.41
        + vertical_fall * 0.3
        + depth_strength * 0.13
        + timing_jitter * 0.82;
    let arrival = sky * sky_arrival + background * background_arrival + subject * subject_arrival;
    return vec4<f32>(arrival, sky, background, subject);
}

fn pixel_flow_light(distance: f32, band: f32, subject: f32, edge_hold: f32) -> f32 {
    let fade_in = band * 0.9;
    let fade_out = band * mix(2.5, 3.5, subject) + edge_hold * 0.085;
    let linear = select(1.0 + distance / fade_out, 1.0 - distance / fade_in, distance >= 0.0);
    let clamped = clamp(linear, 0.0, 1.0);
    return clamped * clamped * (3.0 - 2.0 * clamped);
}
