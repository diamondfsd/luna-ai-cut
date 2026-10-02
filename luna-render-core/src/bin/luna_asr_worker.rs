#[path = "../onnx_session.rs"]
mod onnx_session;

use crate::onnx_session::load;
use ort::session::Session;
use ort::value::Tensor;
#[path = "../asr_features.rs"]
mod asr_features;
use asr_features::{detokenize, make_model_features};
use serde::Serialize;
use std::{
    env, fs,
    io::{self, Read, Write},
    process::ExitCode,
    time::Instant,
};

const SAMPLE_RATE: usize = 16_000;
const FRAME_LENGTH: usize = 400;
const FRAME_SHIFT: usize = 160;
const FFT_SIZE: usize = 512;
const MEL_BINS: usize = 80;
const MAX_SEGMENT_SAMPLES: usize = SAMPLE_RATE * 30;
const VAD_WINDOW_SAMPLES: usize = 512;
const VAD_STATE_VALUES: usize = 2 * 128;
const VAD_START_THRESHOLD: f32 = 0.5;
const VAD_END_THRESHOLD: f32 = 0.35;
const VAD_MIN_SILENCE_SAMPLES: usize = SAMPLE_RATE * 3 / 10;
const VAD_PAD_SAMPLES: usize = SAMPLE_RATE / 10;
const VAD_MIN_SPEECH_SAMPLES: usize = SAMPLE_RATE / 5;
const EPSILON: f32 = 1.192_092_9e-7;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyEvent {
    version: u8,
    #[serde(rename = "type")]
    event_type: &'static str,
    model_load_ms: u128,
    gpu: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    version: u8,
    #[serde(rename = "type")]
    event_type: &'static str,
    processed_ms: u64,
    total_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SegmentEvent<'a> {
    version: u8,
    #[serde(rename = "type")]
    event_type: &'static str,
    start_ms: u64,
    end_ms: u64,
    text: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompleteEvent {
    version: u8,
    #[serde(rename = "type")]
    event_type: &'static str,
    language: String,
    audio_ms: u64,
    inference_ms: u128,
    segment_count: usize,
}

struct ParaformerSession {
    session: Session,
    vocab: Vec<String>,
    vocab_size: usize,
    lfr_window_size: usize,
    lfr_window_shift: usize,
    neg_mean: Vec<f32>,
    inv_stddev: Vec<f32>,
}

struct SileroVadSession {
    session: Session,
    state: Vec<f32>,
}

fn emit<T: Serialize>(event: &T) -> Result<(), String> {
    let stdout = io::stdout();
    let mut stdout = stdout.lock();
    serde_json::to_writer(&mut stdout, event)
        .map_err(|error| format!("无法编码字幕识别事件: {error}"))?;
    stdout
        .write_all(b"\n")
        .and_then(|_| stdout.flush())
        .map_err(|error| format!("无法写入字幕识别事件: {error}"))
}

fn metadata_value(session: &Session, key: &str) -> Result<String, String> {
    session
        .metadata()
        .map_err(|error| format!("读取字幕模型信息失败: {error}"))?
        .custom(key)
        .ok_or_else(|| format!("字幕模型缺少 {key} 信息"))
}

fn parse_metadata_floats(value: &str, key: &str) -> Result<Vec<f32>, String> {
    value
        .split(',')
        .map(|item| {
            item.parse::<f32>()
                .map_err(|error| format!("字幕模型 {key} 参数无效: {error}"))
        })
        .collect()
}

fn read_vocab(path: &str, expected_size: usize) -> Result<Vec<String>, String> {
    let raw = fs::read_to_string(path).map_err(|error| format!("无法读取字幕词表: {error}"))?;
    let mut vocab = vec![String::new(); expected_size];
    for line in raw.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 2 {
            continue;
        }
        let id = fields
            .last()
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| "字幕词表编号无效".to_string())?;
        if id >= expected_size {
            return Err("字幕词表与模型词数不匹配".to_string());
        }
        vocab[id] = fields[..fields.len() - 1].join(" ");
    }
    if vocab.iter().any(String::is_empty) {
        return Err("字幕词表不完整".to_string());
    }
    Ok(vocab)
}

impl ParaformerSession {
    fn load(model_path: &str, tokens_path: &str, threads: usize) -> Result<Self, String> {
        let session = load(model_path, threads.clamp(1, 16))
            .map_err(|error| format!("加载字幕模型失败: {error}"))?;

        let (vocab_size, lfr_window_size, lfr_window_shift, neg_mean, inv_stddev) = {
            let vocab_size = metadata_value(&session, "vocab_size")?
                .parse::<usize>()
                .map_err(|error| format!("字幕模型词数无效: {error}"))?;
            let lfr_window_size = metadata_value(&session, "lfr_window_size")?
                .parse::<usize>()
                .map_err(|error| format!("字幕模型 LFR 窗口无效: {error}"))?;
            let lfr_window_shift = metadata_value(&session, "lfr_window_shift")?
                .parse::<usize>()
                .map_err(|error| format!("字幕模型 LFR 步长无效: {error}"))?;
            let neg_mean =
                parse_metadata_floats(&metadata_value(&session, "neg_mean")?, "neg_mean")?;
            let inv_stddev =
                parse_metadata_floats(&metadata_value(&session, "inv_stddev")?, "inv_stddev")?;
            (
                vocab_size,
                lfr_window_size,
                lfr_window_shift,
                neg_mean,
                inv_stddev,
            )
        };
        if lfr_window_size == 0 || lfr_window_shift == 0 || neg_mean.len() != inv_stddev.len() {
            return Err("字幕模型特征参数不兼容".to_string());
        }
        let vocab = read_vocab(tokens_path, vocab_size)?;
        if neg_mean.len() != MEL_BINS * lfr_window_size {
            return Err("字幕模型 CMVN 参数不兼容".to_string());
        }
        Ok(Self {
            session,
            vocab,
            vocab_size,
            lfr_window_size,
            lfr_window_shift,
            neg_mean,
            inv_stddev,
        })
    }

    fn infer(&mut self, samples: &[f32]) -> Result<String, String> {
        let features = make_model_features(
            samples,
            self.lfr_window_size,
            self.lfr_window_shift,
            &self.neg_mean,
            &self.inv_stddev,
        );
        if features.is_empty() {
            return Ok(String::new());
        }
        let frame_count = features.len() / (MEL_BINS * self.lfr_window_size);
        let input = Tensor::from_array((
            vec![1usize, frame_count, MEL_BINS * self.lfr_window_size],
            features,
        ))
        .map_err(|error| format!("创建字幕模型输入失败: {error}"))?;
        let lengths = Tensor::from_array(([1usize], vec![frame_count as i32]))
            .map_err(|error| format!("创建字幕长度输入失败: {error}"))?;
        let outputs = self
            .session
            .run(ort::inputs!["speech" => input, "speech_lengths" => lengths])
            .map_err(|error| format!("字幕模型推理失败: {error}"))?;
        let (shape, logits) = outputs["logits"]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取字幕模型结果失败: {error}"))?;
        if shape.len() != 3 || shape[0] != 1 || shape[2] as usize != self.vocab_size {
            return Err("字幕模型输出尺寸不兼容".to_string());
        }
        let token_count = outputs["token_num"]
            .try_extract_tensor::<i32>()
            .ok()
            .and_then(|(_, values)| values.first().copied())
            .map(|value| value.max(0) as usize)
            .unwrap_or(shape[1] as usize)
            .min(shape[1] as usize);
        let mut ids = Vec::with_capacity(token_count);
        for row in logits.chunks_exact(self.vocab_size).take(token_count) {
            let token_id = row
                .iter()
                .enumerate()
                .max_by(|(_, left), (_, right)| left.total_cmp(right))
                .map(|(index, _)| index)
                .unwrap_or(0);
            if token_id > 2 {
                ids.push(token_id);
            }
        }
        Ok(detokenize(&ids, &self.vocab))
    }
}

impl SileroVadSession {
    fn load(model_path: &str, threads: usize) -> Result<Self, String> {
        let session = load(model_path, threads.clamp(1, 8))
            .map_err(|error| format!("加载语音分段模型失败: {error}"))?;
        Ok(Self {
            session,
            state: vec![0.0; VAD_STATE_VALUES],
        })
    }

    fn probability(&mut self, samples: &[f32]) -> Result<f32, String> {
        if samples.len() != VAD_WINDOW_SAMPLES {
            return Err("语音分段输入长度不兼容".to_string());
        }
        let input = Tensor::from_array(([1usize, VAD_WINDOW_SAMPLES], samples.to_vec()))
            .map_err(|error| format!("创建语音分段输入失败: {error}"))?;
        let state = Tensor::from_array(([2usize, 1usize, 128usize], self.state.clone()))
            .map_err(|error| format!("创建语音分段状态失败: {error}"))?;
        let sample_rate = Tensor::from_array(([1usize], vec![SAMPLE_RATE as i64]))
            .map_err(|error| format!("创建语音分段采样率失败: {error}"))?;
        let outputs = self
            .session
            .run(ort::inputs!["input" => input, "state" => state, "sr" => sample_rate])
            .map_err(|error| format!("语音分段模型推理失败: {error}"))?;
        let (_, probability) = outputs["output"]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取语音分段结果失败: {error}"))?;
        let probability = probability
            .first()
            .copied()
            .filter(|value| value.is_finite())
            .ok_or_else(|| "语音分段模型返回了无效概率".to_string())?;
        let (state_shape, next_state) = outputs["stateN"]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取语音分段状态失败: {error}"))?;
        if state_shape.len() != 3
            || state_shape[0] != 2
            || state_shape[1] != 1
            || state_shape[2] != 128
            || next_state.len() != VAD_STATE_VALUES
        {
            return Err("语音分段模型状态尺寸不兼容".to_string());
        }
        self.state.copy_from_slice(next_state);
        Ok(probability.clamp(0.0, 1.0))
    }
}

fn read_audio() -> Result<Vec<f32>, String> {
    let mut bytes = Vec::new();
    io::stdin()
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取视频语音: {error}"))?;
    if bytes.len() % std::mem::size_of::<f32>() != 0 {
        return Err("视频语音数据不完整".to_string());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn vad_segments(
    samples: &[f32],
    vad: &mut SileroVadSession,
) -> Result<Vec<(usize, usize)>, String> {
    if samples.is_empty() {
        return Ok(Vec::new());
    }
    let mut segments = Vec::new();
    let mut chunk = vec![0.0f32; VAD_WINDOW_SAMPLES];
    let mut speech_start = None;
    let mut silent_samples = 0;
    for start in (0..samples.len()).step_by(VAD_WINDOW_SAMPLES) {
        chunk.fill(0.0);
        let end = (start + VAD_WINDOW_SAMPLES).min(samples.len());
        chunk[..end - start].copy_from_slice(&samples[start..end]);
        let probability = vad.probability(&chunk)?;
        let threshold = if speech_start.is_some() {
            VAD_END_THRESHOLD
        } else {
            VAD_START_THRESHOLD
        };
        if probability >= threshold {
            if speech_start.is_none() {
                speech_start = Some(start.saturating_sub(VAD_PAD_SAMPLES));
            }
            silent_samples = 0;
            continue;
        }
        let Some(active_start) = speech_start else {
            continue;
        };
        silent_samples += VAD_WINDOW_SAMPLES;
        if silent_samples >= VAD_MIN_SILENCE_SAMPLES {
            let segment_end = (start + VAD_WINDOW_SAMPLES + VAD_PAD_SAMPLES).min(samples.len());
            push_segment(&mut segments, active_start, segment_end, samples.len());
            speech_start = None;
            silent_samples = 0;
        }
    }
    if let Some(active_start) = speech_start {
        push_segment(&mut segments, active_start, samples.len(), samples.len());
    }
    merge_segments(&mut segments);
    Ok(segments)
}

fn push_segment(segments: &mut Vec<(usize, usize)>, start: usize, end: usize, sample_count: usize) {
    let start = start.min(sample_count);
    let end = end.min(sample_count);
    if end.saturating_sub(start) < VAD_MIN_SPEECH_SAMPLES {
        return;
    }
    let mut cursor = start;
    while cursor < end {
        let next = (cursor + MAX_SEGMENT_SAMPLES).min(end);
        segments.push((cursor, next));
        cursor = next;
    }
}

fn merge_segments(segments: &mut Vec<(usize, usize)>) {
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(segments.len());
    for &(start, end) in segments.iter() {
        if let Some(previous) = merged.last_mut() {
            if start.saturating_sub(previous.1) <= SAMPLE_RATE * 3 / 10
                && end.saturating_sub(previous.0) <= MAX_SEGMENT_SAMPLES
            {
                previous.1 = end;
                continue;
            }
        }
        merged.push((start, end));
    }
    *segments = merged;
}

fn parse_threads(value: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map(|threads| threads.clamp(1, 16))
        .map_err(|error| format!("字幕识别线程数无效: {error}"))
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() == 2 && args[1] == "--health-check" {
        return Ok(());
    }
    if args.len() != 9 {
        return Err("字幕识别任务参数无效".to_string());
    }
    let model_path = &args[1];
    let tokens_path = &args[2];
    let vad_path = &args[3];
    let language = match args[4].as_str() {
        "zh" | "en" => args[4].clone(),
        "auto" => "zh".to_string(),
        _ => return Err("字幕识别语言无效".to_string()),
    };
    let threads = parse_threads(&args[5])?;
    let source_start_ms = args[6]
        .parse::<u64>()
        .map_err(|error| format!("字幕起始时间无效: {error}"))?;
    let total_ms = args[7]
        .parse::<u64>()
        .map_err(|error| format!("字幕总时长无效: {error}"))?;

    let load_started = Instant::now();
    let mut vad = SileroVadSession::load(vad_path, threads)?;
    let mut model = ParaformerSession::load(model_path, tokens_path, threads)?;
    emit(&ReadyEvent {
        version: 1,
        event_type: "ready",
        model_load_ms: load_started.elapsed().as_millis(),
        gpu: false,
    })?;

    let samples = read_audio()?;
    let audio_ms = ((samples.len() as u64 * 1_000) / SAMPLE_RATE as u64).min(total_ms);
    let inference_started = Instant::now();
    let segments = vad_segments(&samples, &mut vad)?;
    let mut segment_count = 0;
    for (start, end) in segments {
        let text = model.infer(&samples[start..end])?;
        if !text.is_empty() {
            let start_ms = source_start_ms + (start as u64 * 1_000 / SAMPLE_RATE as u64);
            let end_ms = source_start_ms + (end as u64 * 1_000 / SAMPLE_RATE as u64);
            emit(&SegmentEvent {
                version: 1,
                event_type: "segment",
                start_ms,
                end_ms: end_ms.max(start_ms + 10),
                text: &text,
            })?;
            segment_count += 1;
        }
        let processed_ms = ((end as u64 * 1_000) / SAMPLE_RATE as u64).min(total_ms);
        emit(&ProgressEvent {
            version: 1,
            event_type: "progress",
            processed_ms,
            total_ms,
        })?;
    }
    emit(&CompleteEvent {
        version: 1,
        event_type: "complete",
        language,
        audio_ms,
        inference_ms: inference_started.elapsed().as_millis(),
        segment_count,
    })
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
