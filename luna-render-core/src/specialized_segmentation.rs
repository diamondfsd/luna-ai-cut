use ort::{session::Session, value::Tensor};

const YOLO_SIZE: usize = 640;
const SEGFORMER_SIZE: usize = 512;
const SEGFORMER_CLASSES: usize = 150;
const SUBJECT_SIZE: usize = 1024;
const ULTRAFACE_WIDTH: usize = 320;
const ULTRAFACE_HEIGHT: usize = 240;
const ULTRAFACE_MAX_FACES: usize = 16;
const ULTRAFACE_BOX_VALUES: usize = ULTRAFACE_MAX_FACES * 4;
const EYE_SIZE: usize = 32;
const DINOV2_SIZE: usize = 224;
const DINOV2_DIMENSION: usize = 384;
const SFACE_SIZE: usize = 112;
const SFACE_DIMENSION: usize = 128;
const RELIC_CPC_SIZE: usize = 224;

pub fn preprocess_yolo(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(rgb, YOLO_SIZE, None)
}

pub fn preprocess_rmbg14(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(rgb, SUBJECT_SIZE, Some(([0.5; 3], [1.0; 3])))
}

fn preprocess_segformer(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(
        rgb,
        SEGFORMER_SIZE,
        Some(([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])),
    )
}

pub fn preprocess_birefnet(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(
        rgb,
        SUBJECT_SIZE,
        Some(([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])),
    )
}

fn preprocess_relic_cpc(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(
        rgb,
        RELIC_CPC_SIZE,
        Some(([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])),
    )
}

fn preprocess_dinov2(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(
        rgb,
        DINOV2_SIZE,
        Some(([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])),
    )
}

fn preprocess_sface(rgb: &[u8]) -> Result<Vec<f32>, String> {
    if rgb.len() != SFACE_SIZE * SFACE_SIZE * 3 {
        return Err(format!("人脸特征图片数据尺寸无效: {}", rgb.len()));
    }
    let plane = SFACE_SIZE * SFACE_SIZE;
    let mut output = vec![0.0; plane * 3];
    for pixel in 0..plane {
        for channel in 0..3 {
            output[channel * plane + pixel] = rgb[pixel * 3 + channel] as f32;
        }
    }
    Ok(output)
}

fn preprocess_ultraface(rgb: &[u8]) -> Result<Vec<f32>, String> {
    if rgb.len() != YOLO_SIZE * YOLO_SIZE * 3 {
        return Err(format!("人脸检测图片数据尺寸无效: {}", rgb.len()));
    }
    let plane = ULTRAFACE_WIDTH * ULTRAFACE_HEIGHT;
    let mut output = vec![0.0; plane * 3];
    for y in 0..ULTRAFACE_HEIGHT {
        let source_y = ((y as f32 + 0.5) * YOLO_SIZE as f32 / ULTRAFACE_HEIGHT as f32)
            .floor()
            .min((YOLO_SIZE - 1) as f32) as usize;
        for x in 0..ULTRAFACE_WIDTH {
            let source_x = ((x as f32 + 0.5) * YOLO_SIZE as f32 / ULTRAFACE_WIDTH as f32)
                .floor()
                .min((YOLO_SIZE - 1) as f32) as usize;
            let pixel = y * ULTRAFACE_WIDTH + x;
            let source = (source_y * YOLO_SIZE + source_x) * 3;
            for channel in 0..3 {
                output[channel * plane + pixel] = (rgb[source + channel] as f32 - 127.0) / 128.0;
            }
        }
    }
    Ok(output)
}

fn preprocess_eye(rgb: &[u8]) -> Result<Vec<f32>, String> {
    if rgb.len() != EYE_SIZE * EYE_SIZE * 3 {
        return Err(format!("眼睛分类图片数据尺寸无效: {}", rgb.len()));
    }
    let plane = EYE_SIZE * EYE_SIZE;
    let mut output = vec![0.0; plane * 3];
    for pixel in 0..plane {
        for channel in 0..3 {
            // Open Model Zoo 模型要求 BGR，并使用转换配置中的 mean/scale。
            let rgb_channel = 2 - channel;
            output[channel * plane + pixel] = (rgb[pixel * 3 + rgb_channel] as f32 - 127.0) / 255.0;
        }
    }
    Ok(output)
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

fn yolo_object_map(
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

fn normalized_subject_mask(
    values: &[f32],
    width: usize,
    height: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let minimum = values.iter().copied().fold(f32::INFINITY, f32::min);
    let maximum = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let range = maximum - minimum;
    if !minimum.is_finite() || !maximum.is_finite() || range <= f32::EPSILON {
        return Err("主体模型返回了无效蒙版".to_string());
    }
    probability_mask(values, width, height, output_size, |value| {
        (value - minimum) / range
    })
}

pub fn birefnet_mask(
    logits: &[f32],
    width: usize,
    height: usize,
    output_size: usize,
) -> Result<Vec<u8>, String> {
    probability_mask(logits, width, height, output_size, sigmoid)
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
    YoloLabels(Session),
    YoloInstances(Session),
    SegformerLabels(Session),
    Rmbg14(Session),
    UltraFace(Session),
    UltraFaceBoxes(Session),
    EyeState(Session),
    Dinov2Small(Session),
    SFace(Session),
    BirefNet(Session),
    FaceParsing(Session),
    HumanParsing(Session),
    Relic2Cpc(Session),
}

impl SpecializedSession {
    pub fn load(backend: &str, model_path: &str) -> Result<Self, String> {
        match backend {
            "yolo26-seg" => Ok(Self::Yolo(session(model_path)?)),
            "yolo26-labels" => Ok(Self::YoloLabels(session(model_path)?)),
            "yolo26-instances" => Ok(Self::YoloInstances(session(model_path)?)),
            "segformer-labels" => Ok(Self::SegformerLabels(session(model_path)?)),
            "rmbg-1.4" => Ok(Self::Rmbg14(session(model_path)?)),
            "ultraface" => Ok(Self::UltraFace(session(model_path)?)),
            "ultraface-boxes" => Ok(Self::UltraFaceBoxes(session(model_path)?)),
            "eye-state" => Ok(Self::EyeState(session(model_path)?)),
            "dinov2-small" => Ok(Self::Dinov2Small(session(model_path)?)),
            "sface" => Ok(Self::SFace(session(model_path)?)),
            "birefnet-general-lite" => Ok(Self::BirefNet(session(model_path)?)),
            "face-parsing" => Ok(Self::FaceParsing(session(model_path)?)),
            "human-parsing" => Ok(Self::HumanParsing(session(model_path)?)),
            "relic2-cpc" => Ok(Self::Relic2Cpc(session(model_path)?)),
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
            Self::YoloLabels(session) => segment_yolo_labels_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::YoloInstances(session) => segment_yolo_instances_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::SegformerLabels(session) => {
                segment_segformer_labels_with_session(session, rgb, output_size)
            }
            Self::Rmbg14(session) => segment_rmbg_with_session(session, rgb, output_size),
            Self::UltraFace(session) => segment_ultraface_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::UltraFaceBoxes(session) => extract_ultraface_boxes_with_session(
                session,
                rgb,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            ),
            Self::EyeState(session) => classify_eye_with_session(session, rgb, output_size),
            Self::Dinov2Small(session) => extract_dinov2_with_session(session, rgb, output_size),
            Self::SFace(session) => extract_sface_with_session(session, rgb, output_size),
            Self::BirefNet(session) => segment_birefnet_with_session(session, rgb, output_size),
            Self::FaceParsing(session) => {
                segment_face_parsing_with_session(session, rgb, output_size)
            }
            Self::HumanParsing(session) => {
                segment_human_parsing_with_session(session, rgb, output_size)
            }
            Self::Relic2Cpc(session) => score_relic2_cpc_with_session(session, rgb, output_size),
        }
    }
}

fn score_relic2_cpc_with_session(
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

fn segment_face_parsing_with_session(
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

fn segment_human_parsing_with_session(
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

fn extract_sface_with_session(
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

fn extract_dinov2_with_session(
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

#[derive(Clone, Copy)]
struct FaceBox {
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    score: f32,
}

fn intersection_over_union(a: FaceBox, b: FaceBox) -> f32 {
    let width = (a.x2.min(b.x2) - a.x1.max(b.x1)).max(0.0);
    let height = (a.y2.min(b.y2) - a.y1.max(b.y1)).max(0.0);
    let intersection = width * height;
    let area_a = (a.x2 - a.x1).max(0.0) * (a.y2 - a.y1).max(0.0);
    let area_b = (b.x2 - b.x1).max(0.0) * (b.y2 - b.y1).max(0.0);
    intersection / (area_a + area_b - intersection).max(f32::EPSILON)
}

fn ultraface_faces(
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

fn ultraface_mask(
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

fn run_ultraface(session: &mut Session, rgb: &[u8]) -> Result<(Vec<f32>, Vec<f32>), String> {
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

fn segment_ultraface_with_session(
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

fn extract_ultraface_boxes_with_session(
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

fn classify_eye_with_session(
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

fn segment_yolo_labels_with_session(
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

fn segment_yolo_instances_with_session(
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

fn segment_segformer_labels_with_session(
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

pub fn segment_rmbg(model_path: &str, rgb: &[u8], output_size: usize) -> Result<Vec<u8>, String> {
    let mut session = session(model_path)?;
    segment_rmbg_with_session(&mut session, rgb, output_size)
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
    let tensor = Tensor::from_array(([1usize, 3, SUBJECT_SIZE, SUBJECT_SIZE], input))
        .map_err(|error| format!("创建 BiRefNet 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("BiRefNet 主体识别失败: {error}"))?;
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

fn segment_rmbg_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let input = preprocess_rmbg14(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, SUBJECT_SIZE, SUBJECT_SIZE], input))
        .map_err(|error| format!("创建 RMBG 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("RMBG 主体识别失败: {error}"))?;
    let (_, output) = outputs
        .iter()
        .find(|(_, output)| {
            output.shape().as_ref() == [1, 1, SUBJECT_SIZE as i64, SUBJECT_SIZE as i64]
        })
        .or_else(|| outputs.iter().find(|(_, output)| output.shape().len() == 4))
        .ok_or_else(|| "RMBG 缺少蒙版输出".to_string())?;
    let (shape, values) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 RMBG 输出失败: {error}"))?;
    if shape.len() != 4 || shape[0] != 1 || shape[1] != 1 {
        return Err(format!("RMBG 输出尺寸不兼容: {shape:?}"));
    }
    normalized_subject_mask(values, shape[3] as usize, shape[2] as usize, output_size)
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
    fn yolo_label_map_keeps_detected_object_classes() {
        let detections = vec![0.0, 0.0, 640.0, 640.0, 0.9, 2.0, 0.0];
        let labels = yolo_object_map(&detections, 1, 7, 640, 640, 0, 0, 2).unwrap();
        assert_eq!(labels, vec![3, 3, 3, 3]);
    }

    #[test]
    fn yolo_instance_map_keeps_instances_separate_and_prefers_stronger_overlap() {
        let detections = vec![
            0.0, 0.0, 400.0, 640.0, 0.8, 2.0, 2.0, 240.0, 0.0, 640.0, 640.0, 0.9, 2.0, 2.0,
        ];
        let bytes =
            yolo_instance_map(&detections, 2, 7, &[1.0], 1, 1, 1, 640, 640, 0, 0, 4).unwrap();
        let ids = bytes
            .chunks_exact(2)
            .map(|value| u16::from_le_bytes([value[0], value[1]]))
            .collect::<Vec<_>>();
        assert_eq!(&ids[0..4], &[1, 2, 2, 2]);
        assert_eq!(bytes.len(), 4 * 4 * 2);
    }

    #[test]
    fn subject_models_normalize_the_model_range() {
        let mask = normalized_subject_mask(&[-2.0, 0.0, 1.0, 2.0], 2, 2, 2).unwrap();
        assert_eq!(mask[0], 0);
        assert_eq!(mask[3], 255);
    }

    #[test]
    fn ultraface_filters_low_confidence_and_overlapping_boxes() {
        let boxes = [
            0.1, 0.1, 0.4, 0.4, 0.11, 0.11, 0.39, 0.39, 0.6, 0.6, 0.8, 0.8,
        ];
        let scores = [0.1, 0.95, 0.1, 0.9, 0.7, 0.3];
        let mask = ultraface_mask(&boxes, &scores, 640, 640, 0, 0, 20).unwrap();
        assert!(mask.iter().any(|value| *value == 255));
        assert_eq!(mask[15 * 20 + 15], 0);
    }

    #[test]
    fn ultraface_keeps_touching_faces_as_independent_boxes() {
        let boxes = [0.1, 0.1, 0.3, 0.4, 0.25, 0.1, 0.45, 0.4];
        let scores = [0.1, 0.95, 0.1, 0.94];
        let faces = ultraface_faces(&boxes, &scores, 640, 640, 0, 0).unwrap();
        assert_eq!(faces.len(), 2);
        assert!(faces[0].x2 > faces[1].x1);
    }

    #[test]
    fn dinov2_preprocessing_uses_expected_shape() {
        let rgb = vec![127u8; DINOV2_SIZE * DINOV2_SIZE * 3];
        let input = preprocess_dinov2(&rgb).unwrap();
        assert_eq!(input.len(), 3 * DINOV2_SIZE * DINOV2_SIZE);
        assert!(input.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn relic_cpc_preprocessing_uses_chw_imagenet_normalization() {
        let plane = RELIC_CPC_SIZE * RELIC_CPC_SIZE;
        let mut rgb = vec![127u8; plane * 3];
        rgb[0] = 0;
        rgb[1] = 127;
        rgb[2] = 255;
        let input = preprocess_relic_cpc(&rgb).unwrap();
        assert_eq!(input.len(), 3 * plane);
        assert!((input[0] - ((0.0 - 0.485) / 0.229)).abs() < 1e-6);
        assert!((input[plane] - ((127.0 / 255.0 - 0.456) / 0.224)).abs() < 1e-6);
        assert!((input[plane * 2] - ((255.0 / 255.0 - 0.406) / 0.225)).abs() < 1e-6);
    }

    #[test]
    fn sface_preprocessing_preserves_rgb_byte_range() {
        let rgb = vec![127u8; SFACE_SIZE * SFACE_SIZE * 3];
        let input = preprocess_sface(&rgb).unwrap();
        assert_eq!(input.len(), 3 * SFACE_SIZE * SFACE_SIZE);
        assert!(input.iter().all(|value| *value == 127.0));
    }

    #[test]
    fn birefnet_applies_sigmoid_to_logits() {
        let mask = birefnet_mask(&[-8.0, 8.0, -8.0, 8.0], 2, 2, 2).unwrap();
        assert!(mask[0] < 2);
        assert!(mask[1] > 200);
    }
}
