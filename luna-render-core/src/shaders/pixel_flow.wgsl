fn pixel_flow_hash(cell: vec2<f32>) -> f32 {
    return fract(sin(dot(cell, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn pixel_flow_smooth_noise(position: vec2<f32>) -> f32 {
    let base = floor(position);
    let fraction = fract(position);
    let curve = fraction * fraction * (vec2<f32>(3.0) - 2.0 * fraction);
    let top = mix(pixel_flow_hash(base), pixel_flow_hash(base + vec2<f32>(1.0, 0.0)), curve.x);
    let bottom = mix(pixel_flow_hash(base + vec2<f32>(0.0, 1.0)), pixel_flow_hash(base + vec2<f32>(1.0, 1.0)), curve.x);
    return mix(top, bottom, curve.y);
}

fn pixel_flow_source(uv: vec2<f32>) -> vec3<f32> {
    return textureSampleLevel(
        src_texture,
        src_sampler,
        clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)),
        0.0,
    ).rgb;
}

fn pixel_flow_luma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn pixel_flow_regions(uv: vec2<f32>) -> vec3<f32> {
    if (params.pixel_flow_depth.y > 0.5) {
        let depth = textureSampleLevel(mask_texture, src_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).r;
        let sky = 1.0 - smoothstep(0.22, 0.4, depth);
        let subject = smoothstep(0.66, 0.84, depth);
        return vec3<f32>(sky, max(0.0, 1.0 - sky - subject), subject);
    }
    let sky = 1.0 - smoothstep(0.34, 0.56, uv.y);
    return vec3<f32>(sky, 1.0 - sky, 0.0);
}

fn pixel_flow_edge_strength(uv: vec2<f32>, source_size: vec2<f32>, cell_px: f32) -> f32 {
    let step_uv = vec2<f32>(max(1.0, cell_px * 0.72)) / source_size;
    let left = pixel_flow_luma(pixel_flow_source(uv - vec2<f32>(step_uv.x, 0.0)));
    let right = pixel_flow_luma(pixel_flow_source(uv + vec2<f32>(step_uv.x, 0.0)));
    let above = pixel_flow_luma(pixel_flow_source(uv - vec2<f32>(0.0, step_uv.y)));
    let below = pixel_flow_luma(pixel_flow_source(uv + vec2<f32>(0.0, step_uv.y)));
    return smoothstep(0.055, 0.32, abs(left - right) + abs(above - below));
}

// The three regions share gravity, but sky starts first and foreground surfaces hold longer streams.
fn pixel_flow_arrival(uv: vec2<f32>, cell_index: vec2<f32>, source_size: vec2<f32>, cell_px: f32) -> vec4<f32> {
    let regions = pixel_flow_regions(uv);
    let column_noise = pixel_flow_hash(vec2<f32>(cell_index.x * 1.37 + 19.0, 7.0));
    let stream_drift = floor(sin(uv.y * 22.0 + column_noise * 6.2831853) * 1.75);
    let stream_index = vec2<f32>(cell_index.x + stream_drift, cell_index.y);
    let coarse = pixel_flow_hash(floor(stream_index / vec2<f32>(4.0, 7.0)) + vec2<f32>(31.0, 13.0));
    let fine = pixel_flow_hash(stream_index * vec2<f32>(2.73, 1.91) + vec2<f32>(61.0, 43.0));
    let speed = mix(0.78, 1.32, params.pixel_flow_geometry.x);
    let edge = pixel_flow_edge_strength(uv, source_size, cell_px);
    let luma = pixel_flow_luma(pixel_flow_source(uv));
    let highlight_advance = smoothstep(0.46, 0.88, luma) * 0.055;
    let sky_arrival = 0.005 + uv.y * 0.22 / speed + column_noise * 0.09 + fine * 0.02;
    let background_arrival = 0.11 + uv.y * 0.47 / speed + column_noise * 0.06 + coarse * 0.065
        - edge * 0.075 - highlight_advance;
    let subject_arrival = 0.17 + uv.y * 0.48 / speed + column_noise * 0.055 + coarse * 0.05
        + params.pixel_flow_geometry.w * 0.14 - edge * 0.09 - highlight_advance;
    let arrival = dot(regions, vec3<f32>(sky_arrival, background_arrival, subject_arrival));
    return vec4<f32>(clamp(arrival, 0.0, 0.92), regions);
}

fn pixel_flow_continuous_arrival(uv: vec2<f32>, source_size: vec2<f32>, cell_px: f32) -> f32 {
    let regions = pixel_flow_regions(uv);
    let speed = mix(0.78, 1.32, params.pixel_flow_geometry.x);
    let field = uv * source_size / max(12.0, cell_px * 7.0) + vec2<f32>(17.0, 29.0);
    let warp = (pixel_flow_smooth_noise(field) - 0.5) * 0.055;
    let sky_arrival = 0.02 + uv.y * 0.21 / speed + warp * 0.35;
    let background_arrival = 0.13 + uv.y * 0.44 / speed + warp;
    let subject_arrival = 0.19 + uv.y * 0.46 / speed + params.pixel_flow_geometry.w * 0.12 + warp;
    return clamp(dot(regions, vec3<f32>(sky_arrival, background_arrival, subject_arrival)), 0.0, 1.0);
}

fn pixel_flow_presence(cell_index: vec2<f32>, cell: vec4<f32>, uv: vec2<f32>, source_size: vec2<f32>, cell_px: f32) -> f32 {
    let random = pixel_flow_hash(cell_index * vec2<f32>(5.37, 3.11) + vec2<f32>(71.0, 29.0));
    let group = pixel_flow_hash(floor(cell_index / vec2<f32>(2.0, 5.0)) + vec2<f32>(11.0, 83.0));
    let edge = pixel_flow_edge_strength(uv, source_size, cell_px);
    let luma = pixel_flow_luma(pixel_flow_source(uv));
    let strength = params.pixel_flow_geometry.z;
    let sky_signal = random * 0.72 + group * 0.28;
    let surface_signal = random * 0.58 + group * 0.22 + edge * 0.38 + smoothstep(0.38, 0.86, luma) * 0.12;
    let sky_gate = smoothstep(mix(0.42, 0.2, strength), mix(0.5, 0.28, strength), sky_signal);
    let surface_gate = smoothstep(mix(0.66, 0.38, strength), mix(0.74, 0.46, strength), surface_signal);
    return cell.y * sky_gate + (cell.z + cell.w) * surface_gate;
}

fn pixel_flow_pulse(progress: f32, arrival: f32, regions: vec3<f32>) -> f32 {
    let length = params.pixel_flow_geometry.y;
    let sky_tail = mix(0.11, 0.24, length);
    let background_tail = mix(0.11, 0.27, length);
    let subject_tail = mix(0.1, 0.24, length);
    let tail = dot(regions, vec3<f32>(sky_tail, background_tail, subject_tail));
    let elapsed = progress - arrival;
    let attack = smoothstep(-0.012, 0.018, elapsed);
    let decay = 1.0 - smoothstep(tail * 0.3, tail, elapsed);
    return attack * decay;
}

fn pixel_flow_source_visibility(color: vec3<f32>) -> f32 {
    let peak = max(color.r, max(color.g, color.b));
    let signal = max(pixel_flow_luma(color), peak * 0.78);
    return smoothstep(0.035, 0.16, signal);
}

fn pixel_flow_rain_color(color: vec3<f32>) -> vec3<f32> {
    let luma = pixel_flow_luma(color);
    let saturated = vec3<f32>(luma) + (color - vec3<f32>(luma)) * 1.48;
    let visibility = pixel_flow_source_visibility(color);
    return clamp(saturated * mix(1.18, 1.68, visibility), vec3<f32>(0.0), vec3<f32>(1.25));
}

fn pixel_flow_vivid_color(color: vec3<f32>) -> vec3<f32> {
    let peak = max(color.r, max(color.g, color.b));
    let normalized = color / max(0.025, peak);
    let normalized_luma = pixel_flow_luma(normalized);
    let saturated = vec3<f32>(normalized_luma)
        + (normalized - vec3<f32>(normalized_luma)) * 1.82;
    let visibility = pixel_flow_source_visibility(color);
    let target_peak = mix(0.92, 1.38, smoothstep(0.05, 0.68, peak));
    let vivid = saturated * target_peak * visibility;
    return clamp(vivid, vec3<f32>(0.0), vec3<f32>(1.45));
}

fn pixel_flow_bloom_tap(uv: vec2<f32>) -> vec3<f32> {
    let color = pixel_flow_source(uv);
    let energy = smoothstep(0.42, 0.9, max(pixel_flow_luma(color), max(color.r, max(color.g, color.b)) * 0.68));
    return color * energy;
}

fn pixel_flow_ccd_bloom(uv: vec2<f32>, radius: vec2<f32>) -> vec3<f32> {
    var bloom = pixel_flow_bloom_tap(uv) * 0.28;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(radius.x, 0.0)) * 0.12;
    bloom += pixel_flow_bloom_tap(uv - vec2<f32>(radius.x, 0.0)) * 0.12;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(0.0, radius.y)) * 0.12;
    bloom += pixel_flow_bloom_tap(uv - vec2<f32>(0.0, radius.y)) * 0.12;
    bloom += pixel_flow_bloom_tap(uv + radius * 2.0) * 0.06;
    bloom += pixel_flow_bloom_tap(uv - radius * 2.0) * 0.06;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(radius.x * 2.0, -radius.y * 2.0)) * 0.06;
    bloom += pixel_flow_bloom_tap(uv + vec2<f32>(-radius.x * 2.0, radius.y * 2.0)) * 0.06;
    return bloom;
}

fn pixel_flow_hertz_grade(color: vec3<f32>, strength: f32) -> vec3<f32> {
    let luma = pixel_flow_luma(color);
    let contrasted = (color - vec3<f32>(0.5)) * 1.14 + vec3<f32>(0.51);
    let saturated = vec3<f32>(luma) + (contrasted - vec3<f32>(luma)) * 1.24;
    let teal_shadows = vec3<f32>(-0.02, 0.032, 0.05) * (1.0 - smoothstep(0.24, 0.7, luma));
    let warm_highlights = vec3<f32>(0.055, 0.018, -0.014) * smoothstep(0.5, 0.92, luma);
    return mix(color, saturated + teal_shadows + warm_highlights, strength);
}
