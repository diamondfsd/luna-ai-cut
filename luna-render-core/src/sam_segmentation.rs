use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use ort::{session::Session, value::Tensor};
use std::sync::{Mutex, OnceLock};

const INPUT_SIZE: usize = 1024;
const MASK_SIZE: usize = 256;

static SESSIONS: OnceLock<Mutex<Option<(String, String, Session, Session)>>> = OnceLock::new();

#[napi(object)]
pub struct SamSegmentationResult {
    pub width: u32,
    pub height: u32,
    pub bytes: Buffer,
}

fn preprocess(rgb: &[u8], source_width: usize, source_height: usize) -> Result<Vec<f32>, String> {
    if source_width == 0 || source_height == 0 || source_width > INPUT_SIZE || source_height > INPUT_SIZE {
        return Err("SAM 图片尺寸无效".to_string());
    }
    if rgb.len() != INPUT_SIZE * INPUT_SIZE * 3 {
        return Err("SAM 图片输入尺寸不正确".to_string());
    }
    let mean = [0.485f32, 0.456, 0.406];
    let std = [0.229f32, 0.224, 0.225];
    let mut input = vec![0.0f32; INPUT_SIZE * INPUT_SIZE * 3];
    for y in 0..source_height {
        for x in 0..source_width {
            let pixel = (y * INPUT_SIZE + x) * 3;
            for channel in 0..3 {
                input[channel * INPUT_SIZE * INPUT_SIZE + y * INPUT_SIZE + x] =
                    (rgb[pixel + channel] as f32 / 255.0 - mean[channel]) / std[channel];
            }
        }
    }
    Ok(input)
}

fn bilinear(values: &[f32], x: f32, y: f32) -> f32 {
    let left = x.floor().clamp(0.0, (MASK_SIZE - 1) as f32) as usize;
    let top = y.floor().clamp(0.0, (MASK_SIZE - 1) as f32) as usize;
    let right = (left + 1).min(MASK_SIZE - 1);
    let bottom = (top + 1).min(MASK_SIZE - 1);
    let tx = (x - left as f32).clamp(0.0, 1.0);
    let ty = (y - top as f32).clamp(0.0, 1.0);
    let upper = values[top * MASK_SIZE + left] * (1.0 - tx) + values[top * MASK_SIZE + right] * tx;
    let lower = values[bottom * MASK_SIZE + left] * (1.0 - tx) + values[bottom * MASK_SIZE + right] * tx;
    upper * (1.0 - ty) + lower * ty
}

pub fn segment(
    vision_encoder_path: String,
    prompt_decoder_path: String,
    rgb: Buffer,
    source_width: u32,
    source_height: u32,
    point_x: f64,
    point_y: f64,
) -> Result<SamSegmentationResult, String> {
    let source_width = source_width as usize;
    let source_height = source_height as usize;
    let input = preprocess(rgb.as_ref(), source_width, source_height)?;
    let sessions = SESSIONS.get_or_init(|| Mutex::new(None));
    let mut guard = sessions.lock().map_err(|_| "SAM 模型状态不可用".to_string())?;
    let reload = guard.as_ref().map(|(encoder, decoder, _, _)| {
        encoder != &vision_encoder_path || decoder != &prompt_decoder_path
    }).unwrap_or(true);
    if reload {
        let threads = std::thread::available_parallelism()
            .map(|count| count.get().saturating_sub(1).clamp(1, 4))
            .unwrap_or(2);
        let encoder = Session::builder()
            .map_err(|error| format!("初始化 SAM 失败: {error}"))?
            .with_intra_threads(threads)
            .map_err(|error| format!("配置 SAM 失败: {error}"))?
            .commit_from_file(&vision_encoder_path)
            .map_err(|error| format!("加载 SAM 图像模型失败: {error}"))?;
        let decoder = Session::builder()
            .map_err(|error| format!("初始化 SAM 失败: {error}"))?
            .with_intra_threads(threads)
            .map_err(|error| format!("配置 SAM 失败: {error}"))?
            .commit_from_file(&prompt_decoder_path)
            .map_err(|error| format!("加载 SAM 点选模型失败: {error}"))?;
        *guard = Some((vision_encoder_path, prompt_decoder_path, encoder, decoder));
    }
    let (_, _, encoder, decoder) = guard.as_mut().ok_or_else(|| "SAM 模型未加载".to_string())?;
    let image = Tensor::from_array(([1usize, 3, INPUT_SIZE, INPUT_SIZE], input))
        .map_err(|error| format!("创建 SAM 图片输入失败: {error}"))?;
    let embeddings = encoder.run(ort::inputs!["pixel_values" => image])
        .map_err(|error| format!("SAM 图片分析失败: {error}"))?;
    let (_, image_embeddings) = embeddings[0].try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 SAM 图片特征失败: {error}"))?;
    let image_embeddings = image_embeddings.to_vec();
    let (_, image_positional_embeddings) = embeddings[1].try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 SAM 图片位置特征失败: {error}"))?;
    let image_positional_embeddings = image_positional_embeddings.to_vec();
    let point = Tensor::from_array(([1usize, 1, 1, 2], vec![
        (point_x.clamp(0.0, 1.0) * (source_width.saturating_sub(1)) as f64) as f32,
        (point_y.clamp(0.0, 1.0) * (source_height.saturating_sub(1)) as f64) as f32,
    ])).map_err(|error| format!("创建 SAM 点选输入失败: {error}"))?;
    let labels = Tensor::from_array(([1usize, 1, 1], vec![1i64]))
        .map_err(|error| format!("创建 SAM 点选输入失败: {error}"))?;
    let image_embeddings = Tensor::from_array(([1usize, 256, 64, 64], image_embeddings))
        .map_err(|error| format!("创建 SAM 图片特征失败: {error}"))?;
    let image_positional_embeddings = Tensor::from_array(([1usize, 256, 64, 64], image_positional_embeddings))
        .map_err(|error| format!("创建 SAM 图片位置特征失败: {error}"))?;
    let outputs = decoder.run(ort::inputs![
        "input_points" => point,
        "input_labels" => labels,
        "image_embeddings" => image_embeddings,
        "image_positional_embeddings" => image_positional_embeddings,
    ]).map_err(|error| format!("SAM 蒙版生成失败: {error}"))?;
    let (_, scores) = outputs[0].try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 SAM 结果失败: {error}"))?;
    let best_mask = scores.iter().enumerate().max_by(|(_, a), (_, b)| a.total_cmp(b))
        .map(|(index, _)| index).unwrap_or(0);
    let (_, masks) = outputs[1].try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 SAM 蒙版失败: {error}"))?;
    let offset = best_mask * MASK_SIZE * MASK_SIZE;
    let selected = &masks[offset..offset + MASK_SIZE * MASK_SIZE];
    let mut bytes = vec![0u8; source_width * source_height];
    for y in 0..source_height {
        for x in 0..source_width {
            let sample_x = (x as f32 + 0.5) * MASK_SIZE as f32 / INPUT_SIZE as f32 - 0.5;
            let sample_y = (y as f32 + 0.5) * MASK_SIZE as f32 / INPUT_SIZE as f32 - 0.5;
            let probability = 1.0 / (1.0 + (-bilinear(selected, sample_x, sample_y)).exp());
            bytes[y * source_width + x] = (probability * 255.0).round() as u8;
        }
    }
    Ok(SamSegmentationResult { width: source_width as u32, height: source_height as u32, bytes: bytes.into() })
}
