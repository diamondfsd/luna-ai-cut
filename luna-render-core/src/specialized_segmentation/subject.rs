use super::*;

pub fn segment_rmbg(model_path: &str, rgb: &[u8], output_size: usize) -> Result<Vec<u8>, String> {
    let mut session = session(model_path)?;
    segment_rmbg_with_session(&mut session, rgb, output_size)
}

pub fn segment_birefnet(
    model_path: &str,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let mut session = session(model_path)?;
    segment_birefnet_with_session(&mut session, rgb, output_size)
}

pub(super) fn segment_birefnet_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let input = preprocess_birefnet(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, SUBJECT_SIZE, SUBJECT_SIZE], input))
        .map_err(|error| format!("创建 BiRefNet 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("BiRefNet 主体识别失败: {error}"))?;
    if outputs.len() != 1 {
        return Err("BiRefNet 输出数量不兼容".to_string());
    }
    let (shape, logits) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 BiRefNet 输出失败: {error}"))?;
    if shape.len() != 4 || shape[0] != 1 || shape[1] != 1 {
        return Err(format!("BiRefNet 输出尺寸不兼容: {shape:?}"));
    }
    birefnet_mask(logits, shape[3] as usize, shape[2] as usize, output_size)
}

pub(super) fn segment_rmbg_with_session(
    session: &mut Session,
    rgb: &[u8],
    output_size: usize,
) -> Result<Vec<u8>, String> {
    let input = preprocess_rmbg14(rgb)?;
    let tensor = Tensor::from_array(([1usize, 3, SUBJECT_SIZE, SUBJECT_SIZE], input))
        .map_err(|error| format!("创建 RMBG 输入失败: {error}"))?;
    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|error| format!("RMBG 主体识别失败: {error}"))?;
    let (_, output) = outputs
        .iter()
        .find(|(_, output)| {
            output.shape().as_ref() == [1, 1, SUBJECT_SIZE as i64, SUBJECT_SIZE as i64]
        })
        .or_else(|| outputs.iter().find(|(_, output)| output.shape().len() == 4))
        .ok_or_else(|| "RMBG 缺少蒙版输出".to_string())?;
    let (shape, values) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取 RMBG 输出失败: {error}"))?;
    if shape.len() != 4 || shape[0] != 1 || shape[1] != 1 {
        return Err(format!("RMBG 输出尺寸不兼容: {shape:?}"));
    }
    normalized_subject_mask(values, shape[3] as usize, shape[2] as usize, output_size)
}
