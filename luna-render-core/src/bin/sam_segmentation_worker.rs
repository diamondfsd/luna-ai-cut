use std::env;
use std::fs;
use std::process::ExitCode;

#[path = "../sam_core.rs"]
mod sam_core;

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 9 {
        return Err("SAM 参数无效".to_string());
    }
    let rgb = fs::read(&args[3]).map_err(|error| format!("无法读取图片数据: {error}"))?;
    let result = sam_core::segment(
        args[1].clone(),
        args[2].clone(),
        &rgb,
        args[5].parse().map_err(|_| "图片宽度无效".to_string())?,
        args[6].parse().map_err(|_| "图片高度无效".to_string())?,
        args[7].parse().map_err(|_| "点击位置无效".to_string())?,
        args[8].parse().map_err(|_| "点击位置无效".to_string())?,
    )?;
    if result.width != args[5].parse::<u32>().unwrap_or_default()
        || result.height != args[6].parse::<u32>().unwrap_or_default()
    {
        return Err("SAM 蒙版尺寸异常".to_string());
    }
    fs::write(&args[4], result.bytes).map_err(|error| format!("无法保存蒙版: {error}"))?;
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
