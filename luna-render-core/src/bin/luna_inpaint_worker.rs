use std::{env, fs, process::ExitCode};

#[path = "../inpaint.rs"]
mod inpaint;

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 6 { return Err("消除任务参数无效".to_string()); }
    let rgb = fs::read(&args[2]).map_err(|error| format!("无法读取消除图片: {error}"))?;
    let mask = fs::read(&args[3]).map_err(|error| format!("无法读取消除选区: {error}"))?;
    let result = inpaint::run(&args[1], &rgb, &mask)?;
    fs::write(&args[4], result.rgb).map_err(|error| format!("无法写入消除结果: {error}"))?;
    fs::write(&args[5], format!("{{\"modelLoadMs\":{},\"inferenceMs\":{}}}", result.model_load_ms, result.inference_ms))
        .map_err(|error| format!("无法写入消除指标: {error}"))?;
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => { eprintln!("{error}"); ExitCode::FAILURE }
    }
}
