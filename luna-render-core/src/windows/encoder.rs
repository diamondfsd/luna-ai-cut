use std::path::{Path, PathBuf};

use windows::core::{Interface, GUID, HSTRING};
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::Win32::Media::MediaFoundation::{
    IMFAttributes, IMFDXGIDeviceManager, IMFMediaType, IMFSinkWriter, IMFSinkWriterEx,
    IMFTransform, MFCreateAttributes, MFCreateDXGISurfaceBuffer, MFCreateMediaType, MFCreateSample,
    MFCreateSinkWriterFromURL, MFMediaType_Video, MFT_ENUM_HARDWARE_URL_Attribute,
    MFVideoFormat_H264, MFVideoFormat_HEVC, MFVideoFormat_NV12, MFVideoInterlace_Progressive,
    MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE,
    MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS,
    MF_SINK_WRITER_D3D_MANAGER, MF_SINK_WRITER_DISABLE_THROTTLING,
};

// This attribute was added to the Windows 11 25H2 SDK, but is not exposed by
// the windows crate version used here. Keeping the GUID local lets older SDKs
// build while newer Windows versions can reject a software MFT immediately.
const MF_READWRITE_USE_ONLY_HARDWARE_TRANSFORMS: GUID = GUID::from_u128(
    0xf9074427bf8b4f69bbaf524969056fb6,
);

pub(crate) struct VideoEncoder {
    writer: Option<IMFSinkWriter>,
    stream_index: u32,
    output_path: PathBuf,
    frame_duration_100ns: i64,
    hardware_verified: bool,
    finished: bool,
}

impl VideoEncoder {
    pub(crate) fn new(
        output_path: &Path,
        device_manager: &IMFDXGIDeviceManager,
        width: u32,
        height: u32,
        fps: f64,
        bitrate: u64,
        hevc: bool,
    ) -> Result<Self, String> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err("Windows GPU 导出要求画面宽高为偶数".to_string());
        }
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建导出目录: {error}"))?;
        }
        let _ = std::fs::remove_file(output_path);

        let attributes = create_writer_attributes(device_manager)?;
        let url = HSTRING::from(output_path.to_string_lossy().as_ref());
        let writer = unsafe {
            MFCreateSinkWriterFromURL(
                &url,
                None::<&windows::Win32::Media::MediaFoundation::IMFByteStream>,
                &attributes,
            )
        }
        .map_err(|error| format!("无法创建 Windows 视频文件: {error}"))?;

        let frame_rate = fps_ratio(fps);
        let output_type = create_video_type(
            if hevc {
                MFVideoFormat_HEVC
            } else {
                MFVideoFormat_H264
            },
            width,
            height,
            frame_rate,
            Some(bitrate.min(u32::MAX as u64) as u32),
        )?;
        let stream_index = unsafe { writer.AddStream(&output_type) }
            .map_err(|error| format!("无法添加硬件编码视频轨道: {error}"))?;
        let input_type = create_video_type(MFVideoFormat_NV12, width, height, frame_rate, None)?;
        unsafe { writer.SetInputMediaType(stream_index, &input_type, None::<&IMFAttributes>) }
            .map_err(|error| format!("硬件编码器不接受显卡 NV12 画面: {error}"))?;
        unsafe { writer.BeginWriting() }
            .map_err(|error| format!("无法启动 Windows 硬件编码器: {error}"))?;

        Ok(Self {
            writer: Some(writer),
            stream_index,
            output_path: output_path.to_path_buf(),
            frame_duration_100ns: (10_000_000.0 / fps.max(1.0)).round() as i64,
            hardware_verified: false,
            finished: false,
        })
    }

    pub(crate) fn append(&mut self, texture: &ID3D11Texture2D, frame_index: u64) -> Result<(), String> {
        let buffer = unsafe { MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, texture, 0, false) }
            .map_err(|error| format!("无法创建硬件编码画面: {error}"))?;
        let sample =
            unsafe { MFCreateSample() }.map_err(|error| format!("无法创建视频帧: {error}"))?;
        (|| -> windows::core::Result<()> {
            unsafe {
                sample.AddBuffer(&buffer)?;
                sample.SetSampleTime(frame_index as i64 * self.frame_duration_100ns)?;
                sample.SetSampleDuration(self.frame_duration_100ns)?;
            }
            Ok(())
        })()
        .map_err(|error| format!("无法设置视频帧时间: {error}"))?;
        let writer = self
            .writer
            .as_ref()
            .ok_or_else(|| "视频编码器已经关闭".to_string())?;
        unsafe { writer.WriteSample(self.stream_index, &sample) }
            .map_err(|error| format!("Windows 硬件编码失败: {error}"))?;
        if !self.hardware_verified {
            verify_hardware_encoder(writer, self.stream_index)?;
            self.hardware_verified = true;
        }
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<(), String> {
        let writer = self
            .writer
            .take()
            .ok_or_else(|| "视频编码器已经关闭".to_string())?;
        unsafe { writer.Finalize() }
            .map_err(|error| format!("无法完成 Windows 视频文件: {error}"))?;
        drop(writer);
        self.finished = true;
        Ok(())
    }
}

impl Drop for VideoEncoder {
    fn drop(&mut self) {
        self.writer.take();
        if !self.finished {
            let _ = std::fs::remove_file(&self.output_path);
        }
    }
}

fn create_writer_attributes(
    device_manager: &IMFDXGIDeviceManager,
) -> Result<IMFAttributes, String> {
    let mut attributes = None;
    unsafe { MFCreateAttributes(&mut attributes, 4) }
        .map_err(|error| format!("无法创建硬件编码设置: {error}"))?;
    let attributes = attributes.ok_or_else(|| "硬件编码设置创建后为空".to_string())?;
    (|| -> windows::core::Result<()> {
        unsafe {
            attributes.SetUnknown(&MF_SINK_WRITER_D3D_MANAGER, device_manager)?;
            attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)?;
            attributes.SetUINT32(&MF_READWRITE_USE_ONLY_HARDWARE_TRANSFORMS, 1)?;
            attributes.SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1)?;
        }
        Ok(())
    })()
    .map_err(|error| format!("无法启用 Windows 硬件编码: {error}"))?;
    Ok(attributes)
}

fn create_video_type(
    subtype: windows::core::GUID,
    width: u32,
    height: u32,
    frame_rate: (u32, u32),
    bitrate: Option<u32>,
) -> Result<IMFMediaType, String> {
    let media_type =
        unsafe { MFCreateMediaType() }.map_err(|error| format!("无法创建视频格式: {error}"))?;
    (|| -> windows::core::Result<()> {
        unsafe {
            media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            media_type.SetGUID(&MF_MT_SUBTYPE, &subtype)?;
            media_type.SetUINT64(&MF_MT_FRAME_SIZE, pack_ratio(width, height))?;
            media_type.SetUINT64(&MF_MT_FRAME_RATE, pack_ratio(frame_rate.0, frame_rate.1))?;
            media_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_ratio(1, 1))?;
            media_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            if let Some(value) = bitrate {
                media_type.SetUINT32(&MF_MT_AVG_BITRATE, value)?;
            }
        }
        Ok(())
    })()
    .map_err(|error| format!("无法配置视频格式: {error}"))?;
    Ok(media_type)
}

fn verify_hardware_encoder(writer: &IMFSinkWriter, stream_index: u32) -> Result<(), String> {
    let extended = writer
        .cast::<IMFSinkWriterEx>()
        .map_err(|error| format!("无法确认硬件编码器: {error}"))?;
    for transform_index in 0..8 {
        let mut category = windows::core::GUID::zeroed();
        let mut transform = None;
        let result = unsafe {
            extended.GetTransformForStream(
                stream_index,
                transform_index,
                Some(&mut category),
                &mut transform,
            )
        };
        if result.is_err() {
            break;
        }
        let Some(transform) = transform else {
            continue;
        };
        if category != windows::Win32::Media::MediaFoundation::MFT_CATEGORY_VIDEO_ENCODER {
            crate::logging::write(&format!(
                "[Export:WinGPU] encoder-transform index={} category={:?} skipped=non-encoder",
                transform_index, category,
            ));
            continue;
        }
        let hardware_url = transform_has_hardware_url(&transform);
        let transform_clsid = transform_clsid(&transform);
        crate::logging::write(&format!(
            "[Export:WinGPU] encoder-transform index={} category={:?} clsid={:?} hardware_url={}",
            transform_index, category, transform_clsid, hardware_url,
        ));
        if hardware_url {
            return Ok(());
        }
    }
    Err("系统选择的编码器不是显卡硬件编码器".to_string())
}

fn transform_has_hardware_url(transform: &IMFTransform) -> bool {
    let Ok(attributes) = (unsafe { transform.GetAttributes() }) else {
        return false;
    };
    unsafe {
        attributes
            .GetStringLength(&MFT_ENUM_HARDWARE_URL_Attribute)
            .is_ok_and(|length| length > 0)
    }
}

fn transform_clsid(transform: &IMFTransform) -> Option<GUID> {
    let attributes = unsafe { transform.GetAttributes().ok()? };
    unsafe {
        attributes
            .GetGUID(&windows::Win32::Media::MediaFoundation::MFT_TRANSFORM_CLSID_Attribute)
            .ok()
    }
}

fn fps_ratio(fps: f64) -> (u32, u32) {
    let rounded = fps.round();
    if (fps - rounded).abs() < 0.001 {
        (rounded.max(1.0) as u32, 1)
    } else {
        ((fps.max(1.0) * 1000.0).round() as u32, 1000)
    }
}

fn pack_ratio(numerator: u32, denominator: u32) -> u64 {
    ((numerator as u64) << 32) | denominator as u64
}
