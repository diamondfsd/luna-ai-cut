use tract_onnx::prelude::*;

use crate::beauty_analysis::{Crop, FaceBox, ModelPlan, RgbImage, intersection_over_union, sample};

const INPUT_SIDE: usize = 416;
const MAX_PEOPLE: usize = 3;

fn input_tensor(image: &RgbImage) -> (Tensor, f32) {
    let ratio = (INPUT_SIDE as f32 / image.width as f32).min(INPUT_SIDE as f32 / image.height as f32);
    let scaled_width = (image.width as f32 * ratio).round() as usize;
    let scaled_height = (image.height as f32 * ratio).round() as usize;
    let mut data = vec![114.0f32; 3 * INPUT_SIDE * INPUT_SIDE];
    for y in 0..scaled_height {
        for x in 0..scaled_width {
            let rgb = sample(image, (x as f32 + 0.5) / ratio - 0.5, (y as f32 + 0.5) / ratio - 0.5);
            for channel in 0..3 {
                data[channel * INPUT_SIDE * INPUT_SIDE + y * INPUT_SIDE + x] = rgb[2 - channel];
            }
        }
    }
    let tensor = tract_ndarray::Array4::from_shape_vec((1, 3, INPUT_SIDE, INPUT_SIDE), data)
        .expect("person tensor shape")
        .into_tensor();
    (tensor, ratio)
}

pub(crate) fn detect_people(model: &ModelPlan, image: &RgbImage) -> Result<Vec<FaceBox>, String> {
    let (input, ratio) = input_tensor(image);
    let outputs = model.run(tvec!(input.into())).map_err(|error| format!("人物检测失败: {error}"))?;
    let predictions = outputs[0].to_array_view::<f32>().map_err(|error| error.to_string())?;
    let mut people = Vec::new();
    let mut index = 0usize;
    for stride in [8usize, 16, 32] {
        let grid_width = INPUT_SIDE / stride;
        let grid_height = INPUT_SIDE / stride;
        for grid_y in 0..grid_height {
            for grid_x in 0..grid_width {
                let score = predictions[[0, index, 4]] * predictions[[0, index, 5]];
                if score >= 0.25 {
                    let center_x = (predictions[[0, index, 0]] + grid_x as f32) * stride as f32 / ratio;
                    let center_y = (predictions[[0, index, 1]] + grid_y as f32) * stride as f32 / ratio;
                    let width = predictions[[0, index, 2]].exp() * stride as f32 / ratio;
                    let height = predictions[[0, index, 3]].exp() * stride as f32 / ratio;
                    people.push(FaceBox {
                        x1: (center_x - width * 0.5).max(0.0),
                        y1: (center_y - height * 0.5).max(0.0),
                        x2: (center_x + width * 0.5).min(image.width as f32),
                        y2: (center_y + height * 0.5).min(image.height as f32),
                        score,
                    });
                }
                index += 1;
            }
        }
    }
    people.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected = Vec::new();
    for person in people {
        if selected.iter().any(|candidate| intersection_over_union(person, *candidate) > 0.45) { continue; }
        selected.push(person);
        if selected.len() == MAX_PEOPLE { break; }
    }
    Ok(selected)
}

pub(crate) fn person_head_crop(person: FaceBox) -> Crop {
    let width = person.x2 - person.x1;
    let height = person.y2 - person.y1;
    let size = (width * 1.25).max(height * 0.68);
    let center_x = (person.x1 + person.x2) * 0.5;
    let center_y = person.y1 + height * 0.30;
    Crop { x: center_x - size * 0.5, y: center_y - size * 0.5, size }
}
