use super::*;

#[allow(dead_code)]
pub fn segment_yolo(
    model_path: &str,
    rgb: &[u8],
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let mut session = session(model_path)?;
    segment_yolo_with_session(
        &mut session,
        rgb,
        scaled_width,
        scaled_height,
        pad_x,
        pad_y,
        output_size,
    )
}

pub(super) fn segment_yolo_with_session(
    session: &mut Session,
    rgb: &[u8],
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let input = preprocess_yolo(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, YOLO_SIZE, YOLO_SIZE], input))
        .map_err(|error| format!("创建 YOLO26s-seg 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("人物识别失败: {error}"))?;
    if outputs.len() != 2 {
        return Err("YOLO26s-seg 输出数量不兼容".to_string());
    }
    let mut detection = None;
    let mut prototype = None;
    for (_, output) in outputs.iter() {
        let (shape, values) = output
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取 YOLO26s-seg 输出失败: {error}"))?;
        if shape.len() == 3 && shape[0] == 1 && shape[2] >= 7 {
            detection = Some((shape.to_vec(), values.to_vec()));
        } else if shape.len() == 4 && shape[0] == 1 {
            prototype = Some((shape.to_vec(), values.to_vec()));
        }
    }
    let (detection_shape, detections) =
        detection.ok_or_else(|| "YOLO26s-seg 缺少检测输出".to_string())?;
    let (prototype_shape, prototypes) =
        prototype.ok_or_else(|| "YOLO26s-seg 缺少蒙版输出".to_string())?;
    yolo_person_mask(
        &detections,
        detection_shape[1] as usize,
        detection_shape[2] as usize,
        &prototypes,
        prototype_shape[1] as usize,
        prototype_shape[3] as usize,
        prototype_shape[2] as usize,
        scaled_width,
        scaled_height,
        pad_x,
        pad_y,
        output_size,
    )
}

pub(super) fn segment_yolo_labels_with_session(
    session: &mut Session,
    rgb: &[u8],
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let input = preprocess_yolo(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, YOLO_SIZE, YOLO_SIZE], input))
        .map_err(|error| format!("创建 YOLO26s-seg 标签输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("对象标签识别失败: {error}"))?;
    let (shape, detections) = outputs
        .iter()
        .find_map(|(_, output)| {
            let (shape, values) = output.try_extract_tensor::<f32>().ok()?;
            (shape.len() == 3 && shape[0] == 1 && shape[2] >= 7)
                .then(|| (shape.to_vec(), values.to_vec()))
        })
        .ok_or_else(|| "YOLO26s-seg 缺少检测输出".to_string())?;
    yolo_object_map(
        &detections,
        shape[1] as usize,
        shape[2] as usize,
        scaled_width,
        scaled_height,
        pad_x,
        pad_y,
        output_size,
    )
}

pub(super) fn segment_yolo_instances_with_session(
    session: &mut Session,
    rgb: &[u8],
    scaled_width: usize,
    scaled_height: usize,
    pad_x: usize,
    pad_y: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let input = preprocess_yolo(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, YOLO_SIZE, YOLO_SIZE], input))
        .map_err(|error| format!("创建 YOLO26s-seg 实例输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("对象识别失败: {error}"))?;
    let mut detection = None;
    let mut prototype = None;
    for (_, output) in outputs.iter() {
        let (shape, values) = output
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取 YOLO26s-seg 输出失败: {error}"))?;
        if shape.len() == 3 && shape[0] == 1 && shape[2] >= 7 {
            detection = Some((shape.to_vec(), values.to_vec()));
        } else if shape.len() == 4 && shape[0] == 1 {
            prototype = Some((shape.to_vec(), values.to_vec()));
        }
    }
    let (detection_shape, detections) =
        detection.ok_or_else(|| "YOLO26s-seg 缺少检测输出".to_string())?;
    let (prototype_shape, prototypes) =
        prototype.ok_or_else(|| "YOLO26s-seg 缺少蒙版输出".to_string())?;
    yolo_instance_map(
        &detections,
        detection_shape[1] as usize,
        detection_shape[2] as usize,
        &prototypes,
        prototype_shape[1] as usize,
        prototype_shape[3] as usize,
        prototype_shape[2] as usize,
        scaled_width,
        scaled_height,
        pad_x,
        pad_y,
        output_size,
    )
}

pub(super) fn segment_segformer_labels_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let input = preprocess_segformer(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, SEGFORMER_SIZE, SEGFORMER_SIZE], input))
        .map_err(|error| format!("创建场景标签输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("场景标签识别失败: {error}"))?;
    let (_, output) = outputs
        .iter()
        .next()
        .ok_or_else(|| "SegFormer 缺少分类输出".to_string())?;
    let (shape, logits) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取场景标签失败: {error}"))?;
    if shape.len() != 4
        || shape[0] != 1
        || shape[1] != SEGFORMER_CLASSES as i64
        || shape[2] == 0
        || shape[3] == 0
    {
        return Err(format!("SegFormer 输出尺寸不兼容: {shape:?}"));
    }
    let width = shape[3] as usize;
    let height = shape[2] as usize;
    let plane = width * height;
    let mut output = vec![0u8; output_size * output_size];
    for y in 0..output_size {
        let source_y = ((y as f32 + 0.5) * height as f32 / output_size as f32)
            .floor()
            .min((height - 1) as f32) as usize;
        for x in 0..output_size {
            let source_x = ((x as f32 + 0.5) * width as f32 / output_size as f32)
                .floor()
                .min((width - 1) as f32) as usize;
            let pixel = source_y * width + source_x;
            let mut best_class = 0usize;
            let mut best_value = f32::NEG_INFINITY;
            for class_id in 0..SEGFORMER_CLASSES {
                let value = logits[class_id * plane + pixel];
                if value > best_value {
                    best_value = value;
                    best_class = class_id;
                }
            }
            output[y * output_size + x] = best_class as u8 + 1;
        }
    }
    Ok(output)
}
