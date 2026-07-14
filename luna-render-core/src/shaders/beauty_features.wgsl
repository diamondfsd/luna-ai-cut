fn beauty_landmark(face_index: u32, slot: u32) -> vec2<f32> {
    let packed = params.beauty_landmarks[face_index * 40u + slot / 2u];
    return select(packed.xy, packed.zw, slot % 2u == 1u);
}

fn beauty_landmark_polygon_metrics(
    uv: vec2<f32>, face_index: u32, start: u32, count: u32, feather: f32,
) -> vec3<f32> {
    var previous = beauty_landmark(face_index, start + count - 1u);
    var inside = false;
    var edge_distance = 1000.0;
    for (var index = 0u; index < 20u; index += 1u) {
        if (index >= count) { break; }
        let current = beauty_landmark(face_index, start + index);
        edge_distance = min(edge_distance, beauty_segment_distance(uv, previous, current));
        if ((current.y > uv.y) != (previous.y > uv.y)) {
            let crossing_x = (previous.x - current.x) * (uv.y - current.y)
                / (previous.y - current.y) + current.x;
            if (uv.x < crossing_x) { inside = !inside; }
        }
        previous = current;
    }
    let inner_fill = select(0.0, smoothstep(0.0, feather, edge_distance), inside);
    let expanded_fill = select(1.0 - smoothstep(0.0, feather, edge_distance), 1.0, inside);
    let outline = 1.0 - smoothstep(feather * 0.2, feather, edge_distance);
    return vec3<f32>(inner_fill, expanded_fill, outline);
}

fn beauty_left_eye_mask(uv: vec2<f32>, face_index: u32, feather: f32) -> f32 {
    return beauty_landmark_polygon_metrics(uv, face_index, 4u, 16u, feather).x;
}

fn beauty_right_eye_mask(uv: vec2<f32>, face_index: u32, feather: f32) -> f32 {
    return beauty_landmark_polygon_metrics(uv, face_index, 20u, 16u, feather).x;
}

fn beauty_outer_mouth_mask(uv: vec2<f32>, face_index: u32, feather: f32) -> f32 {
    return beauty_landmark_polygon_metrics(uv, face_index, 40u, 20u, feather).x;
}

fn beauty_inner_mouth_mask(uv: vec2<f32>, face_index: u32, feather: f32) -> f32 {
    return beauty_landmark_polygon_metrics(uv, face_index, 60u, 20u, feather).x;
}

fn beauty_left_eye_protection(uv: vec2<f32>, face_index: u32, feather: f32) -> f32 {
    return beauty_landmark_polygon_metrics(uv, face_index, 4u, 16u, feather).y;
}

fn beauty_right_eye_protection(uv: vec2<f32>, face_index: u32, feather: f32) -> f32 {
    return beauty_landmark_polygon_metrics(uv, face_index, 20u, 16u, feather).y;
}

fn beauty_mouth_protection(uv: vec2<f32>, face_index: u32, feather: f32) -> f32 {
    return beauty_landmark_polygon_metrics(uv, face_index, 40u, 20u, feather).y;
}

fn beauty_ellipse_mask(uv: vec2<f32>, center: vec2<f32>, radius: vec2<f32>) -> f32 {
    let p = (uv - center) / max(radius, vec2<f32>(0.0001));
    return 1.0 - smoothstep(0.55, 1.0, dot(p, p));
}

fn beauty_translate_region(
    uv: vec2<f32>, center: vec2<f32>, radius: vec2<f32>, delta: vec2<f32>,
) -> vec2<f32> {
    if (center.x <= 0.0001 || center.y <= 0.0001) { return uv; }
    let normalized = (uv - center) / max(radius, vec2<f32>(0.0001));
    let distance = dot(normalized, normalized);
    if (distance >= 1.0) { return uv; }
    let falloff = (1.0 - distance) * (1.0 - distance);
    return uv - delta * falloff;
}

fn beauty_scale_region(
    uv: vec2<f32>, center: vec2<f32>, radius: vec2<f32>, amount: vec2<f32>,
) -> vec2<f32> {
    if (center.x <= 0.0001 || center.y <= 0.0001) { return uv; }
    let delta = uv - center;
    let distance = dot(delta / max(radius, vec2<f32>(0.0001)), delta / max(radius, vec2<f32>(0.0001)));
    if (distance >= 1.0) { return uv; }
    let falloff = (1.0 - distance) * (1.0 - distance);
    return center + delta * (vec2<f32>(1.0) - amount * falloff);
}

fn apply_beauty_feature_warp(uv_input: vec2<f32>, face_index: u32, face: vec4<f32>) -> vec2<f32> {
    let activity = params.beauty_reshape_params.x + params.beauty_reshape_params.y
        + abs(params.beauty_reshape_params.z) + abs(params.beauty_reshape_params.w)
        + abs(params.beauty_eye_params[0].x) + abs(params.beauty_eye_params[0].y)
        + params.beauty_feature_params[0].x + params.beauty_feature_params[0].y
        + abs(params.beauty_feature_params[0].z) + abs(params.beauty_feature_params[0].w);
    if (activity <= 0.0) { return uv_input; }
    var uv = uv_input;
    let shave = clamp(params.beauty_reshape_params.x / 100.0, 0.0, 1.0);
    let narrow = clamp(params.beauty_reshape_params.y / 100.0, 0.0, 1.0);
    let normalized = (uv - face.xy) / max(face.zw * vec2<f32>(0.56, 0.54), vec2<f32>(0.0001));
    let radial = dot(normalized, normalized);
    if (radial < 1.0 && (shave > 0.0 || narrow > 0.0)) {
        let direction = select(-1.0, 1.0, normalized.x >= 0.0);
        let edge = 1.0 - smoothstep(0.68, 1.0, radial);
        let side = smoothstep(0.16, 0.76, abs(normalized.x));
        let lower = smoothstep(-0.15, 0.82, normalized.y);
        uv.x += direction * face.z * (narrow * 0.026 + shave * lower * 0.035) * side * edge;
    }

    let chin = params.beauty_reshape_params.z / 100.0;
    let forehead = params.beauty_reshape_params.w / 100.0;
    uv = beauty_translate_region(uv, beauty_landmark(face_index, 1u), face.zw * vec2<f32>(0.34, 0.22), vec2<f32>(0.0, face.w * chin * 0.055));
    uv = beauty_translate_region(uv, beauty_landmark(face_index, 0u), face.zw * vec2<f32>(0.38, 0.2), vec2<f32>(0.0, -face.w * forehead * 0.045));

    let eye_distance = params.beauty_eye_params[0].x / 100.0;
    let eye_corner = params.beauty_eye_params[0].y / 100.0;
    let left_eye_center = params.beauty_faces[face_index * 16u + 1u].xy;
    let right_eye_center = params.beauty_faces[face_index * 16u + 2u].xy;
    let eye_radius = face.zw * vec2<f32>(0.18, 0.12);
    uv = beauty_translate_region(uv, left_eye_center, eye_radius, vec2<f32>(-face.z * eye_distance * 0.018, 0.0));
    uv = beauty_translate_region(uv, right_eye_center, eye_radius, vec2<f32>(face.z * eye_distance * 0.018, 0.0));
    uv = beauty_translate_region(uv, beauty_landmark(face_index, 4u), eye_radius * 0.55, vec2<f32>(-face.z * eye_corner * 0.012, 0.0));
    uv = beauty_translate_region(uv, beauty_landmark(face_index, 20u), eye_radius * 0.55, vec2<f32>(face.z * eye_corner * 0.012, 0.0));

    let nose_thin = clamp(params.beauty_feature_params[0].x / 100.0, 0.0, 1.0);
    let nose_alae = clamp(params.beauty_feature_params[0].y / 100.0, 0.0, 1.0);
    let nose_length = params.beauty_feature_params[0].z / 100.0;
    let nose_center = beauty_landmark(face_index, 37u);
    uv = beauty_scale_region(uv, nose_center, face.zw * vec2<f32>(0.15, 0.3), vec2<f32>(nose_thin * 0.13, 0.0));
    uv = beauty_translate_region(uv, beauty_landmark(face_index, 38u), face.zw * vec2<f32>(0.1, 0.11), vec2<f32>(face.z * nose_alae * 0.012, 0.0));
    uv = beauty_translate_region(uv, beauty_landmark(face_index, 39u), face.zw * vec2<f32>(0.1, 0.11), vec2<f32>(-face.z * nose_alae * 0.012, 0.0));
    uv = beauty_translate_region(uv, beauty_landmark(face_index, 36u), face.zw * vec2<f32>(0.16, 0.17), vec2<f32>(0.0, face.w * nose_length * 0.025));

    let mouth_size = params.beauty_feature_params[0].w / 100.0;
    let mouth = params.beauty_faces[face_index * 16u + 3u];
    uv = beauty_scale_region(uv, mouth.xy, mouth.zw * 1.8, vec2<f32>(mouth_size * 0.13, mouth_size * 0.08));
    return uv;
}

fn beauty_segment_mask(uv: vec2<f32>, start: vec2<f32>, end: vec2<f32>, radius: f32) -> f32 {
    if (start.x <= 0.0001 || end.x <= 0.0001) { return 0.0; }
    let segment = end - start;
    let t = clamp(dot(uv - start, segment) / max(dot(segment, segment), 0.000001), 0.0, 1.0);
    return 1.0 - smoothstep(radius * 0.45, radius, distance(uv, start + segment * t));
}

fn apply_beauty_local_color(result_input: vec3<f32>, source: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    var result = result_input;
    for (var face_index = 0u; face_index < 3u; face_index += 1u) {
        let base = face_index * 16u;
        let face = params.beauty_faces[base];
        if (face.z <= 0.0001 || face.w <= 0.0001) { continue; }
        let left_eye = params.beauty_faces[base + 1u];
        let right_eye = params.beauty_faces[base + 2u];
        let mouth = params.beauty_faces[base + 3u];

        let jaw_strength = params.beauty_reshape_params.x / 100.0;
        if (jaw_strength > 0.0) {
            let chin = beauty_landmark(face_index, 1u);
            let under_chin = chin + vec2<f32>(face.z * 0.06, face.w * 0.1);
            let jaw_mask = beauty_ellipse_mask(uv, under_chin, face.zw * vec2<f32>(0.34, 0.16));
            let jaw_smooth = beauty_bilateral(uv, 18.0, 2.2);
            result = mix(result, jaw_smooth * 1.012, jaw_mask * jaw_strength * 0.78);
        }

        let fold_strength = params.beauty_skin_params[1].x / 100.0;
        if (fold_strength > 0.0) {
            let folds = max(
                beauty_segment_mask(uv, beauty_landmark(face_index, 38u), beauty_landmark(face_index, 40u), face.z * 0.026),
                beauty_segment_mask(uv, beauty_landmark(face_index, 39u), beauty_landmark(face_index, 50u), face.z * 0.026),
            );
            let fold_smooth = beauty_bilateral(uv, 7.0, 5.0);
            result = mix(result, fold_smooth * 1.025, folds * fold_strength * 0.46);
        }

        let eye_bright = params.beauty_eye_params[1].x / 100.0;
        if (eye_bright > 0.0) {
            let eye_mask = max(
                beauty_left_eye_mask(uv, face_index, face.z * 0.006),
                beauty_right_eye_mask(uv, face_index, face.z * 0.006),
            );
            let screened = 1.0 - (1.0 - result) * (1.0 - result);
            result = mix(result, screened, eye_mask * eye_bright * 0.22);
        }

        let bags = params.beauty_eye_params[0].w / 100.0;
        let furrows = params.beauty_eye_params[0].z / 100.0;
        if (bags > 0.0 || furrows > 0.0) {
            let under_left = left_eye.xy + vec2<f32>(0.0, left_eye.w * 1.65);
            let under_right = right_eye.xy + vec2<f32>(0.0, right_eye.w * 1.65);
            let under_mask = max(
                beauty_ellipse_mask(uv, under_left, left_eye.zw * vec2<f32>(1.15, 0.62)),
                beauty_ellipse_mask(uv, under_right, right_eye.zw * vec2<f32>(1.15, 0.62)),
            );
            if (bags > 0.0) {
                let bag_smooth = beauty_bilateral(uv, 7.0, 5.0);
                result = mix(result, bag_smooth * 1.015, under_mask * bags * 0.5);
            }
            result = mix(result, result + vec3<f32>(0.035, 0.025, 0.018), under_mask * furrows * 0.38);
        }

        let teeth = params.beauty_feature_params[1].x / 100.0;
        let lipstick = params.beauty_feature_params[1].y / 100.0;
        if (teeth > 0.0 || lipstick > 0.0) {
            let inner_mouth = beauty_inner_mouth_mask(uv, face_index, face.z * 0.005);
            let luminance = dot(source, vec3<f32>(0.299, 0.587, 0.114));
            let chroma = max(source.r, max(source.g, source.b)) - min(source.r, min(source.g, source.b));
            if (teeth > 0.0) {
                let teeth_confidence = smoothstep(0.28, 0.62, luminance) * (1.0 - smoothstep(0.1, 0.32, chroma));
                result = mix(result, 1.0 - (1.0 - result) * 0.72, inner_mouth * teeth_confidence * teeth * 0.72);
            }
            if (lipstick > 0.0) {
                let outer_lip = beauty_outer_mouth_mask(uv, face_index, face.z * 0.007);
                let lip_confidence = smoothstep(0.09, 0.28, chroma + max(source.r - source.g, 0.0) * 1.35);
                let lip_mask = outer_lip * (1.0 - inner_mouth) * lip_confidence;
                let lip_color = params.beauty_makeup_colors[0].rgb;
                let lip_luma = max(dot(result, vec3<f32>(0.299, 0.587, 0.114)), 0.08);
                let tinted_lip = mix(result, lip_color * (0.48 + lip_luma * 0.58), 0.72);
                result = mix(result, tinted_lip, lip_mask * lipstick * 0.48);
            }
        }

        let blush = params.beauty_feature_params[1].z / 100.0;
        if (blush > 0.0) {
            let cheek_y = mix((left_eye.y + right_eye.y) * 0.5, mouth.y, 0.62);
            let left_cheek = vec2<f32>(mix(left_eye.x, mouth.x, 0.28), cheek_y);
            let right_cheek = vec2<f32>(mix(right_eye.x, mouth.x, 0.28), cheek_y);
            let blush_mask = max(
                beauty_ellipse_mask(uv, left_cheek, face.zw * vec2<f32>(0.12, 0.075)),
                beauty_ellipse_mask(uv, right_cheek, face.zw * vec2<f32>(0.12, 0.075)),
            );
            let blush_shift = (params.beauty_makeup_colors[1].rgb - vec3<f32>(0.5)) * 0.18;
            result = mix(result, result + blush_shift, blush_mask * blush * 0.62);
        }
    }
    return result;
}
