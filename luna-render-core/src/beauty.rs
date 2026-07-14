use std::hash::{DefaultHasher, Hash, Hasher};

use base64::Engine;

use crate::{RenderBeautyFace, RenderBeautySettings};

const LANDMARK_INDICES: [usize; 48] = [
    10, 152, 234, 454,
    33, 133, 160, 159, 158, 144, 145, 153,
    263, 362, 387, 386, 385, 373, 374, 380,
    1, 2, 98, 327, 168,
    61, 291, 13, 14, 78, 308, 0, 17,
    82, 312, 87, 317,
    46, 276, 55, 285, 65, 295, 70, 300, 105, 334, 107,
];

pub(crate) struct DecodedSkinMask {
    pub key: u64,
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn pack_faces(faces: &[RenderBeautyFace]) -> [[f32; 4]; 48] {
    let mut data = [[0.0; 4]; 48];
    for (index, face) in faces.iter().take(3).enumerate() {
        let point_count = face.contour.len() / 2;
        if point_count < 3 { continue; }
        let base = index * 16;
        data[base] = [face.center_x as f32, face.center_y as f32, face.width as f32, face.height as f32];
        data[base + 1] = [face.left_eye_x as f32, face.left_eye_y as f32, face.left_eye_radius_x as f32, face.left_eye_radius_y as f32];
        data[base + 2] = [face.right_eye_x as f32, face.right_eye_y as f32, face.right_eye_radius_x as f32, face.right_eye_radius_y as f32];
        data[base + 3] = [face.mouth_x as f32, face.mouth_y as f32, face.mouth_radius_x as f32, face.mouth_radius_y as f32];
        let mut contour = [0.0_f32; 48];
        for target in 0..24 {
            let position = target as f64 * point_count as f64 / 24.0;
            let source = position.floor() as usize % point_count;
            let next = (source + 1) % point_count;
            for axis in 0..2 {
                let start = face.contour[source * 2 + axis];
                let end = face.contour[next * 2 + axis];
                contour[target * 2 + axis] = (start + (end - start) * position.fract()) as f32;
            }
        }
        for pair in 0..12 {
            data[base + 4 + pair].copy_from_slice(&contour[pair * 4..pair * 4 + 4]);
        }
    }
    data
}

pub(crate) fn pack_landmarks(faces: &[RenderBeautyFace]) -> [[f32; 4]; 72] {
    let mut packed = [[0.0_f32; 4]; 72];
    for (face_index, face) in faces.iter().take(3).enumerate() {
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&face.landmark_mesh) else { continue; };
        if bytes.len() < face.landmark_count as usize * 4 { continue; }
        for (slot, source) in LANDMARK_INDICES.iter().enumerate() {
            if *source >= face.landmark_count as usize { continue; }
            let offset = source * 4;
            let scalar = slot * 2;
            packed[face_index * 24 + scalar / 4][scalar % 4] = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as f32 / 65535.0;
            packed[face_index * 24 + scalar / 4][scalar % 4 + 1] = u16::from_le_bytes([bytes[offset + 2], bytes[offset + 3]]) as f32 / 65535.0;
        }
    }
    packed
}

pub(crate) fn mask_key(beauty: &RenderBeautySettings) -> Option<u64> {
    if beauty.skin_mask.is_empty() || beauty.skin_mask_width == 0 || beauty.skin_mask_height == 0 { return None; }
    let mut hasher = DefaultHasher::new();
    beauty.skin_mask.hash(&mut hasher);
    beauty.skin_mask_width.hash(&mut hasher);
    beauty.skin_mask_height.hash(&mut hasher);
    Some(hasher.finish())
}

pub(crate) fn decode_skin_mask(beauty: &RenderBeautySettings) -> Result<Option<DecodedSkinMask>, String> {
    let Some(key) = mask_key(beauty) else { return Ok(None); };
    if beauty.skin_mask_width > 512 || beauty.skin_mask_height > 512 {
        return Err("skin mask size exceeds 512x512".to_string());
    }
    let decoded = base64::engine::general_purpose::STANDARD.decode(&beauty.skin_mask)
        .map_err(|error| format!("decode skin mask failed: {error}"))?;
    let expected = beauty.skin_mask_width as usize * beauty.skin_mask_height as usize;
    if decoded.len() != expected {
        return Err(format!("skin mask size mismatch: {} != {}", decoded.len(), expected));
    }
    let mut rgba = Vec::with_capacity(expected * 4);
    for value in decoded { rgba.extend_from_slice(&[value, value, value, 255]); }
    Ok(Some(DecodedSkinMask { key, rgba, width: beauty.skin_mask_width, height: beauty.skin_mask_height }))
}
