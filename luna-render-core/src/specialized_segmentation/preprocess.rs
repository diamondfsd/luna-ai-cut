use super::*;

pub fn preprocess_yolo(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(rgb, YOLO_SIZE, None)
}

pub fn preprocess_rmbg14(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(rgb, SUBJECT_SIZE, Some(([0.5; 3], [1.0; 3])))
}

pub(super) fn preprocess_segformer(rgb: &[u8]) -> Result<Vec<f32>, String> {
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

pub(super) fn preprocess_relic_cpc(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(
        rgb,
        RELIC_CPC_SIZE,
        Some(([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])),
    )
}

pub(super) fn preprocess_dinov2(rgb: &[u8]) -> Result<Vec<f32>, String> {
    preprocess(
        rgb,
        DINOV2_SIZE,
        Some(([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])),
    )
}

pub(super) fn preprocess_sface(rgb: &[u8]) -> Result<Vec<f32>, String> {
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

pub(super) fn preprocess_ultraface(rgb: &[u8]) -> Result<Vec<f32>, String> {
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

pub(super) fn preprocess_eye(rgb: &[u8]) -> Result<Vec<f32>, String> {
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

pub(super) fn preprocess(
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

pub(super) fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

pub(super) fn bilinear_sample(data: &[f32], width: usize, height: usize, x: f32, y: f32) -> f32 {
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
