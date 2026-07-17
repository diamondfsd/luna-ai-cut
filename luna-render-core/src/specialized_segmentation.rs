use ort::{session::Session, value::Tensor};

const YOLO_SIZE: usize = 640;
const BIREFNET_SIZE: usize = 1024;

pub fn preprocess_yolo(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(rgb, YOLO_SIZE, None)
}

pub fn preprocess_birefnet(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(
        rgb,
        BIREFNET_SIZE,
        Some(([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])),
    )
}

pub fn preprocess_rmbg14(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(rgb, BIREFNET_SIZE, Some(([0.5; 3], [1.0; 3])))
}

fn preprocess(
    rgb: &[u8],
    size: usize,
    normalization: Option<([f32; 3], [f32; 3])>,
) -> Result<Vec<f32>, String> {
    if rgb.len() != size * size * 3 {
        return Err(format!("专用分割图片数据尺寸无效: {}", rgb.len()));
    }
    let plane = size * size;
    let mut output = vec![0.0; plane * 3];
    for pixel in 0..plane {
        for channel in 0..3 {
            let value = rgb[pixel * 3 + channel] as f32 / 255.0;
            output[channel * plane + pixel] = normalization
                .map(|(mean, std)| (value - mean[channel]) / std[channel])
                .unwrap_or(value);
        }
    }
    Ok(output)
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

fn bilinear_sample(data: &[f32], width: usize, height: usize, x: f32, y: f32) -> f32 {
    let x = x.clamp(0.0, (width - 1) as f32);
    let y = y.clamp(0.0, (height - 1) as f32);
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let top = data[y0 * width + x0] * (1.0 - tx) + data[y0 * width + x1] * tx;
    let bottom = data[y1 * width + x0] * (1.0 - tx) + data[y1 * width + x1] * tx;
    top * (1.0 - ty) + bottom * ty
}

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

pub fn birefnet_mask(
    logits: &[f32],
    width: usize,
    height: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || output_size == 0 || logits.len() != width * height {
        return Err("BiRefNet 输出尺寸不兼容".to_string());
    }
    let mut output = vec![0u8; output_size * output_size];
    for y in 0..output_size {
        let source_y = (y as f32 + 0.5) * height as f32 / output_size as f32 - 0.5;
        for x in 0..output_size {
            let source_x = (x as f32 + 0.5) * width as f32 / output_size as f32 - 0.5;
            let probability = sigmoid(bilinear_sample(logits, width, height, source_x, source_y));
            output[y * output_size + x] = (probability * 255.0).round() as u8;
        }
    }
    Ok(output)
}

fn probability_mask(
    values: &[f32],
    width: usize,
    height: usize,
    output_size: usize,
    transform: impl Fn(f32) -> f32,
) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || output_size == 0 || values.len() != width * height {
        return Err("主体模型输出尺寸不兼容".to_string());
    }
    let mut probabilities = vec![0.0f32; output_size * output_size];
    for y in 0..output_size {
        let source_y = (y as f32 + 0.5) * height as f32 / output_size as f32 - 0.5;
        for x in 0..output_size {
            let source_x = (x as f32 + 0.5) * width as f32 / output_size as f32 - 0.5;
            probabilities[y * output_size + x] =
                transform(bilinear_sample(values, width, height, source_x, source_y));
        }
    }
    Ok(probabilities
        .into_iter()
        .map(|value| (value.clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect())
}

fn rmbg14_mask(
    values: &[f32],
    width: usize,
    height: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let minimum = values.iter().copied().fold(f32::INFINITY, f32::min);
    let maximum = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let range = maximum - minimum;
    if !minimum.is_finite() || !maximum.is_finite() || range <= f32::EPSILON {
        return Err("RMBG 1.4 返回了无效蒙版".to_string());
    }
    probability_mask(values, width, height, output_size, |value| (value - minimum) / range)
}

fn session(model_path: &str) -> Result<Session, String> {
    let threads = std::thread::available_parallelism()
        .map(|count| count.get().saturating_sub(1).clamp(1, 4))
        .unwrap_or(2);
    Session::builder()
        .map_err(|error| format!("初始化 ONNX Runtime 失败: {error}"))?
        .with_intra_threads(threads)
        .map_err(|error| format!("配置 ONNX Runtime 失败: {error}"))?
        .commit_from_file(model_path)
        .map_err(|error| format!("加载专用分割模型失败: {error}"))
}

pub enum SpecializedSession {
    Yolo(Session),
    BiRefNet(Session),
    Rmbg14(Session),
    Rmbg20(Session),
}

impl SpecializedSession {
    pub fn load(backend: &str, model_path: &str) -> Result<Self, String> {
        match backend {
            "yolo26-seg" => Ok(Self::Yolo(session(model_path)?)),
            "birefnet-general-lite" => Ok(Self::BiRefNet(session(model_path)?)),
            "rmbg-1.4" => Ok(Self::Rmbg14(session(model_path)?)),
            "rmbg-2.0" => Ok(Self::Rmbg20(session(model_path)?)),
            _ => Err("不支持的专用分割模型".to_string()),
        }
    }

    pub fn segment(
        &mut self,
        rgb: &[u8],
        scaled_width: usize,
        scaled_height: usize,
        pad_x: usize,
        pad_y: usize,
        output_size: usize,
    ) -> Result<Vec<u8>, String> {
        match self {
            Self::Yolo(session) => segment_yolo_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::BiRefNet(session) => segment_birefnet_with_session(session, rgb, output_size),
            Self::Rmbg14(session) => segment_rmbg_with_session(session, rgb, output_size, true),
            Self::Rmbg20(session) => segment_rmbg_with_session(session, rgb, output_size, false),
        }
    }
}

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

fn segment_yolo_with_session(
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

pub fn segment_birefnet(
    model_path: &str,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let mut session = session(model_path)?;
    segment_birefnet_with_session(&mut session, rgb, output_size)
}

fn segment_birefnet_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let input = preprocess_birefnet(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, BIREFNET_SIZE, BIREFNET_SIZE], input))
        .map_err(|error| format!("创建 BiRefNet 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("主体识别失败: {error}"))?;
    if outputs.len() != 1 {
        return Err("BiRefNet 输出数量不兼容".to_string());
    }
    let (shape, logits) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 BiRefNet 输出失败: {error}"))?;
    if shape.len() != 4 || shape[0] != 1 || shape[1] != 1 {
        return Err(format!("BiRefNet 输出尺寸不兼容: {shape:?}"));
    }
    birefnet_mask(logits, shape[3] as usize, shape[2] as usize, output_size)
}

pub fn segment_rmbg(
    backend: &str,
    model_path: &str,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let mut session = session(model_path)?;
    segment_rmbg_with_session(&mut session, rgb, output_size, backend == "rmbg-1.4")
}

fn segment_rmbg_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
    normalize_minmax: bool,
) -> Result<Vec<u8>, String> {
    let input = if normalize_minmax { preprocess_rmbg14(rgb)? } else { preprocess_birefnet(rgb)? };
    let tensor = Tensor::from_array(([1usize, 3, BIREFNET_SIZE, BIREFNET_SIZE], input))
        .map_err(|error| format!("创建 RMBG 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("RMBG 主体识别失败: {error}"))?;
    let (_, output) = outputs
        .iter()
        .find(|(_, output)| output.shape().as_ref() == [1, 1, BIREFNET_SIZE as i64, BIREFNET_SIZE as i64])
        .or_else(|| outputs.iter().find(|(_, output)| output.shape().len() == 4))
        .ok_or_else(|| "RMBG 缺少蒙版输出".to_string())?;
    let (shape, values) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 RMBG 输出失败: {error}"))?;
    if shape.len() != 4 || shape[0] != 1 || shape[1] != 1 {
        return Err(format!("RMBG 输出尺寸不兼容: {shape:?}"));
    }
    if normalize_minmax {
        rmbg14_mask(values, shape[3] as usize, shape[2] as usize, output_size)
    } else {
        probability_mask(values, shape[3] as usize, shape[2] as usize, output_size, |value| value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yolo_keeps_person_instances_and_rejects_other_classes() {
        let detections = vec![
            0.0, 0.0, 640.0, 640.0, 0.9, 0.0, 2.0, 0.0, 0.0, 640.0, 640.0, 0.99, 1.0, 2.0,
        ];
        let mask = yolo_person_mask(&detections, 2, 7, &[1.0], 1, 1, 1, 640, 640, 0, 0, 2).unwrap();
        assert!(mask.iter().all(|value| *value > 127));
    }

    #[test]
    fn birefnet_suppresses_negative_logits() {
        let mask = birefnet_mask(&[-8.0, 8.0, -8.0, 8.0], 2, 2, 2).unwrap();
        assert!(mask[0] < 2);
        assert!(mask[1] > 200);
    }

    #[test]
    fn rmbg14_normalizes_the_model_range() {
        let mask = rmbg14_mask(&[-2.0, 0.0, 1.0, 2.0], 2, 2, 2).unwrap();
        assert_eq!(mask[0], 0);
        assert_eq!(mask[3], 255);
    }

    #[test]
    fn rmbg20_preserves_probability_values() {
        let mask = probability_mask(&[0.0, 0.25, 0.5, 1.0], 2, 2, 2, |value| value).unwrap();
        assert_eq!(mask, vec![0, 64, 128, 255]);
    }
}
