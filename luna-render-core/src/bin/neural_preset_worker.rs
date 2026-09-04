use ort::{session::Session, value::Tensor};
use std::{env, fs, process::ExitCode, time::Instant};

const INPUT_SIZE: usize = 256;
const PIXELS: usize = INPUT_SIZE * INPUT_SIZE;

struct NeuralPresetSession {
    session: Session,
    model_load_ms: u128,
}

impl NeuralPresetSession {
    fn load(model_path: &str) -> Result<Self, String> {
        let started = Instant::now();
        let threads = std::thread::available_parallelism()
            .map(|count| count.get().saturating_sub(1).clamp(1, 4))
            .unwrap_or(2);
        let session = Session::builder()
            .map_err(|error| format!("初始化 AI 追色模型失败: {error}"))?
            .with_intra_threads(threads)
            .map_err(|error| format!("配置 AI 追色模型失败: {error}"))?
            .commit_from_file(model_path)
            .map_err(|error| format!("加载 AI 追色模型失败: {error}"))?;
        Ok(Self { session, model_load_ms: started.elapsed().as_millis() })
    }

    fn image_tensor(raw: &[u8]) -> Result<Tensor<f32>, String> {
        if raw.len() != PIXELS * 3 {
            return Err("AI 追色输入尺寸无效".to_string());
        }
        let mut channels = vec![0.0f32; PIXELS * 3];
        for pixel in 0..PIXELS {
            for channel in 0..3 {
                channels[channel * PIXELS + pixel] = raw[pixel * 3 + channel] as f32 / 255.0;
            }
        }
        Tensor::from_array(([1usize, 3, INPUT_SIZE, INPUT_SIZE], channels))
            .map_err(|error| format!("创建 AI 追色输入失败: {error}"))
    }

    fn run(&mut self, content_raw: &[u8], style_raw: &[u8]) -> Result<Vec<u8>, String> {
        let content = Self::image_tensor(content_raw)?;
        let style = Self::image_tensor(style_raw)?;
        let started = Instant::now();
        let outputs = self
            .session
            .run(ort::inputs!["content" => content, "style" => style])
            .map_err(|error| format!("AI 追色推理失败: {error}"))?;

        // Neural-Preset 的第二个输出是 colored_content；优先按名字取，兼容转换器改写输出名。
        let mut selected = None;
        for (index, (name, output)) in outputs.iter().enumerate() {
            if name == "colored_content" || (selected.is_none() && index == 1) {
                selected = Some(output);
                if name == "colored_content" {
                    break;
                }
            }
        }
        let output = selected.ok_or_else(|| "AI 追色模型缺少结果输出".to_string())?;
        let (shape, values) = output
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取 AI 追色结果失败: {error}"))?;
        if **shape != [1, 3, INPUT_SIZE as i64, INPUT_SIZE as i64] {
            return Err(format!("AI 追色结果尺寸无效: {shape:?}"));
        }
        if values.len() != PIXELS * 3 || values.iter().any(|value| !value.is_finite()) {
            return Err("AI 追色结果包含无效像素".to_string());
        }

        let min = values.iter().copied().fold(f32::INFINITY, f32::min);
        let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let signed_output = min < -0.05 && max <= 1.2;
        let byte_output = max > 1.5;
        let mut result = vec![0u8; PIXELS * 3];
        for pixel in 0..PIXELS {
            for channel in 0..3 {
                let value = values[channel * PIXELS + pixel];
                let normalized = if signed_output {
                    (value + 1.0) / 2.0
                } else if byte_output {
                    value / 255.0
                } else {
                    value
                };
                result[pixel * 3 + channel] = (normalized.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
        eprintln!("AI 追色推理完成: {}ms", started.elapsed().as_millis());
        Ok(result)
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 5 {
        return Err("AI 追色任务参数无效".to_string());
    }
    let content = fs::read(&args[2]).map_err(|error| format!("无法读取目标图片: {error}"))?;
    let style = fs::read(&args[3]).map_err(|error| format!("无法读取参考图片: {error}"))?;
    let mut session = NeuralPresetSession::load(&args[1])?;
    let result = session.run(&content, &style)?;
    fs::write(&args[4], result).map_err(|error| format!("无法保存 AI 追色结果: {error}"))?;
    eprintln!("AI 追色模型加载: {}ms", session.model_load_ms);
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
