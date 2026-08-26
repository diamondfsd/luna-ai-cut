use ort::{session::Session, value::Tensor};
use rustfft::{num_complex::Complex, FftPlanner};
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
        let session = Session::builder()
            .map_err(|error| format!("初始化字幕模型失败: {error}"))?
            .with_intra_threads(threads.clamp(1, 16))
            .map_err(|error| format!("配置字幕模型失败: {error}"))?
            .commit_from_file(model_path)
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
        let session = Session::builder()
            .map_err(|error| format!("初始化语音分段模型失败: {error}"))?
            .with_intra_threads(threads.clamp(1, 8))
            .map_err(|error| format!("配置语音分段模型失败: {error}"))?
            .commit_from_file(model_path)
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

fn hz_to_mel(frequency: f32) -> f32 {
    1127.0 * (1.0 + frequency / 700.0).ln()
}

fn mel_filter_bank() -> Vec<Vec<(usize, f32)>> {
    let bins = FFT_SIZE / 2 + 1;
    let low_mel = hz_to_mel(20.0);
    let high_mel = hz_to_mel(8_000.0);
    let step = (high_mel - low_mel) / (MEL_BINS + 1) as f32;
    let mut filters = vec![Vec::new(); MEL_BINS];
    for (mel_index, filter) in filters.iter_mut().enumerate() {
        let left = low_mel + mel_index as f32 * step;
        let center = left + step;
        let right = center + step;
        for bin in 0..bins {
            let mel = hz_to_mel(bin as f32 * SAMPLE_RATE as f32 / FFT_SIZE as f32);
            let weight = if mel > left && mel <= center {
                (mel - left) / (center - left)
            } else if mel > center && mel < right {
                (right - mel) / (right - center)
            } else {
                0.0
            };
            if weight > 0.0 {
                filter.push((bin, weight));
            }
        }
    }
    filters
}

fn compute_fbank(samples: &[f32]) -> Vec<f32> {
    if samples.len() < FRAME_LENGTH {
        return Vec::new();
    }
    let frame_count = (samples.len() - FRAME_LENGTH) / FRAME_SHIFT + 1;
    let filters = mel_filter_bank();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let window: Vec<f32> = (0..FRAME_LENGTH)
        .map(|index| {
            0.54 - 0.46
                * (2.0 * std::f32::consts::PI * index as f32 / (FRAME_LENGTH - 1) as f32).cos()
        })
        .collect();
    let mut output = vec![0.0f32; frame_count * MEL_BINS];
    let mut frame = vec![0.0f32; FRAME_LENGTH];
    let mut spectrum = vec![Complex::new(0.0f32, 0.0f32); FFT_SIZE];
    for frame_index in 0..frame_count {
        let source = &samples[frame_index * FRAME_SHIFT..frame_index * FRAME_SHIFT + FRAME_LENGTH];
        let mean = source.iter().sum::<f32>() / FRAME_LENGTH as f32;
        for (index, value) in source.iter().enumerate() {
            frame[index] = *value * 32768.0 - mean * 32768.0;
        }
        for index in (1..FRAME_LENGTH).rev() {
            frame[index] -= 0.97 * frame[index - 1];
        }
        frame[0] -= 0.97 * frame[0];
        for index in 0..FFT_SIZE {
            spectrum[index] = if index < FRAME_LENGTH {
                Complex::new(frame[index] * window[index], 0.0)
            } else {
                Complex::new(0.0, 0.0)
            };
        }
        fft.process(&mut spectrum);
        for (mel_index, filter) in filters.iter().enumerate() {
            let energy = filter.iter().fold(0.0f32, |sum, (bin, weight)| {
                sum + weight * spectrum[*bin].norm_sqr()
            });
            output[frame_index * MEL_BINS + mel_index] = energy.max(EPSILON).ln();
        }
    }
    output
}

fn make_model_features(
    samples: &[f32],
    lfr_window_size: usize,
    lfr_window_shift: usize,
    neg_mean: &[f32],
    inv_stddev: &[f32],
) -> Vec<f32> {
    let fbank = compute_fbank(samples);
    let frame_count = fbank.len() / MEL_BINS;
    if frame_count == 0 {
        return Vec::new();
    }
    let output_frames = 1 + (frame_count - 1) / lfr_window_shift;
    let feature_dim = MEL_BINS * lfr_window_size;
    let mut output = vec![0.0f32; output_frames * feature_dim];
    for output_index in 0..output_frames {
        let center = output_index * lfr_window_shift;
        let left_context = (lfr_window_size - 1) / 2;
        for window_index in 0..lfr_window_size {
            let source_index = if window_index + center < left_context {
                0
            } else {
                let source_index = center + window_index - left_context;
                source_index.min(frame_count - 1)
            };
            let destination = output_index * feature_dim + window_index * MEL_BINS;
            let source = source_index * MEL_BINS;
            output[destination..destination + MEL_BINS]
                .copy_from_slice(&fbank[source..source + MEL_BINS]);
        }
    }
    for frame in 0..output_frames {
        for feature in 0..feature_dim {
            let index = frame * feature_dim + feature;
            output[index] = (output[index] + neg_mean[feature]) * inv_stddev[feature];
        }
    }
    output
}

fn detokenize(ids: &[usize], vocab: &[String]) -> String {
    let mut text = String::new();
    let mut mergeable = false;
    let mut previous_was_ascii = false;
    for &id in ids {
        let Some(token) = vocab.get(id) else { continue };
        if token == "<blank>" || token == "<s>" || token == "</s>" {
            continue;
        }
        let is_continuation = token.ends_with("@@");
        let token = token.trim_end_matches("@@").replace('\u{2581}', " ");
        let is_ascii = token.as_bytes().first().is_some_and(|value| *value < 0x80);
        if is_continuation {
            if !mergeable && !text.is_empty() && !text.ends_with(' ') {
                text.push(' ');
            }
            text.push_str(&token);
            mergeable = true;
        } else if is_ascii {
            if !mergeable && !text.is_empty() && !text.ends_with(' ') {
                text.push(' ');
            }
            text.push_str(&token);
            mergeable = false;
        } else {
            if previous_was_ascii && !text.ends_with(' ') {
                text.push(' ');
            }
            text.push_str(&token);
            mergeable = false;
        }
        previous_was_ascii = is_ascii;
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
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
