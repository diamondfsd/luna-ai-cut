use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use ort::{session::Session, value::Tensor};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

const INPUT_SIZE: usize = 512;
const OUTPUT_SIZE: usize = 128;
const CLASS_COUNT: usize = 150;
const WATER_CLASSES: [usize; 5] = [21, 26, 60, 109, 128];

static SESSION: OnceLock<Mutex<Option<(String, Session)>>> = OnceLock::new();

#[napi(object)]
pub struct SegmentationResult {
    pub width: u32,
    pub height: u32,
    pub class_id: u32,
    pub bytes: Buffer,
}

fn preprocess(rgb: &[u8]) -> Result<Vec<f32>, String> {
    let expected = INPUT_SIZE * INPUT_SIZE * 3;
    if rgb.len() != expected {
        return Err(format!("分割输入尺寸不正确: {} != {}", rgb.len(), expected));
    }
    let mean = [0.485f32, 0.456, 0.406];
    let std = [0.229f32, 0.224, 0.225];
    let mut input = vec![0.0f32; expected];
    for pixel in 0..INPUT_SIZE * INPUT_SIZE {
        for channel in 0..3 {
            input[channel * INPUT_SIZE * INPUT_SIZE + pixel] =
                (rgb[pixel * 3 + channel] as f32 / 255.0 - mean[channel]) / std[channel];
        }
    }
    Ok(input)
}

fn selected_classes(class_id: usize) -> Vec<usize> {
    if WATER_CLASSES.contains(&class_id) {
        WATER_CLASSES.to_vec()
    } else {
        vec![class_id]
    }
}

fn class_map(logits: &[f32]) -> Vec<u16> {
    let plane = OUTPUT_SIZE * OUTPUT_SIZE;
    let mut classes = vec![0u16; plane];
    for pixel in 0..plane {
        let mut best_class = 0;
        let mut best_value = f32::NEG_INFINITY;
        for class_id in 0..CLASS_COUNT {
            let value = logits[class_id * plane + pixel];
            if value > best_value {
                best_value = value;
                best_class = class_id;
            }
        }
        classes[pixel] = best_class as u16;
    }
    classes
}

fn connected_component(
    classes: &[u16],
    seed_x: usize,
    seed_y: usize,
    targets: &[usize],
) -> Vec<bool> {
    let mut selected = vec![false; OUTPUT_SIZE * OUTPUT_SIZE];
    let seed = seed_y * OUTPUT_SIZE + seed_x;
    if !targets.contains(&(classes[seed] as usize)) {
        return selected;
    }
    let mut queue = VecDeque::from([(seed_x, seed_y)]);
    selected[seed] = true;
    while let Some((x, y)) = queue.pop_front() {
        for (next_x, next_y) in [
            (x.wrapping_sub(1), y),
            (x + 1, y),
            (x, y.wrapping_sub(1)),
            (x, y + 1),
        ] {
            if next_x >= OUTPUT_SIZE || next_y >= OUTPUT_SIZE {
                continue;
            }
            let index = next_y * OUTPUT_SIZE + next_x;
            if !selected[index] && targets.contains(&(classes[index] as usize)) {
                selected[index] = true;
                queue.push_back((next_x, next_y));
            }
        }
    }
    selected
}

fn upscale_and_soften(selected: &[bool]) -> Vec<u8> {
    let mut full = vec![0u8; INPUT_SIZE * INPUT_SIZE];
    for y in 0..INPUT_SIZE {
        for x in 0..INPUT_SIZE {
            full[y * INPUT_SIZE + x] = if selected[(y / 4) * OUTPUT_SIZE + x / 4] {
                255
            } else {
                0
            };
        }
    }
    let mut softened = full.clone();
    for y in 1..INPUT_SIZE - 1 {
        for x in 1..INPUT_SIZE - 1 {
            let mut total = 0u32;
            for offset_y in y - 1..=y + 1 {
                for offset_x in x - 1..=x + 1 {
                    total += full[offset_y * INPUT_SIZE + offset_x] as u32;
                }
            }
            softened[y * INPUT_SIZE + x] = (total / 9) as u8;
        }
    }
    softened
}

pub fn segment(
    model_path: String,
    rgb: Buffer,
    point_x: f64,
    point_y: f64,
) -> Result<SegmentationResult, String> {
    let input = preprocess(rgb.as_ref())?;
    let sessions = SESSION.get_or_init(|| Mutex::new(None));
    let mut guard = sessions
        .lock()
        .map_err(|_| "分割模型状态不可用".to_string())?;
    if guard.as_ref().map(|(path, _)| path.as_str()) != Some(model_path.as_str()) {
        let threads = std::thread::available_parallelism()
            .map(|count| count.get().saturating_sub(1).clamp(1, 4))
            .unwrap_or(2);
        let session = Session::builder()
            .map_err(|error| format!("初始化 ONNX Runtime 失败: {error}"))?
            .with_intra_threads(threads)
            .map_err(|error| format!("配置 ONNX Runtime 失败: {error}"))?
            .commit_from_file(&model_path)
            .map_err(|error| format!("加载分割模型失败: {error}"))?;
        *guard = Some((model_path, session));
    }
    let (_, session) = guard.as_mut().ok_or_else(|| "分割模型未加载".to_string())?;
    let tensor = Tensor::from_array(([1usize, 3, INPUT_SIZE, INPUT_SIZE], input))
        .map_err(|error| format!("创建分割输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("图片分割失败: {error}"))?;
    let (shape, logits) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取分割结果失败: {error}"))?;
    if shape.as_ref()
        != [
            1,
            CLASS_COUNT as i64,
            OUTPUT_SIZE as i64,
            OUTPUT_SIZE as i64,
        ]
    {
        return Err(format!("分割模型输出尺寸不兼容: {shape:?}"));
    }

    let classes = class_map(logits);
    let seed_x = (point_x.clamp(0.0, 1.0) * (OUTPUT_SIZE - 1) as f64).round() as usize;
    let seed_y = (point_y.clamp(0.0, 1.0) * (OUTPUT_SIZE - 1) as f64).round() as usize;
    let class_id = classes[seed_y * OUTPUT_SIZE + seed_x] as usize;
    let targets = selected_classes(class_id);
    let selected = if class_id == 2 || WATER_CLASSES.contains(&class_id) {
        classes
            .iter()
            .map(|value| targets.contains(&(*value as usize)))
            .collect()
    } else {
        connected_component(&classes, seed_x, seed_y, &targets)
    };
    Ok(SegmentationResult {
        width: INPUT_SIZE as u32,
        height: INPUT_SIZE as u32,
        class_id: class_id as u32,
        bytes: upscale_and_soften(&selected).into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preprocessing_uses_channel_first_normalization() {
        let rgb = vec![255u8; INPUT_SIZE * INPUT_SIZE * 3];
        let input = preprocess(&rgb).unwrap();
        assert!((input[0] - (1.0 - 0.485) / 0.229).abs() < 0.0001);
        assert!((input[INPUT_SIZE * INPUT_SIZE] - (1.0 - 0.456) / 0.224).abs() < 0.0001);
    }

    #[test]
    fn connected_component_does_not_select_disconnected_regions() {
        let mut classes = vec![0u16; OUTPUT_SIZE * OUTPUT_SIZE];
        classes[10 * OUTPUT_SIZE + 10] = 12;
        classes[10 * OUTPUT_SIZE + 11] = 12;
        classes[80 * OUTPUT_SIZE + 80] = 12;
        let selected = connected_component(&classes, 10, 10, &[12]);
        assert!(selected[10 * OUTPUT_SIZE + 11]);
        assert!(!selected[80 * OUTPUT_SIZE + 80]);
    }

    #[test]
    fn water_classes_are_grouped() {
        assert_eq!(selected_classes(26), WATER_CLASSES);
        assert_eq!(selected_classes(2), vec![2]);
    }
}
