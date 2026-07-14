use tract_onnx::prelude::*;

fn print_onnx(path: &str) -> TractResult<()> {
    let mut model = tract_onnx::onnx().model_for_path(path)?;
    let shape: &[usize] = if path.contains("scrfd") {
        &[1, 3, 640, 640]
    } else if path.contains("landmarks") {
        &[1, 3, 192, 192]
    } else if path.contains("yolox") {
        &[1, 3, 416, 416]
    } else {
        &[1, 3, 512, 512]
    };
    model.set_input_fact(0, InferenceFact::dt_shape(f32::datum_type(), shape))?;
    let model = model.into_optimized()?;
    println!("ONNX {path}");
    for (index, outlet) in model.input_outlets()?.iter().enumerate() {
        println!("  input {index}: {:?}", model.outlet_fact(*outlet)?);
    }
    for (index, outlet) in model.output_outlets()?.iter().enumerate() {
        println!("  output {index}: {:?}", model.outlet_fact(*outlet)?);
    }
    Ok(())
}

fn main() -> TractResult<()> {
    print_onnx("models/scrfd-500m-kps.onnx")?;
    print_onnx("models/face-landmarks-106.onnx")?;
    print_onnx("models/face-parsing-resnet18.onnx")?;
    print_onnx("models/person-yolox-nano.onnx")?;
    Ok(())
}
