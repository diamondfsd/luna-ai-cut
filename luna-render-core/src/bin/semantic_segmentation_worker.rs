use std::env;
use std::fs;
use std::process::ExitCode;

#[path = "../segmentation.rs"]
mod segmentation;
#[path = "../segmentation_refinement.rs"]
mod segmentation_refinement;

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 8 && args.len() != 11 {
        return Err("语义分割参数无效".to_string());
    }
    let rgb = fs::read(&args[2]).map_err(|error| format!("无法读取图片数据: {error}"))?;
    let target_class_id = if args[6] == "-" {
        None
    } else {
        Some(args[6].parse().map_err(|_| "目标类别无效".to_string())?)
    };
    let guide = if args.len() == 11 {
        Some(segmentation_refinement::RefinementGuide {
            rgb: fs::read(&args[8]).map_err(|error| format!("无法读取蒙版引导图: {error}"))?,
            width: args[9]
                .parse()
                .map_err(|_| "蒙版引导图宽度无效".to_string())?,
            height: args[10]
                .parse()
                .map_err(|_| "蒙版引导图高度无效".to_string())?,
        })
    } else {
        None
    };
    let result = segmentation::segment_with_guide(
        args[1].clone(),
        rgb,
        args[4].parse().map_err(|_| "点击位置无效".to_string())?,
        args[5].parse().map_err(|_| "点击位置无效".to_string())?,
        target_class_id,
        Some(args[7].parse().map_err(|_| "输入尺寸无效".to_string())?),
        guide,
    )?;
    let expected = result.width as usize * result.height as usize;
    if result.bytes.len() != expected {
        return Err("语义分割蒙版尺寸异常".to_string());
    }
    let mut output = Vec::with_capacity(12 + expected);
    output.extend_from_slice(&result.width.to_le_bytes());
    output.extend_from_slice(&result.height.to_le_bytes());
    output.extend_from_slice(&result.class_id.to_le_bytes());
    output.extend_from_slice(result.bytes.as_ref());
    fs::write(&args[3], output).map_err(|error| format!("无法保存蒙版: {error}"))?;
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
