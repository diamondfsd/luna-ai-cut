use tract_onnx::prelude::*;

use crate::beauty_analysis::{Crop, FaceBox, ModelPlan, RgbImage, image_tensor};

const INPUT_SIDE: usize = 512;

pub(crate) fn detect_face_from_parsing(
    model: &ModelPlan,
    image: &RgbImage,
    crop: Crop,
    score: f32,
) -> Result<Option<FaceBox>, String> {
    let input = image_tensor(image, INPUT_SIDE, crop, true, false, false);
    let outputs = model.run(tvec!(input.into())).map_err(|error| format!("近景面部识别失败: {error}"))?;
    let logits = outputs[0].to_array_view::<f32>().map_err(|error| error.to_string())?;
    let mut min_x = INPUT_SIDE;
    let mut min_y = INPUT_SIDE;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    let mut face_pixels = 0usize;
    for y in 0..INPUT_SIDE {
        for x in 0..INPUT_SIDE {
            let mut label = 0usize;
            let mut confidence = f32::NEG_INFINITY;
            for class in 0..19 {
                let value = logits[[0, class, y, x]];
                if value > confidence { confidence = value; label = class; }
            }
            if label != 1 { continue; }
            face_pixels += 1;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    if face_pixels < 256 || min_x >= max_x || min_y >= max_y {
        crate::log!("[Beauty] person-crop parsing face_pixels={face_pixels} accepted=false");
        return Ok(None);
    }
    let scale = crop.size / INPUT_SIDE as f32;
    let width = (max_x - min_x) as f32 * scale;
    let height = (max_y - min_y) as f32 * scale;
    let face = FaceBox {
        x1: (crop.x + min_x as f32 * scale - width * 0.12).max(0.0),
        y1: (crop.y + min_y as f32 * scale - height * 0.18).max(0.0),
        x2: (crop.x + max_x as f32 * scale + width * 0.12).min(image.width as f32),
        y2: (crop.y + max_y as f32 * scale + height * 0.08).min(image.height as f32),
        score,
    };
    crate::log!(
        "[Beauty] person-crop parsing face_pixels={face_pixels} box=({:.0},{:.0})-({:.0},{:.0}) accepted=true",
        face.x1, face.y1, face.x2, face.y2,
    );
    Ok(Some(face))
}
