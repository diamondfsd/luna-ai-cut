pub struct RefinementGuide {
    pub rgb: Vec<u8>,
    pub width: usize,
    pub height: usize,
}

fn dilate_selection(selected: &[bool], width: usize, height: usize) -> Vec<bool> {
    let mut dilated = selected.to_vec();
    for y in 0..height {
        for x in 0..width {
            if !selected[y * width + x] {
                continue;
            }
            for offset_y in -1i32..=1 {
                for offset_x in -1i32..=1 {
                    let next_x = x as i32 + offset_x;
                    let next_y = y as i32 + offset_y;
                    if next_x >= 0 && next_x < width as i32 && next_y >= 0 && next_y < height as i32
                    {
                        dilated[next_y as usize * width + next_x as usize] = true;
                    }
                }
            }
        }
    }
    dilated
}

fn bilinear_sample(values: &[f32], width: usize, height: usize, x: f32, y: f32) -> f32 {
    let x = x.clamp(0.0, (width - 1) as f32);
    let y = y.clamp(0.0, (height - 1) as f32);
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let top = values[y0 * width + x0] * (1.0 - tx) + values[y0 * width + x1] * tx;
    let bottom = values[y1 * width + x0] * (1.0 - tx) + values[y1 * width + x1] * tx;
    top * (1.0 - ty) + bottom * ty
}

fn upscale_probability(
    probability: &[f32],
    selection: &[bool],
    source_size: usize,
    width: usize,
    height: usize,
) -> Vec<f32> {
    let selection = dilate_selection(selection, source_size, source_size);
    let selected_probability: Vec<f32> = probability
        .iter()
        .zip(selection)
        .map(|(value, selected)| if selected { *value } else { 0.0 })
        .collect();
    let mut output = vec![0.0; width * height];
    for y in 0..height {
        let source_y = (y as f32 + 0.5) * source_size as f32 / height as f32 - 0.5;
        for x in 0..width {
            let source_x = (x as f32 + 0.5) * source_size as f32 / width as f32 - 0.5;
            output[y * width + x] = bilinear_sample(
                &selected_probability,
                source_size,
                source_size,
                source_x,
                source_y,
            );
        }
    }
    output
}

fn luminance(rgb: &[u8], pixels: usize) -> Vec<f32> {
    (0..pixels)
        .map(|pixel| {
            let offset = pixel * 3;
            (rgb[offset] as f32 * 0.2126
                + rgb[offset + 1] as f32 * 0.7152
                + rgb[offset + 2] as f32 * 0.0722)
                / 255.0
        })
        .collect()
}

fn box_mean(values: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    let stride = width + 1;
    let mut integral = vec![0.0f32; stride * (height + 1)];
    for y in 0..height {
        let mut row_sum = 0.0;
        for x in 0..width {
            row_sum += values[y * width + x];
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row_sum;
        }
    }
    let mut output = vec![0.0; width * height];
    for y in 0..height {
        let y0 = y.saturating_sub(radius);
        let y1 = (y + radius + 1).min(height);
        for x in 0..width {
            let x0 = x.saturating_sub(radius);
            let x1 = (x + radius + 1).min(width);
            let sum = integral[y1 * stride + x1]
                - integral[y0 * stride + x1]
                - integral[y1 * stride + x0]
                + integral[y0 * stride + x0];
            output[y * width + x] = sum / ((x1 - x0) * (y1 - y0)) as f32;
        }
    }
    output
}

fn guided_filter(guide: &[f32], input: &[f32], width: usize, height: usize) -> Vec<f32> {
    let radius = ((width.max(height) as f32 / 160.0).round() as usize).clamp(4, 16);
    let epsilon = 0.01f32 * 0.01;
    let mean_guide = box_mean(guide, width, height, radius);
    let mean_input = box_mean(input, width, height, radius);

    let guide_squared: Vec<f32> = guide.iter().map(|value| value * value).collect();
    let guide_input: Vec<f32> = guide.iter().zip(input).map(|(a, b)| a * b).collect();
    let correlation_guide = box_mean(&guide_squared, width, height, radius);
    let correlation_guide_input = box_mean(&guide_input, width, height, radius);

    let mut coefficient_a = vec![0.0; width * height];
    let mut coefficient_b = vec![0.0; width * height];
    for index in 0..coefficient_a.len() {
        let variance = correlation_guide[index] - mean_guide[index] * mean_guide[index];
        let covariance = correlation_guide_input[index] - mean_guide[index] * mean_input[index];
        coefficient_a[index] = covariance / (variance + epsilon);
        coefficient_b[index] = mean_input[index] - coefficient_a[index] * mean_guide[index];
    }
    let mean_a = box_mean(&coefficient_a, width, height, radius);
    let mean_b = box_mean(&coefficient_b, width, height, radius);
    guide
        .iter()
        .enumerate()
        .map(|(index, value)| (mean_a[index] * value + mean_b[index]).clamp(0.0, 1.0))
        .collect()
}

pub fn refine_mask(
    probability: &[f32],
    selection: &[bool],
    model_output_size: usize,
    guide: &RefinementGuide,
) -> Result<Vec<u8>, String> {
    let pixels = guide
        .width
        .checked_mul(guide.height)
        .ok_or_else(|| "蒙版引导图尺寸过大".to_string())?;
    let expected_rgb = pixels
        .checked_mul(3)
        .ok_or_else(|| "蒙版引导图尺寸过大".to_string())?;
    if guide.width == 0
        || guide.height == 0
        || pixels > 4096 * 4096
        || guide.rgb.len() != expected_rgb
    {
        return Err("蒙版引导图尺寸无效".to_string());
    }
    let plane = model_output_size
        .checked_mul(model_output_size)
        .ok_or_else(|| "蒙版概率图尺寸过大".to_string())?;
    if probability.len() != plane || selection.len() != plane {
        return Err("蒙版概率图尺寸无效".to_string());
    }
    let upscaled = upscale_probability(
        probability,
        selection,
        model_output_size,
        guide.width,
        guide.height,
    );
    let refined = guided_filter(
        &luminance(&guide.rgb, pixels),
        &upscaled,
        guide.width,
        guide.height,
    );
    Ok(refined
        .into_iter()
        .map(|value| {
            let soft = ((value - 0.12) / (0.55 - 0.12)).clamp(0.0, 1.0);
            let smooth = soft * soft * (3.0 - 2.0 * soft);
            (smooth * 255.0).round() as u8
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_mean_preserves_a_constant_image() {
        let output = box_mean(&vec![0.25; 35], 7, 5, 3);
        assert!(output.iter().all(|value| (*value - 0.25).abs() < 0.0001));
    }

    #[test]
    fn refinement_uses_guide_dimensions_and_keeps_soft_edges() {
        let source_size = 8;
        let mut probability = vec![0.0; source_size * source_size];
        let mut selection = vec![false; source_size * source_size];
        for y in 0..source_size {
            for x in 0..source_size / 2 {
                probability[y * source_size + x] = 0.9;
                selection[y * source_size + x] = true;
            }
        }
        let guide = RefinementGuide {
            rgb: vec![128; 24 * 12 * 3],
            width: 24,
            height: 12,
        };
        let mask = refine_mask(&probability, &selection, source_size, &guide).unwrap();
        assert_eq!(mask.len(), guide.width * guide.height);
        assert!(mask.iter().any(|value| *value > 0 && *value < 255));
        assert!(mask[guide.width * 6 + 3] > 240);
        assert_eq!(mask[guide.width * 6 + 22], 0);
    }

    #[test]
    fn guided_filter_does_not_blur_across_a_strong_guide_edge() {
        let width = 32;
        let height = 8;
        let mut guide = vec![0.0; width * height];
        let mut input = vec![0.0; width * height];
        for y in 0..height {
            for x in 0..width / 2 {
                guide[y * width + x] = 1.0;
                input[y * width + x] = 1.0;
            }
        }
        let output = guided_filter(&guide, &input, width, height);
        assert!(output[height / 2 * width + width / 2 - 1] > 0.95);
        assert!(output[height / 2 * width + width / 2] < 0.05);
    }
}
