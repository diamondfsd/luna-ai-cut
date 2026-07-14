fn beauty_ellipse_mask(uv: vec2<f32>, ellipse: vec4<f32>, edge: f32) -> f32 {
    let radius = max(ellipse.zw * 0.5, vec2<f32>(0.0001));
    let p = (uv - ellipse.xy) / radius;
    return 1.0 - smoothstep(max(0.0, 1.0 - edge), 1.0, dot(p, p));
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
        let base = face_index * 4u;
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
        let base = face_index * 4u;
        let face = params.beauty_faces[base];
        if (face.z <= 0.0001 || face.w <= 0.0001) { continue; }
        let left_eye = params.beauty_faces[base + 1u];
        let right_eye = params.beauty_faces[base + 2u];
        let mouth = params.beauty_faces[base + 3u];
        var mask = beauty_ellipse_mask(uv, face, 0.24);
        mask = mask * (1.0 - beauty_eye_mask(uv, left_eye, 2.1));
        mask = mask * (1.0 - beauty_eye_mask(uv, right_eye, 2.1));
        mask = mask * (1.0 - beauty_eye_mask(uv, mouth, 1.65));
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
