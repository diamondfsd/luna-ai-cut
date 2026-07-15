use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use std::panic::{catch_unwind, AssertUnwindSafe};

#[napi(object)]
pub struct SamSegmentationResult {
    pub width: u32,
    pub height: u32,
    pub bytes: Buffer,
}

pub fn segment(
    vision_encoder_path: String,
    prompt_decoder_path: String,
    rgb: Buffer,
    source_width: u32,
    source_height: u32,
    point_x: f64,
    point_y: f64,
) -> Result<SamSegmentationResult, String> {
    crate::log!("SAM start: source={}x{}", source_width, source_height);
    let result = catch_unwind(AssertUnwindSafe(|| {
        crate::sam_core::segment(
            vision_encoder_path,
            prompt_decoder_path,
            rgb.as_ref(),
            source_width,
            source_height,
            point_x,
            point_y,
        )
    }))
    .unwrap_or_else(|panic| {
        let message = panic
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| panic.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "未知原生错误".to_string());
        crate::log_error!("SAM panic intercepted: {}", message);
        Err(format!("SAM 识别出现内部错误: {message}"))
    })?;
    crate::log!("SAM completed");
    Ok(SamSegmentationResult {
        width: result.width,
        height: result.height,
        bytes: result.bytes.into(),
    })
}
