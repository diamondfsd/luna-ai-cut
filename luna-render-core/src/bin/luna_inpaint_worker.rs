use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{self, BufRead, Write},
    process::ExitCode,
};

#[path = "../inpaint.rs"]
mod inpaint;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchJob {
    input_path: String,
    mask_path: String,
    output_path: String,
}

#[derive(Deserialize)]
struct BatchManifest {
    jobs: Vec<BatchJob>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchMetrics {
    model_load_ms: u128,
    inference_ms: u128,
    region_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServeRequest {
    request_id: String,
    manifest_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServeResponse<'a> {
    kind: &'a str,
    request_id: Option<&'a str>,
    model_load_ms: Option<u128>,
    inference_ms: Option<u128>,
    region_count: Option<usize>,
    error: Option<String>,
}

fn run_legacy(args: &[String]) -> Result<(), String> {
    let rgb = fs::read(&args[2]).map_err(|error| format!("无法读取消除图片: {error}"))?;
    let mask = fs::read(&args[3]).map_err(|error| format!("无法读取消除选区: {error}"))?;
    let mut session = inpaint::InpaintSession::load(&args[1])?;
    let result = session.run(&rgb, &mask)?;
    fs::write(&args[4], result.rgb).map_err(|error| format!("无法写入消除结果: {error}"))?;
    fs::write(
        &args[5],
        format!(
            "{{\"modelLoadMs\":{},\"inferenceMs\":{},\"regionCount\":1}}",
            session.model_load_ms, result.inference_ms
        ),
    )
    .map_err(|error| format!("无法写入消除指标: {error}"))?;
    Ok(())
}

fn run_manifest(
    session: &mut inpaint::InpaintSession,
    manifest_path: &str,
) -> Result<BatchMetrics, String> {
    let manifest_raw = fs::read_to_string(manifest_path)
        .map_err(|error| format!("无法读取批量消除任务: {error}"))?;
    let manifest: BatchManifest = serde_json::from_str(&manifest_raw)
        .map_err(|error| format!("批量消除任务格式无效: {error}"))?;
    if manifest.jobs.is_empty() {
        return Err("批量消除任务为空".to_string());
    }
    let mut inference_ms = 0;
    for job in &manifest.jobs {
        let rgb =
            fs::read(&job.input_path).map_err(|error| format!("无法读取消除图片: {error}"))?;
        let mask =
            fs::read(&job.mask_path).map_err(|error| format!("无法读取消除选区: {error}"))?;
        let result = session.run(&rgb, &mask)?;
        inference_ms += result.inference_ms;
        fs::write(&job.output_path, result.rgb)
            .map_err(|error| format!("无法写入消除结果: {error}"))?;
    }
    Ok(BatchMetrics {
        model_load_ms: session.model_load_ms,
        inference_ms,
        region_count: manifest.jobs.len(),
    })
}

fn run_batch(args: &[String]) -> Result<(), String> {
    let mut session = inpaint::InpaintSession::load(&args[1])?;
    let metrics = run_manifest(&mut session, &args[2])?;
    let metrics_raw =
        serde_json::to_vec(&metrics).map_err(|error| format!("无法生成消除指标: {error}"))?;
    fs::write(&args[3], metrics_raw).map_err(|error| format!("无法写入消除指标: {error}"))?;
    Ok(())
}

fn write_response(response: &ServeResponse<'_>) -> Result<(), String> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, response)
        .map_err(|error| format!("无法发送消除任务状态: {error}"))?;
    stdout
        .write_all(b"\n")
        .and_then(|_| stdout.flush())
        .map_err(|error| format!("无法发送消除任务状态: {error}"))
}

fn run_server(model_path: &str) -> Result<(), String> {
    let mut session = inpaint::InpaintSession::load(model_path)?;
    write_response(&ServeResponse {
        kind: "ready",
        request_id: None,
        model_load_ms: Some(session.model_load_ms),
        inference_ms: None,
        region_count: None,
        error: None,
    })?;

    for line in io::stdin().lock().lines() {
        let line = line.map_err(|error| format!("无法接收消除任务: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let request: ServeRequest = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                write_response(&ServeResponse {
                    kind: "result",
                    request_id: None,
                    model_load_ms: None,
                    inference_ms: None,
                    region_count: None,
                    error: Some(format!("消除任务格式无效: {error}")),
                })?;
                continue;
            }
        };
        match run_manifest(&mut session, &request.manifest_path) {
            Ok(metrics) => write_response(&ServeResponse {
                kind: "result",
                request_id: Some(&request.request_id),
                model_load_ms: Some(metrics.model_load_ms),
                inference_ms: Some(metrics.inference_ms),
                region_count: Some(metrics.region_count),
                error: None,
            })?,
            Err(error) => write_response(&ServeResponse {
                kind: "result",
                request_id: Some(&request.request_id),
                model_load_ms: None,
                inference_ms: None,
                region_count: None,
                error: Some(error),
            })?,
        }
    }
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() == 3 && args[1] == "--serve" {
        return run_server(&args[2]);
    }
    match args.len() {
        4 => run_batch(&args),
        6 => run_legacy(&args),
        _ => Err("消除任务参数无效".to_string()),
    }
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
