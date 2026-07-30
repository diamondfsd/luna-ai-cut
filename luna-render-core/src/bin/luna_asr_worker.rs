use serde::Serialize;
use std::env;
use std::io::{self, BufReader, Read, Write};
use std::process::ExitCode;
use std::time::Instant;
use whisper_rs::{
    get_lang_str, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};

const SAMPLE_RATE: usize = 16_000;
const WINDOW_SAMPLES: usize = SAMPLE_RATE * 60 * 5;
const OVERLAP_SAMPLES: usize = SAMPLE_RATE;

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum WorkerEvent<'a> {
    Ready {
        version: u8,
        model_load_ms: u128,
        gpu: bool,
    },
    Progress {
        version: u8,
        processed_ms: u64,
        total_ms: u64,
    },
    Segment {
        version: u8,
        start_ms: u64,
        end_ms: u64,
        text: &'a str,
    },
    Complete {
        version: u8,
        language: &'a str,
        audio_ms: u64,
        inference_ms: u128,
        segment_count: usize,
    },
}

struct Config {
    model_path: String,
    vad_model_path: String,
    language: Option<String>,
    threads: i32,
    source_start_ms: u64,
    total_ms: u64,
    gpu: bool,
}

fn parse_config() -> Result<Config, String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 8 {
        return Err("字幕识别任务参数无效".to_string());
    }
    let language = match args[3].as_str() {
        "auto" | "" => None,
        value => Some(value.to_string()),
    };
    let threads = args[4]
        .parse::<i32>()
        .map_err(|_| "字幕识别线程数无效".to_string())?
        .clamp(1, 16);
    let source_start_ms = args[5]
        .parse::<u64>()
        .map_err(|_| "字幕识别起始时间无效".to_string())?;
    let total_ms = args[6]
        .parse::<u64>()
        .map_err(|_| "字幕识别时长无效".to_string())?;
    let gpu = match args[7].as_str() {
        "gpu" => true,
        "cpu" => false,
        _ => return Err("字幕识别运行设备无效".to_string()),
    };
    Ok(Config {
        model_path: args[1].clone(),
        vad_model_path: args[2].clone(),
        language,
        threads,
        source_start_ms,
        total_ms,
        gpu,
    })
}

fn emit(event: &WorkerEvent<'_>) -> Result<(), String> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, event)
        .map_err(|error| format!("无法生成字幕识别事件: {error}"))?;
    stdout
        .write_all(b"\n")
        .and_then(|_| stdout.flush())
        .map_err(|error| format!("无法输出字幕识别事件: {error}"))
}

fn read_samples(
    reader: &mut BufReader<io::StdinLock<'_>>,
    output: &mut Vec<f32>,
) -> Result<usize, String> {
    let target = WINDOW_SAMPLES.saturating_sub(output.len());
    if target == 0 {
        return Ok(0);
    }
    let mut raw = vec![0_u8; target * 4];
    let mut bytes_read = 0;
    while bytes_read < raw.len() {
        let count = reader
            .read(&mut raw[bytes_read..])
            .map_err(|error| format!("无法读取视频音频: {error}"))?;
        if count == 0 {
            break;
        }
        bytes_read += count;
    }
    if bytes_read % 4 != 0 {
        return Err("视频音频数据不完整".to_string());
    }
    output.extend(
        raw[..bytes_read]
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
    );
    Ok(bytes_read / 4)
}

fn run() -> Result<(), String> {
    let config = parse_config()?;
    let load_started = Instant::now();
    let mut context_params = WhisperContextParameters::default();
    context_params.use_gpu(config.gpu);
    context_params.flash_attn(true);
    let context = WhisperContext::new_with_params(&config.model_path, context_params)
        .map_err(|error| format!("无法加载字幕识别模型: {error}"))?;
    let model_load_ms = load_started.elapsed().as_millis();
    emit(&WorkerEvent::Ready {
        version: 1,
        model_load_ms,
        gpu: config.gpu,
    })?;

    let inference_started = Instant::now();
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let mut samples = Vec::<f32>::with_capacity(WINDOW_SAMPLES);
    let mut chunk_start_samples = 0_usize;
    let mut segment_count = 0_usize;
    let mut detected_language = config
        .language
        .clone()
        .unwrap_or_else(|| "auto".to_string());
    let mut last_emitted_end_ms = config.source_start_ms;

    loop {
        let read = read_samples(&mut reader, &mut samples)?;
        if samples.is_empty() {
            break;
        }
        let reached_eof = read == 0 || samples.len() < WINDOW_SAMPLES;
        let mut state = context
            .create_state()
            .map_err(|error| format!("无法创建字幕识别任务: {error}"))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(config.threads);
        params.set_language(config.language.as_deref());
        if config.language.as_deref() == Some("zh") {
            params.set_initial_prompt("以下是普通话的简体中文字幕。");
        }
        params.set_translate(false);
        params.set_no_context(true);
        params.set_token_timestamps(true);
        params.set_split_on_word(true);
        params.set_max_len(48);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_vad_model_path(Some(&config.vad_model_path));
        params.enable_vad(true);
        state
            .full(params, &samples)
            .map_err(|error| format!("字幕识别失败: {error}"))?;

        if config.language.is_none() {
            detected_language = get_lang_str(state.full_lang_id_from_state())
                .unwrap_or("auto")
                .to_string();
        }
        let chunk_start_ms = (chunk_start_samples as u64 * 1_000) / SAMPLE_RATE as u64;
        let overlap_boundary_ms = if chunk_start_samples == 0 {
            0
        } else {
            chunk_start_ms + (OVERLAP_SAMPLES as u64 * 500) / SAMPLE_RATE as u64
        };
        for segment in state.as_iter() {
            let text = segment.to_string();
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            let relative_start_ms = chunk_start_ms + segment.start_timestamp().max(0) as u64 * 10;
            let relative_end_ms = chunk_start_ms + segment.end_timestamp().max(0) as u64 * 10;
            if relative_end_ms <= overlap_boundary_ms {
                continue;
            }
            let start_ms = config.source_start_ms + relative_start_ms;
            let end_ms = config.source_start_ms + relative_end_ms;
            if end_ms <= last_emitted_end_ms || end_ms <= start_ms {
                continue;
            }
            emit(&WorkerEvent::Segment {
                version: 1,
                start_ms: start_ms.max(last_emitted_end_ms),
                end_ms,
                text,
            })?;
            last_emitted_end_ms = end_ms;
            segment_count += 1;
        }

        let processed_samples = chunk_start_samples + samples.len();
        let processed_ms =
            ((processed_samples as u64 * 1_000) / SAMPLE_RATE as u64).min(config.total_ms);
        emit(&WorkerEvent::Progress {
            version: 1,
            processed_ms,
            total_ms: config.total_ms,
        })?;
        if reached_eof {
            break;
        }
        let advance = samples.len().saturating_sub(OVERLAP_SAMPLES);
        let retained = samples.split_off(advance);
        samples = retained;
        chunk_start_samples += advance;
    }

    let audio_ms = ((chunk_start_samples + samples.len()) as u64 * 1_000) / SAMPLE_RATE as u64;
    emit(&WorkerEvent::Complete {
        version: 1,
        language: &detected_language,
        audio_ms,
        inference_ms: inference_started.elapsed().as_millis(),
        segment_count,
    })?;
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
