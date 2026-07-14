fn beauty_contour_point(base: u32, index: u32) -> vec2<f32> {
    let packed = params.beauty_faces[base + 4u + index / 2u];
    return select(packed.xy, packed.zw, index % 2u == 1u);
}

fn beauty_segment_distance(point: vec2<f32>, start: vec2<f32>, end: vec2<f32>) -> f32 {
    let segment = end - start;
    let projection = clamp(dot(point - start, segment) / max(dot(segment, segment), 0.000001), 0.0, 1.0);
    return length(point - (start + segment * projection));
}

fn beauty_contour_metrics(uv: vec2<f32>, face: vec4<f32>, base: u32) -> vec2<f32> {
    let face_size = max(face.zw, vec2<f32>(0.0001));
    let point = (uv - face.xy) / face_size;
    var previous = (beauty_contour_point(base, 23u) - face.xy) / face_size;
    var inside = false;
    var edge_distance = 1000.0;

    for (var index = 0u; index < 24u; index = index + 1u) {
        let current = (beauty_contour_point(base, index) - face.xy) / face_size;
        edge_distance = min(edge_distance, beauty_segment_distance(point, previous, current));
        if ((current.y > point.y) != (previous.y > point.y)) {
            let crossing_x = (previous.x - current.x) * (point.y - current.y)
                / (previous.y - current.y) + current.x;
            if (point.x < crossing_x) { inside = !inside; }
        }
        previous = current;
    }

    let fill = select(0.0, smoothstep(0.0, 0.055, edge_distance), inside);
    let outline = 1.0 - smoothstep(0.008, 0.018, edge_distance);
    return vec2<f32>(fill, outline);
}

fn beauty_feature_mask(uv: vec2<f32>, feature: vec4<f32>, expansion: vec2<f32>) -> f32 {
    let radius = max(feature.zw * expansion, vec2<f32>(0.0001));
    let p = (uv - feature.xy) / radius;
    return 1.0 - smoothstep(0.55, 1.0, dot(p, p));
}

fn beauty_warp_eye(uv: vec2<f32>, eye: vec4<f32>, strength: f32) -> vec2<f32> {
    let radius = max(eye.zw * 2.25, vec2<f32>(0.0001));
    let delta = uv - eye.xy;
    let distance = length(delta / radius);
    if (distance >= 1.0) { return uv; }
    let falloff = (1.0 - distance * distance);
    let scale = 1.0 - strength * 0.22 * falloff * falloff;
    return eye.xy + delta * scale;
}

fn apply_beauty_warp(input_uv: vec2<f32>) -> vec2<f32> {
    var uv = input_uv;
    let slim = clamp(params.beauty_strengths.z / 100.0, 0.0, 1.0);
    let eyes = clamp(params.beauty_strengths.w / 100.0, 0.0, 1.0);
    for (var face_index = 0u; face_index < 3u; face_index = face_index + 1u) {
        let base = face_index * 16u;
        let face = params.beauty_faces[base];
        if (face.z <= 0.0001 || face.w <= 0.0001) { continue; }
        let left_eye = params.beauty_faces[base + 1u];
        let right_eye = params.beauty_faces[base + 2u];

        if (slim > 0.0) {
            let normalized = (uv - face.xy) / max(face.zw * vec2<f32>(0.56, 0.52), vec2<f32>(0.0001));
            let radial = dot(normalized, normalized);
            if (radial < 1.0) {
                let vertical = 1.0 - smoothstep(0.52, 1.0, abs(normalized.y));
                let side = smoothstep(0.08, 0.72, abs(normalized.x));
                let edge = 1.0 - smoothstep(0.72, 1.0, radial);
                let direction = select(-1.0, 1.0, normalized.x >= 0.0);
                uv.x = uv.x + direction * face.z * 0.032 * slim * vertical * side * edge;
            }
        }

        if (eyes > 0.0) {
            uv = beauty_warp_eye(uv, left_eye, eyes);
            uv = beauty_warp_eye(uv, right_eye, eyes);
        }
        uv = apply_beauty_feature_warp(uv, face_index, face);
    }
    return clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
}

fn beauty_bilateral_weight(
    center: vec3<f32>,
    sample: vec3<f32>,
    spatial_weight: f32,
    color_factor: f32,
) -> f32 {
    let color_distance = min(distance(center, sample) * color_factor, 1.0);
    let range_weight = 1.0 - color_distance;
    return spatial_weight * range_weight * range_weight;
}

fn beauty_bilateral(uv: vec2<f32>, radius: f32, color_factor: f32) -> vec3<f32> {
    let texel = vec2<f32>(params.texel_x, params.texel_y) * radius;
    let center = sample_image(uv);
    var sum = center * 0.2;
    var weight_sum = 0.2;

    let right = sample_image(uv + vec2<f32>(texel.x, 0.0));
    let right_weight = beauty_bilateral_weight(center, right, 0.14, color_factor);
    sum = sum + right * right_weight;
    weight_sum = weight_sum + right_weight;
    let left = sample_image(uv - vec2<f32>(texel.x, 0.0));
    let left_weight = beauty_bilateral_weight(center, left, 0.14, color_factor);
    sum = sum + left * left_weight;
    weight_sum = weight_sum + left_weight;
    let bottom = sample_image(uv + vec2<f32>(0.0, texel.y));
    let bottom_weight = beauty_bilateral_weight(center, bottom, 0.14, color_factor);
    sum = sum + bottom * bottom_weight;
    weight_sum = weight_sum + bottom_weight;
    let top = sample_image(uv - vec2<f32>(0.0, texel.y));
    let top_weight = beauty_bilateral_weight(center, top, 0.14, color_factor);
    sum = sum + top * top_weight;
    weight_sum = weight_sum + top_weight;

    let bottom_right = sample_image(uv + texel);
    let bottom_right_weight = beauty_bilateral_weight(center, bottom_right, 0.06, color_factor);
    sum = sum + bottom_right * bottom_right_weight;
    weight_sum = weight_sum + bottom_right_weight;
    let top_left = sample_image(uv - texel);
    let top_left_weight = beauty_bilateral_weight(center, top_left, 0.06, color_factor);
    sum = sum + top_left * top_left_weight;
    weight_sum = weight_sum + top_left_weight;
    let top_right = sample_image(uv + vec2<f32>(texel.x, -texel.y));
    let top_right_weight = beauty_bilateral_weight(center, top_right, 0.06, color_factor);
    sum = sum + top_right * top_right_weight;
    weight_sum = weight_sum + top_right_weight;
    let bottom_left = sample_image(uv + vec2<f32>(-texel.x, texel.y));
    let bottom_left_weight = beauty_bilateral_weight(center, bottom_left, 0.06, color_factor);
    sum = sum + bottom_left * bottom_left_weight;
    weight_sum = weight_sum + bottom_left_weight;
    return sum / max(weight_sum, 0.0001);
}

fn beauty_even_tone(uv: vec2<f32>) -> vec3<f32> {
    let medium = beauty_bilateral(uv, 9.0, 2.8);
    let broad = beauty_bilateral(uv, 20.0, 1.9);
    let wide = beauty_bilateral(uv, 34.0, 1.35);
    return medium * 0.24 + broad * 0.48 + wide * 0.28;
}

fn apply_beauty_color(input: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    let smoothing = clamp(params.beauty_strengths.x / 100.0, 0.0, 1.0);
    let whitening = clamp(params.beauty_strengths.y / 100.0, 0.0, 1.0);
    let color_activity = smoothing + whitening
        + params.beauty_skin_params[0].x / 100.0
        + abs(params.beauty_skin_params[0].y) / 100.0
        + params.beauty_skin_params[0].z / 100.0
        + params.beauty_skin_params[0].w / 100.0
        + params.beauty_skin_params[1].x / 100.0
        + params.beauty_eye_params[0].z / 100.0
        + params.beauty_eye_params[0].w / 100.0
        + params.beauty_eye_params[1].x / 100.0
        + params.beauty_feature_params[1].x / 100.0
        + params.beauty_feature_params[1].y / 100.0
        + params.beauty_feature_params[1].z / 100.0
        + params.beauty_reshape_params.x / 100.0;
    if (color_activity <= 0.0) { return input; }

    var face_mask = 0.0;
    var protected_features = 0.0;
    for (var face_index = 0u; face_index < 3u; face_index = face_index + 1u) {
        let base = face_index * 16u;
        let face = params.beauty_faces[base];
        if (face.z <= 0.0001 || face.w <= 0.0001) { continue; }
        let left_eye = params.beauty_faces[base + 1u];
        let right_eye = params.beauty_faces[base + 2u];
        let mouth = params.beauty_faces[base + 3u];
        let contour_mask = beauty_contour_metrics(uv, face, base).x;
        let feature_feather = face.z * 0.02;
        let features = max(
            max(
                beauty_left_eye_protection(uv, face_index, feature_feather),
                beauty_right_eye_protection(uv, face_index, feature_feather),
            ),
            beauty_mouth_protection(uv, face_index, feature_feather * 0.85),
        );
        protected_features = max(protected_features, features);
        face_mask = max(face_mask, contour_mask * (1.0 - features));
    }
    let semantic_skin = select(
        0.0,
        textureSample(beauty_skin_mask, src_sampler, uv).r * (1.0 - protected_features),
        params.beauty_debug.y > 0.5,
    );
    let whitening_mask = max(face_mask, semantic_skin);
    if (face_mask <= 0.0 && whitening_mask <= 0.0) { return input; }

    var result = input;
    if (smoothing > 0.0) {
        let fine = beauty_bilateral(uv, 2.5 + smoothing * 3.5, 8.0);
        let coarse = beauty_bilateral(uv, 6.0 + smoothing * 8.0, 5.0);
        let smoothed_base = mix(fine, coarse, smoothing * 0.76);
        let fine_detail = input - fine;
        let detail_preserved = smoothed_base + fine_detail * (0.34 - smoothing * 0.14);
        result = mix(result, detail_preserved, face_mask * smoothing * 0.92);
    }
    let complexion = params.beauty_skin_params[0].x / 100.0;
    if (complexion > 0.0) {
        let even_tone = beauty_even_tone(uv);
        let tone_difference = distance(input, even_tone);
        let retained_detail = mix(0.08, 0.0, smoothstep(0.014, 0.09, tone_difference));
        let complexion_target = even_tone + (input - even_tone) * retained_detail
            + vec3<f32>(0.065, 0.047, 0.04) * face_mask;
        result = mix(result, complexion_target, whitening_mask * complexion * 0.96);
    }
    let warmth = params.beauty_skin_params[0].y / 100.0;
    if (abs(warmth) > 0.0) {
        result += vec3<f32>(0.02, 0.004, -0.02) * warmth * whitening_mask;
    }
    let rosy = params.beauty_skin_params[0].z / 100.0;
    if (rosy > 0.0) {
        result += vec3<f32>(0.045, 0.008, 0.012) * rosy * whitening_mask;
    }
    if (whitening > 0.0) {
        let luminance = dot(result, vec3<f32>(0.299, 0.587, 0.114));
        let screened = 1.0 - (1.0 - result) * (1.0 - result);
        let tone_amount = whitening * (0.12 + luminance * 0.18);
        result = mix(result, screened, whitening_mask * tone_amount);
    }
    let skin_texture = params.beauty_skin_params[0].w / 100.0;
    if (skin_texture > 0.0) {
        let texture_base = beauty_bilateral(uv, 2.8, 9.0);
        result += (input - texture_base) * face_mask * skin_texture * 0.65;
    }
    result = apply_beauty_local_color(result, input, uv);
    return clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn beauty_outline(uv: vec2<f32>, ellipse: vec4<f32>, thickness: f32) -> f32 {
    let radius = max(ellipse.zw * 0.5, vec2<f32>(0.0001));
    let distance = length((uv - ellipse.xy) / radius);
    return 1.0 - smoothstep(thickness, thickness * 2.0, abs(distance - 1.0));
}

fn beauty_center_mark(uv: vec2<f32>, center: vec2<f32>, face: vec4<f32>) -> f32 {
    let pixel = abs(uv - center);
    let line_x = 1.0 - smoothstep(0.0015, 0.0035, pixel.x);
    let line_y = 1.0 - smoothstep(0.0015, 0.0035, pixel.y);
    let extent_x = 1.0 - smoothstep(face.z * 0.045, face.z * 0.06, pixel.x);
    let extent_y = 1.0 - smoothstep(face.w * 0.045, face.w * 0.06, pixel.y);
    return max(line_x * extent_y, line_y * extent_x);
}

fn apply_beauty_debug(input: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if (params.beauty_debug.x < 0.5) { return input; }
    var result = input;
    if (params.beauty_debug.y > 0.5) {
        let body_skin = textureSample(beauty_skin_mask, src_sampler, uv).r;
        result = mix(result, vec3<f32>(1.0, 0.2, 0.68), body_skin * 0.24);
    }
    for (var face_index = 0u; face_index < 3u; face_index = face_index + 1u) {
        let base = face_index * 16u;
        let face = params.beauty_faces[base];
        if (face.z <= 0.0001 || face.w <= 0.0001) { continue; }
        let left_eye = params.beauty_faces[base + 1u];
        let right_eye = params.beauty_faces[base + 2u];
        let mouth = params.beauty_faces[base + 3u];
        let contour = beauty_contour_metrics(uv, face, base);
        let face_fill = contour.x * 0.13;
        let face_line = contour.y;
        let debug_feather = face.z * 0.004;
        let left_line = beauty_landmark_polygon_metrics(uv, face_index, 4u, 16u, debug_feather).z;
        let right_line = beauty_landmark_polygon_metrics(uv, face_index, 20u, 16u, debug_feather).z;
        let mouth_line = beauty_landmark_polygon_metrics(uv, face_index, 40u, 20u, debug_feather).z;
        let center = beauty_center_mark(uv, face.xy, face);
        result = mix(result, vec3<f32>(0.0, 0.72, 1.0), face_fill);
        result = mix(result, vec3<f32>(0.0, 0.82, 1.0), max(face_line, center) * 0.95);
        result = mix(result, vec3<f32>(0.25, 1.0, 0.42), max(left_line, right_line) * 0.95);
        result = mix(result, vec3<f32>(1.0, 0.62, 0.1), mouth_line * 0.95);
    }
    return result;
}
