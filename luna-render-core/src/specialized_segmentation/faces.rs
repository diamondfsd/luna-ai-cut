use super::*;

#[derive(Clone, Copy)]
pub(super) struct FaceBox {
    pub(super) x1: f32,
    pub(super) y1: f32,
    pub(super) x2: f32,
    pub(super) y2: f32,
    pub(super) score: f32,
}

pub(super) fn intersection_over_union(a: FaceBox, b: FaceBox) -> f32 {
    let width = (a.x2.min(b.x2) - a.x1.max(b.x1)).max(0.0);
    let height = (a.y2.min(b.y2) - a.y1.max(b.y1)).max(0.0);
    let intersection = width * height;
    let area_a = (a.x2 - a.x1).max(0.0) * (a.y2 - a.y1).max(0.0);
    let area_b = (b.x2 - b.x1).max(0.0) * (b.y2 - b.y1).max(0.0);
    intersection / (area_a + area_b - intersection).max(f32::EPSILON)
}

pub(super) fn ultraface_faces(
    boxes: &[f32],
    scores: &[f32],
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
) -> Result<Vec<FaceBox>, String> {
    if boxes.len() % 4 != 0 || scores.len() != boxes.len() / 2 {
        return Err("UltraFace 输出尺寸不兼容".to_string());
    }
    let mut candidates: Vec<FaceBox> = boxes
        .chunks_exact(4)
        .zip(scores.chunks_exact(2))
        .filter_map(|(bounds, probability)| {
            let score = probability[1];
            (score >= 0.72).then_some(FaceBox {
                x1: bounds[0].clamp(0.0, 1.0),
                y1: bounds[1].clamp(0.0, 1.0),
                x2: bounds[2].clamp(0.0, 1.0),
                y2: bounds[3].clamp(0.0, 1.0),
                score,
            })
        })
        .collect();
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut kept: Vec<FaceBox> = Vec::new();
    for candidate in candidates {
        if kept
            .iter()
            .all(|existing| intersection_over_union(candidate, *existing) < 0.35)
        {
            kept.push(candidate);
        }
        if kept.len() >= ULTRAFACE_MAX_FACES {
            break;
        }
    }
    let scaled_width = scaled_width.max(1) as f32;
    let scaled_height = scaled_height.max(1) as f32;
    Ok(kept
        .into_iter()
        .filter_map(|face| {
            let x1 = ((face.x1 * YOLO_SIZE as f32 - pad_x as f32) / scaled_width).clamp(0.0, 1.0);
            let y1 = ((face.y1 * YOLO_SIZE as f32 - pad_y as f32) / scaled_height).clamp(0.0, 1.0);
            let x2 = ((face.x2 * YOLO_SIZE as f32 - pad_x as f32) / scaled_width).clamp(0.0, 1.0);
            let y2 = ((face.y2 * YOLO_SIZE as f32 - pad_y as f32) / scaled_height).clamp(0.0, 1.0);
            (x2 > x1 && y2 > y1).then_some(FaceBox {
                x1,
                y1,
                x2,
                y2,
                score: face.score,
            })
        })
        .collect())
}

pub(super) fn ultraface_mask(
    boxes: &[f32],
    scores: &[f32],
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if output_size == 0 {
        return Err("UltraFace 输出尺寸不兼容".to_string());
    }
    let faces = ultraface_faces(boxes, scores, scaled_width, scaled_height, pad_x, pad_y)?;
    let mut mask = vec![0u8; output_size * output_size];
    for face in faces {
        let x1 = (face.x1 * output_size as f32)
            .floor()
            .clamp(0.0, output_size as f32) as usize;
        let y1 = (face.y1 * output_size as f32)
            .floor()
            .clamp(0.0, output_size as f32) as usize;
        let x2 = (face.x2 * output_size as f32)
            .ceil()
            .clamp(0.0, output_size as f32) as usize;
        let y2 = (face.y2 * output_size as f32)
            .ceil()
            .clamp(0.0, output_size as f32) as usize;
        for y in y1..y2 {
            for x in x1..x2 {
                mask[y * output_size + x] = 255;
            }
        }
    }
    Ok(mask)
}

pub(super) fn run_ultraface(
    session: &mut Session,
    rgb: &[u8],
) -> Result<(Vec<f32>, Vec<f32>), String> {
    let input = preprocess_ultraface(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, ULTRAFACE_HEIGHT, ULTRAFACE_WIDTH], input))
        .map_err(|error| format!("创建 UltraFace 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("人脸识别失败: {error}"))?;
    let mut boxes = None;
    let mut scores = None;
    for (_, output) in outputs.iter() {
        let (shape, values) = output
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取 UltraFace 输出失败: {error}"))?;
        if shape.last() == Some(&4) {
            boxes = Some(values.to_vec());
        }
        if shape.last() == Some(&2) {
            scores = Some(values.to_vec());
        }
    }
    Ok((
        boxes.ok_or_else(|| "UltraFace 缺少人脸框输出".to_string())?,
        scores.ok_or_else(|| "UltraFace 缺少置信度输出".to_string())?,
    ))
}

pub(super) fn segment_ultraface_with_session(
    session: &mut Session,
    rgb: &[u8],
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let (boxes, scores) = run_ultraface(session, rgb)?;
    ultraface_mask(
        &boxes,
        &scores,
        scaled_width,
        scaled_height,
        pad_x,
        pad_y,
        output_size,
    )
}

pub(super) fn extract_ultraface_boxes_with_session(
    session: &mut Session,
    rgb: &[u8],
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if output_size != ULTRAFACE_BOX_VALUES {
        return Err(format!("UltraFace 人脸框输出维度不兼容: {output_size}"));
    }
    let (boxes, scores) = run_ultraface(session, rgb)?;
    let faces = ultraface_faces(&boxes, &scores, scaled_width, scaled_height, pad_x, pad_y)?;
    let mut values = vec![-1.0f32; ULTRAFACE_BOX_VALUES];
    for (index, face) in faces.into_iter().enumerate() {
        let offset = index * 4;
        values[offset] = face.x1;
        values[offset + 1] = face.y1;
        values[offset + 2] = face.x2 - face.x1;
        values[offset + 3] = face.y2 - face.y1;
    }
    Ok(values
        .into_iter()
        .flat_map(f32::to_le_bytes)
        .collect::<Vec<u8>>())
}

pub(super) fn classify_eye_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if output_size != 1 {
        return Err("眼睛分类输出尺寸必须为 1".to_string());
    }
    let input = preprocess_eye(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, EYE_SIZE, EYE_SIZE], input))
        .map_err(|error| format!("创建眼睛分类输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("眼睛状态识别失败: {error}"))?;
    let (_, output) = outputs
        .iter()
        .next()
        .ok_or_else(|| "眼睛分类缺少输出".to_string())?;
    let (_, values) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取眼睛分类输出失败: {error}"))?;
    if values.len() < 2 {
        return Err("眼睛分类输出尺寸不兼容".to_string());
    }
    let sum = (values[0] + values[1]).max(f32::EPSILON);
    Ok(vec![
        ((values[1] / sum).clamp(0.0, 1.0) * 255.0).round() as u8
    ])
}
