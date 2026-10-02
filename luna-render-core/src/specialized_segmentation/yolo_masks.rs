use super::*;

pub fn yolo_person_mask(
    detections: &[f32],
    detection_count: usize,
    detection_width: usize,
    prototypes: &[f32],
    prototype_channels: usize,
    prototype_width: usize,
    prototype_height: usize,
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if detection_width != 6 + prototype_channels
        || detections.len() != detection_count * detection_width
        || prototypes.len() != prototype_channels * prototype_width * prototype_height
        || scaled_width == 0
        || scaled_height == 0
        || output_size == 0
    {
        return Err("YOLO26s-seg 输出尺寸不兼容".to_string());
    }
    let candidates: Vec<&[f32]> = detections
        .chunks_exact(detection_width)
        .filter(|row| row[4] >= 0.25 && row[5].round() as i32 == 0)
        .collect();
    let mut output = vec![0u8; output_size * output_size];
    let prototype_plane = prototype_width * prototype_height;
    for y in 0..output_size {
        let input_y = pad_y as f32 + (y as f32 + 0.5) * scaled_height as f32 / output_size as f32;
        let prototype_y = input_y * prototype_height as f32 / YOLO_SIZE as f32 - 0.5;
        for x in 0..output_size {
            let input_x =
                pad_x as f32 + (x as f32 + 0.5) * scaled_width as f32 / output_size as f32;
            let prototype_x = input_x * prototype_width as f32 / YOLO_SIZE as f32 - 0.5;
            let mut alpha = 0.0f32;
            for row in &candidates {
                if input_x < row[0] || input_x > row[2] || input_y < row[1] || input_y > row[3] {
                    continue;
                }
                let mut logit = 0.0f32;
                for channel in 0..prototype_channels {
                    let plane =
                        &prototypes[channel * prototype_plane..(channel + 1) * prototype_plane];
                    logit += row[6 + channel]
                        * bilinear_sample(
                            plane,
                            prototype_width,
                            prototype_height,
                            prototype_x,
                            prototype_y,
                        );
                }
                let probability = sigmoid(logit);
                if probability >= 0.5 {
                    alpha = alpha.max(probability);
                }
            }
            output[y * output_size + x] = (alpha * 255.0).round() as u8;
        }
    }
    Ok(output)
}

pub fn yolo_instance_map(
    detections: &[f32],
    detection_count: usize,
    detection_width: usize,
    prototypes: &[f32],
    prototype_channels: usize,
    prototype_width: usize,
    prototype_height: usize,
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if detection_width != 6 + prototype_channels
        || detections.len() != detection_count * detection_width
        || prototypes.len() != prototype_channels * prototype_width * prototype_height
        || scaled_width == 0
        || scaled_height == 0
        || output_size == 0
    {
        return Err("YOLO26s-seg 实例输出尺寸不兼容".to_string());
    }
    let candidates: Vec<&[f32]> = detections
        .chunks_exact(detection_width)
        .filter(|row| row[4] >= 0.25 && (0..80).contains(&(row[5].round() as i32)))
        .take(u16::MAX as usize)
        .collect();
    let pixel_count = output_size * output_size;
    let mut instance_ids = vec![0u16; pixel_count];
    let mut strengths = vec![0.0f32; pixel_count];
    let prototype_plane = prototype_width * prototype_height;
    for (candidate_index, row) in candidates.into_iter().enumerate() {
        let x1 = (((row[0] - pad_x as f32) / scaled_width as f32) * output_size as f32)
            .floor()
            .clamp(0.0, output_size as f32) as usize;
        let y1 = (((row[1] - pad_y as f32) / scaled_height as f32) * output_size as f32)
            .floor()
            .clamp(0.0, output_size as f32) as usize;
        let x2 = (((row[2] - pad_x as f32) / scaled_width as f32) * output_size as f32)
            .ceil()
            .clamp(0.0, output_size as f32) as usize;
        let y2 = (((row[3] - pad_y as f32) / scaled_height as f32) * output_size as f32)
            .ceil()
            .clamp(0.0, output_size as f32) as usize;
        for y in y1..y2 {
            let input_y =
                pad_y as f32 + (y as f32 + 0.5) * scaled_height as f32 / output_size as f32;
            let prototype_y = input_y * prototype_height as f32 / YOLO_SIZE as f32 - 0.5;
            for x in x1..x2 {
                let input_x =
                    pad_x as f32 + (x as f32 + 0.5) * scaled_width as f32 / output_size as f32;
                let prototype_x = input_x * prototype_width as f32 / YOLO_SIZE as f32 - 0.5;
                let mut logit = 0.0f32;
                for channel in 0..prototype_channels {
                    let plane =
                        &prototypes[channel * prototype_plane..(channel + 1) * prototype_plane];
                    logit += row[6 + channel]
                        * bilinear_sample(
                            plane,
                            prototype_width,
                            prototype_height,
                            prototype_x,
                            prototype_y,
                        );
                }
                let probability = sigmoid(logit);
                if probability < 0.5 {
                    continue;
                }
                let index = y * output_size + x;
                let strength = probability * row[4];
                if strength > strengths[index] {
                    strengths[index] = strength;
                    instance_ids[index] = candidate_index as u16 + 1;
                }
            }
        }
    }
    Ok(instance_ids
        .into_iter()
        .flat_map(u16::to_le_bytes)
        .collect())
}

pub(super) fn yolo_object_map(
    detections: &[f32],
    detection_count: usize,
    detection_width: usize,
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if detection_width < 6
        || detections.len() != detection_count * detection_width
        || output_size == 0
    {
        return Err("YOLO26s-seg 检测输出尺寸不兼容".to_string());
    }
    let candidates: Vec<&[f32]> = detections
        .chunks_exact(detection_width)
        .filter(|row| row[4] >= 0.3 && (0..80).contains(&(row[5].round() as i32)))
        .collect();
    let mut output = vec![0u8; output_size * output_size];
    let mut scores = vec![0.0f32; output_size * output_size];
    for row in candidates {
        let x1 = (((row[0] - pad_x as f32) / scaled_width.max(1) as f32) * output_size as f32)
            .floor()
            .clamp(0.0, output_size as f32) as usize;
        let y1 = (((row[1] - pad_y as f32) / scaled_height.max(1) as f32) * output_size as f32)
            .floor()
            .clamp(0.0, output_size as f32) as usize;
        let x2 = (((row[2] - pad_x as f32) / scaled_width.max(1) as f32) * output_size as f32)
            .ceil()
            .clamp(0.0, output_size as f32) as usize;
        let y2 = (((row[3] - pad_y as f32) / scaled_height.max(1) as f32) * output_size as f32)
            .ceil()
            .clamp(0.0, output_size as f32) as usize;
        for y in y1..y2 {
            for x in x1..x2 {
                let index = y * output_size + x;
                if row[4] > scores[index] {
                    scores[index] = row[4];
                    output[index] = row[5].round() as u8 + 1;
                }
            }
        }
    }
    Ok(output)
}
