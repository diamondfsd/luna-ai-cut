use serde::{Deserialize, Serialize};
use std::{env, fs, process::ExitCode};

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

fn run_batch(args: &[String]) -> Result<(), String> {
    let manifest_raw =
        fs::read_to_string(&args[2]).map_err(|error| format!("无法读取批量消除任务: {error}"))?;
    let manifest: BatchManifest = serde_json::from_str(&manifest_raw)
        .map_err(|error| format!("批量消除任务格式无效: {error}"))?;
    if manifest.jobs.is_empty() {
        return Err("批量消除任务为空".to_string());
    }
    let mut session = inpaint::InpaintSession::load(&args[1])?;
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
    let metrics = BatchMetrics {
        model_load_ms: session.model_load_ms,
        inference_ms,
        region_count: manifest.jobs.len(),
    };
    let metrics_raw =
        serde_json::to_vec(&metrics).map_err(|error| format!("无法生成消除指标: {error}"))?;
    fs::write(&args[3], metrics_raw).map_err(|error| format!("无法写入消除指标: {error}"))?;
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
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
