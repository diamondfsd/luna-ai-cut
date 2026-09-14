#[path = "../musicgen/mod.rs"]
mod musicgen;

use musicgen::{
    MusicGenAudioEncodec, MusicGenConfig, MusicGenDecoder, MusicGenMergedDecoder,
    MusicGenTextEncoder,
};
use ort::session::Session;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokenizers::Tokenizer;

const TOKENS_PER_SECOND: usize = 50;
const MAX_SECONDS: f32 = 30.0;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum WorkerRequest {
    #[serde(rename = "generate")]
    Generate {
        request_id: String,
        prompt: String,
        duration_sec: f32,
        output_path: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyEvent {
    version: u8,
    #[serde(rename = "type")]
    event_type: &'static str,
    model_load_ms: u128,
    sample_rate: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    version: u8,
    #[serde(rename = "type")]
    event_type: &'static str,
    request_id: String,
    generated_tokens: usize,
    total_tokens: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompleteEvent {
    version: u8,
    #[serde(rename = "type")]
    event_type: &'static str,
    request_id: String,
    output_path: String,
    sample_rate: usize,
    sample_count: usize,
    duration_sec: f32,
    inference_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEvent {
    version: u8,
    #[serde(rename = "type")]
    event_type: &'static str,
    request_id: Option<String>,
    error: String,
}

fn emit<T: Serialize>(event: &T) -> Result<(), String> {
    let stdout = io::stdout();
    let mut stdout = stdout.lock();
    serde_json::to_writer(&mut stdout, event)
        .map_err(|error| format!("无法写入音乐任务结果: {error}"))?;
    stdout
        .write_all(b"\n")
        .and_then(|_| stdout.flush())
        .map_err(|error| format!("无法刷新音乐任务结果: {error}"))
}

fn required_file(model_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let path = model_dir.join(name);
    if !path.is_file() {
        return Err(format!("MusicGen 模型缺少文件: {name}"));
    }
    Ok(path)
}

struct MusicGenModels {
    config: MusicGenConfig,
    text_encoder: MusicGenTextEncoder,
    decoder: MusicGenMergedDecoder<f32>,
    audio_encodec: MusicGenAudioEncodec,
}

impl MusicGenModels {
    fn load(model_dir: &Path) -> Result<(Self, u128), String> {
        let started = Instant::now();
        let config_path = required_file(model_dir, "config.json")?;
        let tokenizer_path = required_file(model_dir, "tokenizer.json")?;
        let text_encoder_path = required_file(model_dir, "text_encoder.onnx")?;
        let decoder_path = required_file(model_dir, "decoder_model_merged.onnx")?;
        let encodec_path = required_file(model_dir, "encodec_decode.onnx")?;

        let config_raw = fs::read_to_string(config_path)
            .map_err(|error| format!("无法读取 MusicGen 配置: {error}"))?;
        let config: MusicGenConfig = serde_json::from_str(&config_raw)
            .map_err(|error| format!("MusicGen 配置格式无效: {error}"))?;
        if config.audio_encoder.sampling_rate == 0
            || config.decoder.num_attention_heads == 0
            || config.decoder.num_hidden_layers == 0
            || config.decoder.top_k == 0
            || config.text_encoder.d_kv == 0
        {
            return Err("MusicGen 配置缺少有效的推理参数".to_string());
        }

        let threads = std::thread::available_parallelism()
            .map(|count| count.get().saturating_sub(1).clamp(1, 4))
            .unwrap_or(2);
        let build_session = |path: &Path| -> Result<Session, String> {
            Session::builder()
                .map_err(|error| format!("初始化 MusicGen 模型失败: {error}"))?
                .with_intra_threads(threads)
                .map_err(|error| format!("配置 MusicGen 模型失败: {error}"))?
                .commit_from_file(path)
                .map_err(|error| format!("加载 MusicGen 模型失败: {error}"))
        };

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|error| format!("加载 MusicGen 分词器失败: {error}"))?;
        let text_encoder = MusicGenTextEncoder {
            tokenizer,
            text_encoder: build_session(&text_encoder_path)?,
        };
        let decoder = MusicGenMergedDecoder {
            decoder_model_merged: Arc::new(Mutex::new(build_session(&decoder_path)?)),
            config: config.clone(),
            _phantom_data: Default::default(),
        };
        let audio_encodec = MusicGenAudioEncodec {
            audio_encodec_decode: build_session(&encodec_path)?,
        };
        Ok((
            Self {
                config,
                text_encoder,
                decoder,
                audio_encodec,
            },
            started.elapsed().as_millis(),
        ))
    }

    fn generate(
        &mut self,
        request_id: &str,
        prompt: &str,
        duration_sec: f32,
        output_path: &Path,
    ) -> Result<(usize, f32, u128), String> {
        let inference_started = Instant::now();
        let total_tokens = (duration_sec * TOKENS_PER_SECOND as f32).round() as usize;
        let (hidden_state, attention_mask) = self
            .text_encoder
            .encode(prompt)
            .map_err(|error| format!("MusicGen 文本编码失败: {error}"))?;
        let stream = self
            .decoder
            .generate_tokens(
                hidden_state,
                attention_mask,
                total_tokens,
                Arc::new(std::sync::atomic::AtomicBool::new(false)),
            )
            .map_err(|error| format!("MusicGen 解码失败: {error}"))?;
        let mut tokens = Vec::with_capacity(total_tokens);
        while let Ok(next) = stream.recv() {
            let next = next.map_err(|error| format!("MusicGen 解码失败: {error}"))?;
            tokens.push(next);
            emit(&ProgressEvent {
                version: 1,
                event_type: "progress",
                request_id: request_id.to_string(),
                generated_tokens: tokens.len(),
                total_tokens,
            })?;
        }
        if tokens.is_empty() {
            return Err("MusicGen 没有生成音频 token".to_string());
        }
        let audio = self
            .audio_encodec
            .encode(tokens)
            .map_err(|error| format!("MusicGen 音频解码失败: {error}"))?;
        write_wav(output_path, self.config.audio_encoder.sampling_rate, &audio)?;
        let actual_duration = audio.len() as f32 / self.config.audio_encoder.sampling_rate as f32;
        Ok((
            audio.len(),
            actual_duration,
            inference_started.elapsed().as_millis(),
        ))
    }
}

fn write_wav(path: &Path, sample_rate: usize, samples: &[f32]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建音乐输出目录: {error}"))?;
    }
    let temporary = path.with_extension("wav.part");
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: sample_rate as u32,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(&temporary, spec)
        .map_err(|error| format!("无法创建音乐 WAV 文件: {error}"))?;
    for sample in samples {
        writer
            .write_sample(sample.clamp(-1.0, 1.0))
            .map_err(|error| format!("无法写入音乐 WAV 文件: {error}"))?;
    }
    writer
        .finalize()
        .map_err(|error| format!("无法完成音乐 WAV 文件: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("无法保存音乐 WAV 文件: {error}"))
}

fn validate_request(
    request_id: &str,
    prompt: &str,
    duration_sec: f32,
    output_path: &str,
) -> Result<(), String> {
    if request_id.trim().is_empty() || prompt.trim().is_empty() || prompt.chars().count() > 2_000 {
        return Err("音乐生成请求无效".to_string());
    }
    if !duration_sec.is_finite() || !(1.0..=MAX_SECONDS).contains(&duration_sec) {
        return Err("音乐生成时长必须在 1 到 30 秒之间".to_string());
    }
    if output_path.trim().is_empty() {
        return Err("音乐输出路径不能为空".to_string());
    }
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() == 2 && args[1] == "--health-check" {
        return Ok(());
    }
    if args.len() != 3 || args[1] != "--serve" {
        return Err("MusicGen worker 参数无效".to_string());
    }
    let model_dir = Path::new(&args[2]);
    let (mut models, model_load_ms) = MusicGenModels::load(model_dir)?;
    emit(&ReadyEvent {
        version: 1,
        event_type: "ready",
        model_load_ms,
        sample_rate: models.config.audio_encoder.sampling_rate,
    })?;

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| format!("无法读取音乐任务: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let request: WorkerRequest = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                emit(&ErrorEvent {
                    version: 1,
                    event_type: "error",
                    request_id: None,
                    error: format!("音乐任务格式无效: {error}"),
                })?;
                continue;
            }
        };
        match request {
            WorkerRequest::Generate {
                request_id,
                prompt,
                duration_sec,
                output_path,
            } => {
                if let Err(error) =
                    validate_request(&request_id, &prompt, duration_sec, &output_path)
                {
                    emit(&ErrorEvent {
                        version: 1,
                        event_type: "error",
                        request_id: Some(request_id),
                        error,
                    })?;
                    continue;
                }
                match models.generate(&request_id, &prompt, duration_sec, Path::new(&output_path)) {
                    Ok((sample_count, actual_duration, inference_ms)) => emit(&CompleteEvent {
                        version: 1,
                        event_type: "complete",
                        request_id,
                        output_path,
                        sample_rate: models.config.audio_encoder.sampling_rate,
                        sample_count,
                        duration_sec: actual_duration,
                        inference_ms,
                    })?,
                    Err(error) => emit(&ErrorEvent {
                        version: 1,
                        event_type: "error",
                        request_id: Some(request_id),
                        error,
                    })?,
                }
            }
        }
    }
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
