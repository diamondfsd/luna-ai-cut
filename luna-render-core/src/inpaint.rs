use ort::{session::Session, value::Tensor};
use std::time::Instant;

pub const INPUT_SIZE: usize = 512;
const PIXELS: usize = INPUT_SIZE * INPUT_SIZE;

pub struct InpaintResult {
    pub rgb: Vec<u8>,
    pub inference_ms: u128,
}

pub struct InpaintSession {
    session: Session,
    pub model_load_ms: u128,
}

impl InpaintSession {
    pub fn load(model_path: &str) -> Result<Self, String> {
        let load_started = Instant::now();
        let threads = std::thread::available_parallelism()
            .map(|count| count.get().saturating_sub(1).clamp(1, 4))
            .unwrap_or(2);
        let session = Session::builder()
            .map_err(|error| format!("初始化消除模型失败: {error}"))?
            .with_intra_threads(threads)
            .map_err(|error| format!("配置消除模型失败: {error}"))?
            .commit_from_file(model_path)
            .map_err(|error| format!("加载消除模型失败: {error}"))?;
        Ok(Self {
            session,
            model_load_ms: load_started.elapsed().as_millis(),
        })
    }

    pub fn run(&mut self, rgb: &[u8], mask: &[u8]) -> Result<InpaintResult, String> {
        if rgb.len() != PIXELS * 3 || mask.len() != PIXELS {
            return Err("消除输入尺寸无效".to_string());
        }
        if !mask.iter().any(|value| *value > 0) {
            return Err("消除选区为空".to_string());
        }
        let mut image = vec![0.0f32; PIXELS * 3];
        let mut binary_mask = vec![0.0f32; PIXELS];
        for pixel in 0..PIXELS {
            for channel in 0..3 {
                image[channel * PIXELS + pixel] = rgb[pixel * 3 + channel] as f32 / 255.0;
            }
            binary_mask[pixel] = if mask[pixel] > 0 { 1.0 } else { 0.0 };
        }

        let image = Tensor::from_array(([1usize, 3, INPUT_SIZE, INPUT_SIZE], image))
            .map_err(|error| format!("创建消除图片输入失败: {error}"))?;
        let mask = Tensor::from_array(([1usize, 1, INPUT_SIZE, INPUT_SIZE], binary_mask))
            .map_err(|error| format!("创建消除选区输入失败: {error}"))?;
        let inference_started = Instant::now();
        let outputs = self
            .session
            .run(ort::inputs!["image" => image, "mask" => mask])
            .map_err(|error| format!("图片消除失败: {error}"))?;
        let inference_ms = inference_started.elapsed().as_millis();
        let (shape, values) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取消除结果失败: {error}"))?;
        if shape.len() != 4
            || shape[0] != 1
            || shape[1] != 3
            || shape[2] != INPUT_SIZE as i64
            || shape[3] != INPUT_SIZE as i64
        {
            return Err(format!("消除结果尺寸无效: {shape:?}"));
        }
        if values.len() != PIXELS * 3 || values.iter().any(|value| !value.is_finite()) {
            return Err("消除结果包含无效像素".to_string());
        }
        let mut output = vec![0u8; PIXELS * 3];
        for pixel in 0..PIXELS {
            for channel in 0..3 {
                output[pixel * 3 + channel] =
                    values[channel * PIXELS + pixel].round().clamp(0.0, 255.0) as u8;
            }
        }
        Ok(InpaintResult {
            rgb: output,
            inference_ms,
        })
    }
}
