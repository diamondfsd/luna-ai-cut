use super::*;

pub(super) fn probability_mask(
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

pub(super) fn normalized_subject_mask(
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
