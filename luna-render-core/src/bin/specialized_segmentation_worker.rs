use std::env;
use std::fs;
use std::process::ExitCode;

#[path = "../specialized_segmentation.rs"]
mod specialized_segmentation;

fn number(value: &str, label: &str) -> Result<usize, String> {
    value.parse().map_err(|_| format!("{label}无效"))
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
        "birefnet-general-lite" => {
            specialized_segmentation::segment_birefnet(&args[2], &rgb, output_size)?
        }
        _ => return Err("不支持的专用分割模型".to_string()),
    };
    if mask.len() != output_size * output_size {
        return Err("专用分割蒙版尺寸异常".to_string());
    }
    fs::write(&args[4], mask).map_err(|error| format!("无法保存蒙版: {error}"))
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
