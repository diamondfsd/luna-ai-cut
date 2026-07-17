use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::process::ExitCode;
use std::time::Instant;

#[path = "../specialized_segmentation.rs"]
mod specialized_segmentation;

fn number(value: &str, label: &str) -> Result<usize, String> {
    value.parse().map_err(|_| format!("{label}无效"))
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum WorkerCommand {
    Ping {
        id: String,
    },
    Segment {
        id: String,
        backend: String,
        #[serde(rename = "modelPath")]
        model_path: String,
        #[serde(rename = "inputPath")]
        input_path: String,
        #[serde(rename = "outputPath")]
        output_path: String,
        #[serde(rename = "scaledWidth")]
        scaled_width: usize,
        #[serde(rename = "scaledHeight")]
        scaled_height: usize,
        #[serde(rename = "padX")]
        pad_x: usize,
        #[serde(rename = "padY")]
        pad_y: usize,
        #[serde(rename = "outputSize")]
        output_size: usize,
    },
    Shutdown {
        id: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WorkerResponse {
    Pong {
        id: String,
    },
    Result {
        id: String,
        #[serde(rename = "sessionLoadMs")]
        session_load_ms: u128,
        #[serde(rename = "inferenceMs")]
        inference_ms: u128,
        #[serde(rename = "sessionReused")]
        session_reused: bool,
    },
    Error {
        id: String,
        error: String,
    },
}

fn write_response<W: Write>(writer: &mut W, response: &WorkerResponse) -> Result<(), String> {
    serde_json::to_writer(&mut *writer, response)
        .map_err(|error| format!("无法编码工作进程响应: {error}"))?;
    writer
        .write_all(b"\n")
        .and_then(|_| writer.flush())
        .map_err(|error| format!("无法写入工作进程响应: {error}"))
}

fn run_server<R: BufRead, W: Write>(reader: R, mut writer: W) -> Result<(), String> {
    let mut sessions = HashMap::<String, specialized_segmentation::SpecializedSession>::new();
    for line in reader.lines() {
        let line = line.map_err(|error| format!("无法读取工作进程命令: {error}"))?;
        let command: WorkerCommand = match serde_json::from_str(&line) {
            Ok(command) => command,
            Err(error) => {
                write_response(
                    &mut writer,
                    &WorkerResponse::Error {
                        id: String::new(),
                        error: format!("工作进程命令无效: {error}"),
                    },
                )?;
                continue;
            }
        };
        match command {
            WorkerCommand::Ping { id } => {
                write_response(&mut writer, &WorkerResponse::Pong { id })?
            }
            WorkerCommand::Shutdown { id } => {
                write_response(&mut writer, &WorkerResponse::Pong { id })?;
                break;
            }
            WorkerCommand::Segment {
                id,
                backend,
                model_path,
                input_path,
                output_path,
                scaled_width,
                scaled_height,
                pad_x,
                pad_y,
                output_size,
            } => {
                let result = (|| {
                    let rgb = fs::read(&input_path)
                        .map_err(|error| format!("无法读取图片数据: {error}"))?;
                    let cache_key = format!("{backend}\0{model_path}");
                    let session_reused = sessions.contains_key(&cache_key);
                    let load_started = Instant::now();
                    if !session_reused {
                        sessions.insert(
                            cache_key.clone(),
                            specialized_segmentation::SpecializedSession::load(
                                &backend,
                                &model_path,
                            )?,
                        );
                    }
                    let session_load_ms = load_started.elapsed().as_millis();
                    let inference_started = Instant::now();
                    let mask = sessions
                        .get_mut(&cache_key)
                        .ok_or_else(|| "专用分割 Session 不可用".to_string())?
                        .segment(&rgb, scaled_width, scaled_height, pad_x, pad_y, output_size)?;
                    if mask.len() != output_size * output_size {
                        return Err("专用分割蒙版尺寸异常".to_string());
                    }
                    let inference_ms = inference_started.elapsed().as_millis();
                    fs::write(output_path, mask)
                        .map_err(|error| format!("无法保存蒙版: {error}"))?;
                    Ok((session_load_ms, inference_ms, session_reused))
                })();
                let response = match result {
                    Ok((session_load_ms, inference_ms, session_reused)) => WorkerResponse::Result {
                        id,
                        session_load_ms,
                        inference_ms,
                        session_reused,
                    },
                    Err(error) => WorkerResponse::Error { id, error },
                };
                write_response(&mut writer, &response)?;
            }
        }
    }
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 10 {
        return Err("专用分割参数无效".to_string());
    }
    let rgb = fs::read(&args[3]).map_err(|error| format!("无法读取图片数据: {error}"))?;
    let scaled_width = number(&args[5], "缩放宽度")?;
    let scaled_height = number(&args[6], "缩放高度")?;
    let pad_x = number(&args[7], "横向留白")?;
    let pad_y = number(&args[8], "纵向留白")?;
    let output_size = number(&args[9], "输出尺寸")?;
    let mask = match args[1].as_str() {
        "yolo26-seg" => specialized_segmentation::segment_yolo(
            &args[2],
            &rgb,
            scaled_width,
            scaled_height,
            pad_x,
            pad_y,
            output_size,
        )?,
        "rmbg-1.4" => specialized_segmentation::segment_rmbg(&args[2], &rgb, output_size)?,
        _ => return Err("不支持的专用分割模型".to_string()),
    };
    if mask.len() != output_size * output_size {
        return Err("专用分割蒙版尺寸异常".to_string());
    }
    fs::write(&args[4], mask).map_err(|error| format!("无法保存蒙版: {error}"))
}

fn main() -> ExitCode {
    let result = if env::args().nth(1).as_deref() == Some("--server") {
        run_server(io::stdin().lock(), io::stdout().lock())
    } else {
        run()
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn server_supports_ping_and_clean_shutdown() {
        let input = concat!(
            "{\"op\":\"ping\",\"id\":\"ready\"}\n",
            "{\"op\":\"shutdown\",\"id\":\"stop\"}\n"
        );
        let mut output = Vec::new();
        run_server(Cursor::new(input), &mut output).unwrap();
        let responses = String::from_utf8(output).unwrap();
        assert!(responses.contains("\"kind\":\"pong\",\"id\":\"ready\""));
        assert!(responses.contains("\"kind\":\"pong\",\"id\":\"stop\""));
    }
}
