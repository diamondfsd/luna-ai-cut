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
    var previous = (beauty_contour_point(base, 15u) - face.xy) / face_size;
    var inside = false;
    var edge_distance = 1000.0;

    for (var index = 0u; index < 16u; index = index + 1u) {
        let current = (beauty_contour_point(base, index) - face.xy) / face_size;
        edge_distance = min(edge_distance, beauty_segment_distance(point, previous, current));
        if ((current.y > point.y) != (previous.y > point.y)) {
            let crossing_x = (previous.x - current.x) * (point.y - current.y)
                / (previous.y - current.y) + current.x;
            if (point.x < crossing_x) { inside = !inside; }
        }
        previous = current;
    }

    let fill = select(0.0, smoothstep(0.0, 0.075, edge_distance), inside);
    let outline = 1.0 - smoothstep(0.008, 0.018, edge_distance);
    return vec2<f32>(fill, outline);
}

fn beauty_skin_confidence(color: vec3<f32>) -> f32 {
    let cb = 0.5 - 0.168736 * color.r - 0.331264 * color.g + 0.5 * color.b;
    let cr = 0.5 + 0.5 * color.r - 0.418688 * color.g - 0.081312 * color.b;
    let cb_match = smoothstep(0.25, 0.34, cb) * (1.0 - smoothstep(0.50, 0.57, cb));
    let cr_match = smoothstep(0.48, 0.54, cr) * (1.0 - smoothstep(0.70, 0.77, cr));
    return 0.12 + 0.88 * cb_match * cr_match;
}

fn beauty_eye_mask(uv: vec2<f32>, eye: vec4<f32>, scale: f32) -> f32 {
    let radius = max(eye.zw * scale, vec2<f32>(0.0001));
    let p = (uv - eye.xy) / radius;
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
        let base = face_index * 12u;
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
    }
    return clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
}

fn beauty_blur(uv: vec2<f32>, radius: f32) -> vec3<f32> {
    let texel = vec2<f32>(params.texel_x, params.texel_y) * radius;
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

fn apply_beauty_color(input: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    let smoothing = clamp(params.beauty_strengths.x / 100.0, 0.0, 1.0);
    let whitening = clamp(params.beauty_strengths.y / 100.0, 0.0, 1.0);
    if (smoothing <= 0.0 && whitening <= 0.0) { return input; }

    var skin_mask = 0.0;
    for (var face_index = 0u; face_index < 3u; face_index = face_index + 1u) {
        let base = face_index * 12u;
        let face = params.beauty_faces[base];
        if (face.z <= 0.0001 || face.w <= 0.0001) { continue; }
        let left_eye = params.beauty_faces[base + 1u];
        let right_eye = params.beauty_faces[base + 2u];
        let mouth = params.beauty_faces[base + 3u];
        var mask = beauty_contour_metrics(uv, face, base).x;
        mask = mask * (1.0 - beauty_eye_mask(uv, left_eye, 2.1));
        mask = mask * (1.0 - beauty_eye_mask(uv, right_eye, 2.1));
        mask = mask * (1.0 - beauty_eye_mask(uv, mouth, 1.65));
        mask = mask * beauty_skin_confidence(input);
        skin_mask = max(skin_mask, mask);
    }
    if (skin_mask <= 0.0) { return input; }

    var result = input;
    if (smoothing > 0.0) {
        let blurred = beauty_blur(uv, 2.0 + smoothing * 5.0);
        let edge_preservation = 1.0 - smoothstep(0.035, 0.24, length(input - blurred));
        result = mix(result, blurred, skin_mask * smoothing * 0.78 * edge_preservation);
    }
    if (whitening > 0.0) {
        let lifted = 1.0 - (1.0 - result) * (1.0 - whitening * 0.18);
        let neutral = vec3<f32>(lifted.r * 0.995, lifted.g, lifted.b * (1.0 + whitening * 0.018));
        result = mix(result, neutral, skin_mask * whitening);
    }
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
    for (var face_index = 0u; face_index < 3u; face_index = face_index + 1u) {
        let base = face_index * 12u;
        let face = params.beauty_faces[base];
        if (face.z <= 0.0001 || face.w <= 0.0001) { continue; }
        let left_eye = params.beauty_faces[base + 1u];
        let right_eye = params.beauty_faces[base + 2u];
        let mouth = params.beauty_faces[base + 3u];
        let contour = beauty_contour_metrics(uv, face, base);
        let face_fill = contour.x * 0.13;
        let face_line = contour.y;
        let left_line = beauty_outline(uv, vec4<f32>(left_eye.xy, left_eye.zw * 4.2), 0.035);
        let right_line = beauty_outline(uv, vec4<f32>(right_eye.xy, right_eye.zw * 4.2), 0.035);
        let mouth_line = beauty_outline(uv, vec4<f32>(mouth.xy, mouth.zw * 3.3), 0.035);
        let center = beauty_center_mark(uv, face.xy, face);
        result = mix(result, vec3<f32>(0.0, 0.72, 1.0), face_fill);
        result = mix(result, vec3<f32>(0.0, 0.82, 1.0), max(face_line, center) * 0.95);
        result = mix(result, vec3<f32>(0.25, 1.0, 0.42), max(left_line, right_line) * 0.95);
        result = mix(result, vec3<f32>(1.0, 0.62, 0.1), mouth_line * 0.95);
    }
    return result;
}
