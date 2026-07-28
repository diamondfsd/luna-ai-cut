fn pixel_flow_hash(cell: vec2<f32>) -> f32 {
    return fract(sin(dot(cell, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn pixel_flow_source_luma(uv: vec2<f32>) -> f32 {
    let color = textureSampleLevel(src_texture, src_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn pixel_flow_bloom_tap(uv: vec2<f32>) -> vec3<f32> {
    let color = textureSampleLevel(src_texture, src_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
    let luma = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    let peak = max(color.r, max(color.g, color.b));
    let energy = smoothstep(0.34, 0.86, max(luma, peak * 0.72));
    return color * energy + vec3<f32>(energy * energy * 0.16);
}

fn pixel_flow_ccd_bloom(uv: vec2<f32>, radius: vec2<f32>) -> vec3<f32> {
    let inner = radius * 0.9;
    let middle = radius * 1.8;
    let outer = radius * 3.4;
    var bloom = pixel_flow_bloom_tap(uv) * 0.24;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(inner.x, 0.0)) * 0.11;
    bloom += pixel_flow_bloom_tap(uv - vec2<f32>(inner.x, 0.0)) * 0.11;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(0.0, inner.y)) * 0.11;
    bloom += pixel_flow_bloom_tap(uv - vec2<f32>(0.0, inner.y)) * 0.11;
    bloom += pixel_flow_bloom_tap(uv + middle) * 0.055;
    bloom += pixel_flow_bloom_tap(uv - middle) * 0.055;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(middle.x, -middle.y)) * 0.055;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(-middle.x, middle.y)) * 0.055;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(outer.x, 0.0)) * 0.025;
    bloom += pixel_flow_bloom_tap(uv - vec2<f32>(outer.x, 0.0)) * 0.025;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(0.0, outer.y)) * 0.025;
    bloom += pixel_flow_bloom_tap(uv - vec2<f32>(0.0, outer.y)) * 0.025;
    return bloom;
}

fn pixel_flow_hertz_grade(color: vec3<f32>, strength: f32) -> vec3<f32> {
    let luma = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    let contrasted = (color - vec3<f32>(0.5)) * 1.16 + vec3<f32>(0.52);
    let saturated = vec3<f32>(luma) + (contrasted - vec3<f32>(luma)) * 1.28;
    let teal_shadows = vec3<f32>(-0.025, 0.045, 0.07) * (1.0 - smoothstep(0.28, 0.72, luma));
    let warm_highlights = vec3<f32>(0.075, 0.025, -0.018) * smoothstep(0.46, 0.92, luma);
    return mix(color, saturated + teal_shadows + warm_highlights, strength);
}

fn pixel_flow_smooth_noise(position: vec2<f32>) -> f32 {
    let base = floor(position);
    let fraction = fract(position);
    let curve = fraction * fraction * (vec2<f32>(3.0) - 2.0 * fraction);
    let top = mix(pixel_flow_hash(base), pixel_flow_hash(base + vec2<f32>(1.0, 0.0)), curve.x);
    let bottom = mix(pixel_flow_hash(base + vec2<f32>(0.0, 1.0)), pixel_flow_hash(base + vec2<f32>(1.0, 1.0)), curve.x);
    return mix(top, bottom, curve.y);
}

// A continuous version of the motion field used only by the broad light layer.
// Keeping this separate from the cell arrival prevents the CCD bloom from becoming tiled.
fn pixel_flow_continuous_arrival(uv: vec2<f32>, source_size: vec2<f32>, cell_px: f32) -> f32 {
    let depth = textureSampleLevel(mask_texture, src_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).r;
    let sky = 1.0 - smoothstep(0.22, 0.4, depth);
    let subject = smoothstep(0.66, 0.84, depth);
    let background = max(0.0, 1.0 - sky - subject);
    let origin = params.pixel_flow_geometry.xy;
    let impact = params.pixel_flow_geometry.zw;
    let position_px = uv * source_size;
    let origin_px = origin * source_size;
    let impact_px = impact * source_size;
    let impact_delta = position_px - impact_px;
    let impact_maximum = max(
        max(length(impact_px), length(vec2<f32>(source_size.x - impact_px.x, impact_px.y))),
        max(length(vec2<f32>(impact_px.x, source_size.y - impact_px.y)), length(source_size - impact_px)),
    );
    let impact_radius = length(impact_delta) / max(1.0, impact_maximum);
    let sky_delta = position_px - origin_px;
    let sky_maximum = max(
        max(length(origin_px), length(vec2<f32>(source_size.x - origin_px.x, origin_px.y))),
        max(length(vec2<f32>(origin_px.x, source_size.y - origin_px.y)), length(source_size - origin_px)),
    );
    let sky_radius = length(sky_delta) / max(1.0, sky_maximum);
    let vertical = clamp((uv.y - impact.y * 0.72) / max(0.08, 1.0 - impact.y * 0.72), 0.0, 1.0);
    let frame_edge = max(abs(uv.x - 0.5) * 2.0, abs(uv.y - 0.5) * 2.0);
    let outside_in = 1.0 - clamp(frame_edge, 0.0, 1.0);
    let depth_strength = clamp(params.pixel_flow_depth.x / 100.0, 0.0, 1.0);
    let mode = params.pixel_flow_depth.z;
    let other_mode = params.pixel_flow_depth.w;
    let noise_position = position_px / max(8.0, cell_px * 5.0);
    let smooth_noise = pixel_flow_smooth_noise(noise_position);
    let timing_warp = (smooth_noise - 0.5) * 0.085;
    let dark_sky_boost = smoothstep(0.6, 1.0, params.pixel_flow_scale.w);
    let sky_speed = mix(1.0, 0.38, dark_sky_boost);
    let ripple = (0.015 + sky_radius * 0.16 + timing_warp * 0.2) * sky_speed;
    let sweep = (0.015 + uv.x * 0.16 + timing_warp * 0.15) * sky_speed;
    let full = (0.02 + timing_warp * 0.04) * sky_speed;
    let sky_arrival = select(select(ripple, sweep, mode > 0.5), full, mode > 1.5);
    let directional = select(
        select(vertical, outside_in, other_mode > 0.5),
        impact_radius,
        other_mode > 1.5,
    );
    let background_arrival = 0.32 + directional * 0.45 + depth_strength * 0.055 + timing_warp;
    let subject_arrival = 0.5 + directional * 0.4 + depth_strength * 0.14 + timing_warp * 0.82;
    let segmented = sky * sky_arrival + background * background_arrival + subject * subject_arrival;

    let local_luma = pixel_flow_source_luma(uv);
    let highlight_advance = smoothstep(0.26, 0.82, local_luma) * 0.2;
    let branch_warp = sin(uv.y * 19.0 + uv.x * 7.0 + smooth_noise * 6.283) * 0.045
        + sin(uv.x * 27.0 - uv.y * 8.0 + smooth_noise * 4.0) * 0.025
        + timing_warp;
    let lateral = abs(uv.x - 0.5) * 2.0;
    let highlight_flow = vertical * 0.8 + lateral * 0.08 + branch_warp - highlight_advance;
    let cascade = vertical * 0.9 + lateral * 0.06 + branch_warp * 1.35;
    let diagonal = vertical * 0.68 + (1.0 - uv.x) * 0.27 + branch_warp * 1.1;
    let split = vertical * 0.7 + lateral * 0.26 + branch_warp * 1.2;
    let whole_progress = select(
        select(highlight_flow, cascade, mode > 0.5),
        select(diagonal, split, mode > 2.5),
        mode > 1.5,
    );
    let whole = 0.055 + clamp(whole_progress, 0.0, 1.0) * 0.76;
    return select(segmented, whole, other_mode > 2.5);
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
    let frame_edge = max(abs(cell_uv.x - 0.5) * 2.0, abs(cell_uv.y - 0.5) * 2.0);
    let outside_in = 1.0 - clamp(frame_edge, 0.0, 1.0);
    let depth_strength = clamp(params.pixel_flow_depth.x / 100.0, 0.0, 1.0);
    let sky_mode = params.pixel_flow_depth.z;
    let other_mode = params.pixel_flow_depth.w;
    let whole_frame = other_mode > 2.5;
    let dark_sky_boost = smoothstep(0.6, 1.0, params.pixel_flow_scale.w);
    let sky_speed_scale = mix(1.0, 0.38, dark_sky_boost);
    let sky_ripple_arrival = (0.015 + sky_radius * 0.16 + timing_jitter * 0.2) * sky_speed_scale;
    let sky_sweep_arrival = (0.015 + cell_uv.x * 0.16 + timing_jitter * 0.15) * sky_speed_scale;
    let sky_full_arrival = (0.02 + timing_jitter * 0.04) * sky_speed_scale;
    let sky_arrival = select(
        select(sky_ripple_arrival, sky_sweep_arrival, sky_mode > 0.5),
        sky_full_arrival,
        sky_mode > 1.5,
    );
    let directional_progress = select(
        select(vertical_fall, outside_in, other_mode > 0.5),
        impact_radius,
        other_mode > 1.5,
    );
    let background_arrival = 0.32
        + directional_progress * 0.45
        + depth_strength * 0.055
        + timing_jitter;
    let subject_arrival = 0.5
        + directional_progress * 0.4
        + depth_strength * 0.14
        + timing_jitter * 0.82;
    let segmented_arrival = sky * sky_arrival + background * background_arrival + subject * subject_arrival;
    // Whole-frame paths use warped directional fields rather than an equal-distance ring.
    // Nearby source highlights advance the wave so rails, water, roofs and sunlight form branches.
    let neighbor_step = vec2<f32>(max(0.012, 24.0 / source_size.x), max(0.012, 24.0 / source_size.y));
    let local_luma = pixel_flow_source_luma(cell_uv);
    let nearby_luma = local_luma * 0.38
        + pixel_flow_source_luma(cell_uv - vec2<f32>(0.0, neighbor_step.y)) * 0.24
        + pixel_flow_source_luma(cell_uv + vec2<f32>(neighbor_step.x, 0.0)) * 0.13
        + pixel_flow_source_luma(cell_uv - vec2<f32>(neighbor_step.x, 0.0)) * 0.13
        + pixel_flow_source_luma(cell_uv + vec2<f32>(0.0, neighbor_step.y)) * 0.12;
    let highlight_advance = smoothstep(0.26, 0.82, max(local_luma, nearby_luma)) * 0.22;
    let field_noise = pixel_flow_hash(floor(cell_index / vec2<f32>(5.0, 4.0)) + vec2<f32>(31.0, 17.0));
    let branch_warp = sin(cell_uv.y * 19.0 + cell_uv.x * 7.0 + field_noise * 6.283) * 0.045
        + sin(cell_uv.x * 27.0 - cell_uv.y * 8.0 + fine_noise * 4.0) * 0.025
        + (field_noise - 0.5) * 0.075;
    let lateral = abs(cell_uv.x - 0.5) * 2.0;
    let highlight_flow = vertical_fall * 0.8 + lateral * 0.08 + branch_warp - highlight_advance;
    let cascade_flow = vertical_fall * 0.9 + lateral * 0.06 + branch_warp * 1.35;
    let diagonal_flow = vertical_fall * 0.68 + (1.0 - cell_uv.x) * 0.27 + branch_warp * 1.1;
    let split_flow = vertical_fall * 0.7 + lateral * 0.26 + branch_warp * 1.2;
    let whole_progress = select(
        select(highlight_flow, cascade_flow, sky_mode > 0.5),
        select(diagonal_flow, split_flow, sky_mode > 2.5),
        sky_mode > 1.5,
    );
    let whole_arrival = 0.055 + clamp(whole_progress, 0.0, 1.0) * 0.76 + timing_jitter * 0.55;
    let arrival = select(segmented_arrival, whole_arrival, whole_frame);
    return select(vec4<f32>(arrival, sky, background, subject), vec4<f32>(arrival, 0.0, 1.0, 0.0), whole_frame);
}

fn pixel_flow_light(distance: f32, band: f32, subject: f32, edge_hold: f32) -> f32 {
    let fade_in = band * 0.9;
    let fade_out = band * mix(2.5, 3.5, subject) + edge_hold * 0.085;
    let linear = select(1.0 + distance / fade_out, 1.0 - distance / fade_in, distance >= 0.0);
    let clamped = clamp(linear, 0.0, 1.0);
    return clamped * clamped * (3.0 - 2.0 * clamped);
}
