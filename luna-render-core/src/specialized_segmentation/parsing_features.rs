use super::*;

pub(super) fn score_relic2_cpc_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if output_size != 1 {
        return Err("ReLIC++ CPC 输出尺寸不兼容".to_string());
    }
    let input = preprocess_relic_cpc(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, RELIC_CPC_SIZE, RELIC_CPC_SIZE], input))
        .map_err(|error| format!("创建 ReLIC++ CPC 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("ReLIC++ CPC 推理失败: {error}"))?;
    let (_, output) = outputs
        .iter()
        .next()
        .ok_or_else(|| "ReLIC++ CPC 缺少输出".to_string())?;
    let (shape, values) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 ReLIC++ CPC 输出失败: {error}"))?;
    if values.len() != 1 || shape.iter().product::<i64>() != 1 || !values[0].is_finite() {
        return Err("ReLIC++ CPC 输出尺寸无效".to_string());
    }
    Ok(values[0].to_le_bytes().to_vec())
}

pub(super) fn segment_face_parsing_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    const SIDE: usize = 512;
    const CLASSES: usize = 19;
    if output_size != SIDE || rgb.len() != SIDE * SIDE * 3 {
        return Err("面部皮肤识别输入尺寸不兼容".to_string());
    }
    let mean = [0.485f32, 0.456, 0.406];
    let std = [0.229f32, 0.224, 0.225];
    let mut input = vec![0.0f32; 3 * SIDE * SIDE];
    for pixel in 0..SIDE * SIDE {
        for channel in 0..3 {
            input[channel * SIDE * SIDE + pixel] =
                (rgb[pixel * 3 + channel] as f32 / 255.0 - mean[channel]) / std[channel];
        }
    }
    let tensor = Tensor::from_array(([1usize, 3, SIDE, SIDE], input))
        .map_err(|error| format!("创建面部皮肤识别输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("面部皮肤识别失败: {error}"))?;
    let (_, output) = outputs
        .iter()
        .next()
        .ok_or_else(|| "面部皮肤识别缺少输出".to_string())?;
    let (shape, values) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取面部皮肤识别输出失败: {error}"))?;
    if shape.len() != 4
        || shape[0] != 1
        || shape[1] != CLASSES as i64
        || shape[2] != SIDE as i64
        || shape[3] != SIDE as i64
        || values.len() != CLASSES * SIDE * SIDE
    {
        return Err(format!("面部皮肤识别输出尺寸不兼容: {shape:?}"));
    }
    let mut labels = vec![0u8; SIDE * SIDE];
    for pixel in 0..SIDE * SIDE {
        let mut best_class = 0usize;
        let mut best_score = f32::NEG_INFINITY;
        for class_id in 0..CLASSES {
            let score = values[class_id * SIDE * SIDE + pixel];
            if score > best_score {
                best_score = score;
                best_class = class_id;
            }
        }
        labels[pixel] = best_class as u8;
    }
    Ok(labels)
}

pub(super) fn segment_human_parsing_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    const SIDE: usize = 512;
    const CLASSES: usize = 18;
    if output_size != SIDE || rgb.len() != SIDE * SIDE * 3 {
        return Err("人体皮肤识别输入尺寸不兼容".to_string());
    }
    let mean = [0.406f32, 0.456, 0.485];
    let std = [0.225f32, 0.224, 0.229];
    let mut input = vec![0.0f32; 3 * SIDE * SIDE];
    for pixel in 0..SIDE * SIDE {
        for channel in 0..3 {
            let source_channel = 2 - channel;
            input[channel * SIDE * SIDE + pixel] =
                (rgb[pixel * 3 + source_channel] as f32 / 255.0 - mean[channel]) / std[channel];
        }
    }
    let tensor = Tensor::from_array(([1usize, 3, SIDE, SIDE], input))
        .map_err(|error| format!("创建人体皮肤识别输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("人体皮肤识别失败: {error}"))?;
    for (_, output) in outputs.iter() {
        let Ok((shape, values)) = output.try_extract_tensor::<f32>() else {
            continue;
        };
        if shape.len() != 4
            || shape[0] != 1
            || shape[1] != CLASSES as i64
            || shape[2] != SIDE as i64
            || shape[3] != SIDE as i64
        {
            continue;
        }
        let mut labels = vec![0u8; SIDE * SIDE];
        for pixel in 0..SIDE * SIDE {
            let mut best_class = 0usize;
            let mut best_score = f32::NEG_INFINITY;
            for class_id in 0..CLASSES {
                let score = values[class_id * SIDE * SIDE + pixel];
                if score > best_score {
                    best_score = score;
                    best_class = class_id;
                }
            }
            labels[pixel] = best_class as u8;
        }
        return Ok(labels);
    }
    Err("人体皮肤识别缺少语义输出".to_string())
}

pub(super) fn extract_sface_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if output_size != SFACE_DIMENSION {
        return Err(format!("SFace 特征维度不兼容: {output_size}"));
    }
    let input = preprocess_sface(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, SFACE_SIZE, SFACE_SIZE], input))
        .map_err(|error| format!("创建 SFace 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("人脸特征分析失败: {error}"))?;
    let values = outputs
        .iter()
        .find_map(|(_, output)| {
            let (_, values) = output.try_extract_tensor::<f32>().ok()?;
            (values.len() == SFACE_DIMENSION).then(|| values.to_vec())
        })
        .ok_or_else(|| "SFace 缺少人脸特征输出".to_string())?;
    let length = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    if !length.is_finite() || length <= f32::EPSILON {
        return Err("SFace 返回了无效人脸特征".to_string());
    }
    let mut bytes = Vec::with_capacity(SFACE_DIMENSION * std::mem::size_of::<f32>());
    for value in values {
        bytes.extend_from_slice(&(value / length).to_le_bytes());
    }
    Ok(bytes)
}

pub(super) fn extract_dinov2_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if output_size != DINOV2_DIMENSION {
        return Err(format!("DINOv2 特征维度不兼容: {output_size}"));
    }
    let input = preprocess_dinov2(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, DINOV2_SIZE, DINOV2_SIZE], input))
        .map_err(|error| format!("创建 DINOv2 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("视觉特征分析失败: {error}"))?;
    let values = outputs
        .iter()
        .find_map(|(_, output)| {
            let (shape, values) = output.try_extract_tensor::<f32>().ok()?;
            (shape.len() == 3
                && shape[0] == 1
                && shape[1] > 0
                && shape[2] == DINOV2_DIMENSION as i64)
                .then(|| values[..DINOV2_DIMENSION].to_vec())
        })
        .ok_or_else(|| "DINOv2 缺少图像特征输出".to_string())?;
    let length = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    if !length.is_finite() || length <= f32::EPSILON {
        return Err("DINOv2 返回了无效图像特征".to_string());
    }
    let mut bytes = Vec::with_capacity(DINOV2_DIMENSION * std::mem::size_of::<f32>());
    for value in values {
        bytes.extend_from_slice(&(value / length).to_le_bytes());
    }
    Ok(bytes)
}
