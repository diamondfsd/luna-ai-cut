use ort::{session::Session, value::Tensor};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use crate::segmentation_refinement::{refine_mask, RefinementGuide};

const DEFAULT_INPUT_SIZE: usize = 512;
const CLASS_COUNT: usize = 150;
const WATER_CLASSES: [usize; 5] = [21, 26, 60, 109, 128];
const MASKFORMER_WATER_CLASSES: [usize; 3] = [22, 24, 71];

static SESSION: OnceLock<Mutex<Option<(String, Session)>>> = OnceLock::new();

pub struct SegmentationResult {
    pub width: u32,
    pub height: u32,
    pub class_id: u32,
    pub bytes: Vec<u8>,
}

fn preprocess(rgb: &[u8], input_size: usize) -> Result<Vec<f32>, String> {
    let expected = input_size * input_size * 3;
    if rgb.len() != expected {
        return Err(format!("分割输入尺寸不正确: {} != {}", rgb.len(), expected));
    }
    let mean = [0.485f32, 0.456, 0.406];
    let std = [0.229f32, 0.224, 0.225];
    let mut input = vec![0.0f32; expected];
    for pixel in 0..input_size * input_size {
        for channel in 0..3 {
            input[channel * input_size * input_size + pixel] =
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

fn class_map(logits: &[f32], output_size: usize) -> Vec<u16> {
    let plane = output_size * output_size;
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
    output_size: usize,
) -> Vec<bool> {
    let mut selected = vec![false; output_size * output_size];
    let seed = seed_y * output_size + seed_x;
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
            if next_x >= output_size || next_y >= output_size {
                continue;
            }
            let index = next_y * output_size + next_x;
            if !selected[index] && targets.contains(&(classes[index] as usize)) {
                selected[index] = true;
                queue.push_back((next_x, next_y));
            }
        }
    }
    selected
}

fn target_probability(logits: &[f32], targets: &[usize], output_size: usize) -> Vec<f32> {
    let plane = output_size * output_size;
    let mut probability = vec![0.0f32; plane];
    for pixel in 0..plane {
        let mut maximum = f32::NEG_INFINITY;
        for class_id in 0..CLASS_COUNT {
            maximum = maximum.max(logits[class_id * plane + pixel]);
        }
        let mut total = 0.0;
        let mut selected = 0.0;
        for class_id in 0..CLASS_COUNT {
            let value = (logits[class_id * plane + pixel] - maximum).exp();
            total += value;
            if targets.contains(&class_id) {
                selected += value;
            }
        }
        probability[pixel] = selected / total.max(f32::EPSILON);
    }
    probability
}

fn maskformer_query_probabilities(
    class_logits: &[f32],
    query_count: usize,
    class_count: usize,
) -> Vec<f32> {
    let mut probabilities = vec![0.0; query_count * class_count];
    let logits_per_query = class_count + 1;
    for query in 0..query_count {
        let offset = query * logits_per_query;
        let maximum = class_logits[offset..offset + logits_per_query]
            .iter()
            .copied()
            .fold(f32::NEG_INFINITY, f32::max);
        let total = class_logits[offset..offset + logits_per_query]
            .iter()
            .map(|value| (*value - maximum).exp())
            .sum::<f32>()
            .max(f32::EPSILON);
        for class_id in 0..class_count {
            probabilities[query * class_count + class_id] =
                (class_logits[offset + class_id] - maximum).exp() / total;
        }
    }
    probabilities
}

fn maskformer_class_map(
    query_probabilities: &[f32],
    mask_logits: &[f32],
    query_count: usize,
    class_count: usize,
    plane: usize,
) -> Vec<u16> {
    let mut best_query_classes = vec![0usize; query_count];
    let mut best_query_probabilities = vec![0.0f32; query_count];
    for query in 0..query_count {
        for class_id in 0..class_count {
            let probability = query_probabilities[query * class_count + class_id];
            if probability > best_query_probabilities[query] {
                best_query_probabilities[query] = probability;
                best_query_classes[query] = class_id;
            }
        }
    }
    (0..plane)
        .map(|pixel| {
            let mut best_class = 0usize;
            let mut best_score = f32::NEG_INFINITY;
            for query in 0..query_count {
                let mask_probability = 1.0 / (1.0 + (-mask_logits[query * plane + pixel]).exp());
                let score = best_query_probabilities[query] * mask_probability;
                if score > best_score {
                    best_score = score;
                    best_class = best_query_classes[query];
                }
            }
            best_class as u16
        })
        .collect()
}

fn maskformer_target_probability(
    query_probabilities: &[f32],
    mask_logits: &[f32],
    query_count: usize,
    class_count: usize,
    plane: usize,
    targets: &[usize],
) -> Vec<f32> {
    (0..plane)
        .map(|pixel| {
            let mut score = 0.0;
            for query in 0..query_count {
                let class_probability = targets
                    .iter()
                    .filter(|class_id| **class_id < class_count)
                    .map(|class_id| query_probabilities[query * class_count + class_id])
                    .sum::<f32>();
                let mask_probability = 1.0 / (1.0 + (-mask_logits[query * plane + pixel]).exp());
                score += class_probability * mask_probability;
            }
            score.clamp(0.0, 1.0)
        })
        .collect()
}

#[allow(dead_code)]
pub fn segment(
    model_path: String,
    rgb: Vec<u8>,
    point_x: f64,
    point_y: f64,
    target_class_id: Option<u32>,
    input_size: Option<u32>,
) -> Result<SegmentationResult, String> {
    segment_with_guide(
        model_path,
        rgb,
        point_x,
        point_y,
        target_class_id,
        input_size,
        None,
    )
}

pub fn segment_with_guide(
    model_path: String,
    rgb: Vec<u8>,
    point_x: f64,
    point_y: f64,
    target_class_id: Option<u32>,
    input_size: Option<u32>,
    guide: Option<RefinementGuide>,
) -> Result<SegmentationResult, String> {
    let input_size = input_size.unwrap_or(DEFAULT_INPUT_SIZE as u32) as usize;
    if !(256..=1024).contains(&input_size) {
        return Err(format!("分割输入尺寸不支持: {input_size}"));
    }
    let input = preprocess(&rgb, input_size)?;
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
    let tensor = Tensor::from_array(([1usize, 3, input_size, input_size], input))
        .map_err(|error| format!("创建分割输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("图片分割失败: {error}"))?;
    let (output_size, class_id, probability, selected) = if outputs.len() >= 2 {
        let (class_shape, class_logits) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取蒙版分类结果失败: {error}"))?;
        let (mask_shape, mask_logits) = outputs[1]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取蒙版结果失败: {error}"))?;
        if class_shape.len() != 3
            || mask_shape.len() != 4
            || class_shape[0] != 1
            || mask_shape[0] != 1
            || class_shape[1] != mask_shape[1]
            || mask_shape[2] != mask_shape[3]
        {
            return Err(format!(
                "蒙版模型输出尺寸不兼容: {class_shape:?}, {mask_shape:?}"
            ));
        }
        let query_count = class_shape[1] as usize;
        let class_count = class_shape[2] as usize - 1;
        let output_size = mask_shape[2] as usize;
        let plane = output_size * output_size;
        let query_probabilities =
            maskformer_query_probabilities(class_logits, query_count, class_count);
        let classes = maskformer_class_map(
            &query_probabilities,
            mask_logits,
            query_count,
            class_count,
            plane,
        );
        let seed_x = (point_x.clamp(0.0, 1.0) * (output_size - 1) as f64).round() as usize;
        let seed_y = (point_y.clamp(0.0, 1.0) * (output_size - 1) as f64).round() as usize;
        let class_id = target_class_id
            .map(|value| value as usize)
            .filter(|value| *value < class_count)
            .unwrap_or(classes[seed_y * output_size + seed_x] as usize);
        let targets = if MASKFORMER_WATER_CLASSES.contains(&class_id) {
            MASKFORMER_WATER_CLASSES.to_vec()
        } else {
            vec![class_id]
        };
        let probability = maskformer_target_probability(
            &query_probabilities,
            mask_logits,
            query_count,
            class_count,
            plane,
            &targets,
        );
        let selected = if target_class_id.is_some() {
            probability.iter().map(|value| *value >= 0.25).collect()
        } else if class_id == 2 || MASKFORMER_WATER_CLASSES.contains(&class_id) {
            classes
                .iter()
                .map(|value| targets.contains(&(*value as usize)))
                .collect()
        } else {
            connected_component(&classes, seed_x, seed_y, &targets, output_size)
        };
        (output_size, class_id, probability, selected)
    } else {
        let (shape, logits) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取分割结果失败: {error}"))?;
        if shape.len() != 4
            || shape[0] != 1
            || shape[1] != CLASS_COUNT as i64
            || shape[2] != shape[3]
        {
            return Err(format!("分割模型输出尺寸不兼容: {shape:?}"));
        }
        let output_size = shape[2] as usize;
        let classes = class_map(logits, output_size);
        let seed_x = (point_x.clamp(0.0, 1.0) * (output_size - 1) as f64).round() as usize;
        let seed_y = (point_y.clamp(0.0, 1.0) * (output_size - 1) as f64).round() as usize;
        let class_id = target_class_id
            .map(|value| value as usize)
            .filter(|value| *value < CLASS_COUNT)
            .unwrap_or(classes[seed_y * output_size + seed_x] as usize);
        let targets = selected_classes(class_id);
        let probability = target_probability(logits, &targets, output_size);
        let selected =
            if target_class_id.is_some() || class_id == 2 || WATER_CLASSES.contains(&class_id) {
                classes
                    .iter()
                    .map(|value| targets.contains(&(*value as usize)))
                    .collect()
            } else {
                connected_component(&classes, seed_x, seed_y, &targets, output_size)
            };
        (output_size, class_id, probability, selected)
    };
    let guide = guide.unwrap_or(RefinementGuide {
        rgb,
        width: input_size,
        height: input_size,
    });
    let bytes = refine_mask(&probability, &selected, output_size, &guide)?;
    Ok(SegmentationResult {
        width: guide.width as u32,
        height: guide.height as u32,
        class_id: class_id as u32,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preprocessing_uses_channel_first_normalization() {
        let rgb = vec![255u8; DEFAULT_INPUT_SIZE * DEFAULT_INPUT_SIZE * 3];
        let input = preprocess(&rgb, DEFAULT_INPUT_SIZE).unwrap();
        assert!((input[0] - (1.0 - 0.485) / 0.229).abs() < 0.0001);
        assert!(
            (input[DEFAULT_INPUT_SIZE * DEFAULT_INPUT_SIZE] - (1.0 - 0.456) / 0.224).abs() < 0.0001
        );
    }

    #[test]
    fn connected_component_does_not_select_disconnected_regions() {
        let output_size = 128;
        let mut classes = vec![0u16; output_size * output_size];
        classes[10 * output_size + 10] = 12;
        classes[10 * output_size + 11] = 12;
        classes[80 * output_size + 80] = 12;
        let selected = connected_component(&classes, 10, 10, &[12], output_size);
        assert!(selected[10 * output_size + 11]);
        assert!(!selected[80 * output_size + 80]);
    }

    #[test]
    fn water_classes_are_grouped() {
        assert_eq!(selected_classes(26), WATER_CLASSES);
        assert_eq!(selected_classes(2), vec![2]);
    }
}
