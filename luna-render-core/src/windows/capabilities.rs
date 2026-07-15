use std::ptr;

use windows::Win32::Media::MediaFoundation::{
    IMFActivate, MFMediaType_Video, MFTEnumEx, MFVideoFormat_H264, MFVideoFormat_HEVC,
    MFVideoFormat_NV12, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG, MFT_ENUM_FLAG_HARDWARE,
    MFT_ENUM_FLAG_SORTANDFILTER, MFT_REGISTER_TYPE_INFO,
};
use windows::Win32::System::Com::CoTaskMemFree;

#[derive(Debug, Clone, Copy)]
pub(crate) struct EncoderCapabilities {
    pub(crate) h264: bool,
    pub(crate) hevc: bool,
}

impl EncoderCapabilities {
    pub(crate) fn any(self) -> bool {
        self.h264 || self.hevc
    }
}

pub(crate) fn probe_hardware_encoders() -> Result<EncoderCapabilities, String> {
    Ok(EncoderCapabilities {
        h264: has_hardware_encoder(MFVideoFormat_H264)?,
        hevc: has_hardware_encoder(MFVideoFormat_HEVC)?,
    })
}

fn has_hardware_encoder(output_subtype: windows::core::GUID) -> Result<bool, String> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: output_subtype,
    };
    let flags = MFT_ENUM_FLAG(MFT_ENUM_FLAG_HARDWARE.0 | MFT_ENUM_FLAG_SORTANDFILTER.0);
    let mut activates: *mut Option<IMFActivate> = ptr::null_mut();
    let mut count = 0;
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            flags,
            Some(&input),
            Some(&output),
            &mut activates,
            &mut count,
        )
    }
    .map_err(|error| format!("无法查询硬件编码能力: {error}"))?;

    // MFTEnumEx 返回 CoTaskMemAlloc 数组；每个 COM 项和数组本身都由调用方释放。
    if !activates.is_null() {
        unsafe {
            for index in 0..count as usize {
                ptr::drop_in_place(activates.add(index));
            }
            CoTaskMemFree(Some(activates.cast()));
        }
    }
    Ok(count > 0)
}
