use std::ptr;

use windows::core::{Interface, GUID, HSTRING};
use windows::Win32::Graphics::Direct3D11::{ID3D11Resource, ID3D11Texture2D, D3D11_TEXTURE2D_DESC};
use windows::Win32::Graphics::Direct3D11on12::ID3D11On12Device2;
use windows::Win32::Graphics::Direct3D12::{ID3D12CommandQueue, ID3D12Resource};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_FORMAT_NV12,
    DXGI_FORMAT_P010,
};
use windows::Win32::Media::MediaFoundation::{
    IMFAttributes, IMFDXGIBuffer, IMFDXGIDeviceManager, IMFMediaType, IMFSample, IMFSourceReader,
    MFCreateAttributes, MFCreateMediaType, MFCreateSourceReaderFromURL, MFMediaType_Video,
    MFVideoFormat_HEVC, MFVideoFormat_NV12, MFVideoFormat_P010, MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE,
    MF_MT_SUBTYPE, MF_MT_VIDEO_PROFILE, MF_MT_VIDEO_ROTATION,
    MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED,
    MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READERF_ERROR,
    MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED, MF_SOURCE_READERF_STREAMTICK,
    MF_SOURCE_READER_ALL_STREAMS, MF_SOURCE_READER_D3D_MANAGER,
    MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, MF_SOURCE_READER_FIRST_VIDEO_STREAM,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;

const TICKS_PER_SECOND: f64 = 10_000_000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SurfaceFormat {
    Nv12,
    P010,
    Bgra8,
    Other(i32),
}

impl SurfaceFormat {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Nv12 => "NV12",
            Self::P010 => "P010",
            Self::Bgra8 => "BGRA8",
            Self::Other(_) => "unsupported",
        }
    }
}

impl From<DXGI_FORMAT> for SurfaceFormat {
    fn from(value: DXGI_FORMAT) -> Self {
        match value {
            DXGI_FORMAT_NV12 => Self::Nv12,
            DXGI_FORMAT_P010 => Self::P010,
            DXGI_FORMAT_B8G8R8A8_UNORM | DXGI_FORMAT_B8G8R8A8_UNORM_SRGB => Self::Bgra8,
            other => Self::Other(other.0),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct DecoderInfo {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) rotation_degrees: u32,
    pub(crate) output_format: SurfaceFormat,
}

/// 一帧由 Media Foundation 持有的 Direct3D 视频表面。
///
/// `sample` 必须与纹理一起存活；部分硬件解码器会在 sample 释放后立即复用表面。
pub(crate) struct DecodedFrame {
    #[allow(dead_code)]
    sample: IMFSample,
    pub(crate) texture: ID3D11Texture2D,
    pub(crate) timestamp_100ns: i64,
    pub(crate) subresource_index: u32,
    pub(crate) array_slice: u32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) format: SurfaceFormat,
}

pub(crate) struct VideoDecoder {
    reader: IMFSourceReader,
    info: DecoderInfo,
    last_timestamp_100ns: Option<i64>,
    ended: bool,
}

impl VideoDecoder {
    pub(crate) fn open(path: &str, device_manager: &IMFDXGIDeviceManager) -> Result<Self, String> {
        let attributes = create_reader_attributes(device_manager)?;
        let source = HSTRING::from(path);
        let reader = unsafe { MFCreateSourceReaderFromURL(&source, &attributes) }
            .map_err(|error| format!("无法打开视频: {error}"))?;
        let video_stream = stream_index(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0);
        unsafe { reader.SetStreamSelection(stream_index(MF_SOURCE_READER_ALL_STREAMS.0), false) }
            .map_err(|error| format!("无法关闭无关媒体轨道: {error}"))?;
        unsafe { reader.SetStreamSelection(video_stream, true) }
            .map_err(|error| format!("无法选择视频轨道: {error}"))?;

        let native_type = unsafe { reader.GetNativeMediaType(video_stream, 0) }
            .map_err(|error| format!("无法读取视频格式: {error}"))?;
        let output_subtype = preferred_output_subtype(&native_type);
        set_output_type(&reader, output_subtype).or_else(|first_error| {
            if output_subtype == MFVideoFormat_NV12 {
                return Err(first_error);
            }
            set_output_type(&reader, MFVideoFormat_NV12).map_err(|fallback_error| {
                format!("{first_error}; NV12 回退也不可用: {fallback_error}")
            })
        })?;

        let current_type = unsafe { reader.GetCurrentMediaType(video_stream) }
            .map_err(|error| format!("无法确认解码输出格式: {error}"))?;
        let (width, height) = media_dimensions(&current_type)?;
        let subtype = unsafe { current_type.GetGUID(&MF_MT_SUBTYPE) }
            .map_err(|error| format!("解码输出没有像素格式: {error}"))?;
        let output_format = media_subtype_to_surface_format(subtype);
        let rotation_degrees = read_rotation(&native_type, &current_type);

        Ok(Self {
            reader,
            info: DecoderInfo {
                width,
                height,
                rotation_degrees,
                output_format,
            },
            last_timestamp_100ns: None,
            ended: false,
        })
    }

    pub(crate) fn info(&self) -> &DecoderInfo {
        &self.info
    }

    /// 读取目标时间处或其后的第一帧。向后读取时使用 Source Reader seek，
    /// 向前播放时保持顺序解码，避免每帧重新定位到关键帧。
    pub(crate) fn read_frame_at(
        &mut self,
        timestamp_100ns: i64,
    ) -> Result<Option<DecodedFrame>, String> {
        let target = timestamp_100ns.max(0);
        if self.last_timestamp_100ns.is_some_and(|last| target < last) {
            self.seek(target)?;
        }

        loop {
            let Some(frame) = self.read_next()? else {
                return Ok(None);
            };
            if frame.timestamp_100ns >= target {
                return Ok(Some(frame));
            }
        }
    }

    #[allow(dead_code)]
    pub(crate) fn read_frame_at_seconds(
        &mut self,
        seconds: f64,
    ) -> Result<Option<DecodedFrame>, String> {
        let timestamp = (seconds.max(0.0) * TICKS_PER_SECOND).round() as i64;
        self.read_frame_at(timestamp)
    }

    fn seek(&mut self, timestamp_100ns: i64) -> Result<(), String> {
        let position = PROPVARIANT::from(timestamp_100ns.max(0));
        unsafe { self.reader.SetCurrentPosition(&GUID::zeroed(), &position) }
            .map_err(|error| format!("无法定位视频时间: {error}"))?;
        self.last_timestamp_100ns = None;
        self.ended = false;
        Ok(())
    }

    fn read_next(&mut self) -> Result<Option<DecodedFrame>, String> {
        if self.ended {
            return Ok(None);
        }

        let stream = stream_index(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0);
        loop {
            let mut actual_stream = 0;
            let mut flags = 0;
            let mut timestamp = 0;
            let mut sample = None;
            unsafe {
                self.reader.ReadSample(
                    stream,
                    0,
                    Some(&mut actual_stream),
                    Some(&mut flags),
                    Some(&mut timestamp),
                    Some(&mut sample),
                )
            }
            .map_err(|error| format!("视频解码失败: {error}"))?;

            if flag_is_set(flags, MF_SOURCE_READERF_ERROR.0) {
                return Err("系统视频解码器报告失败".to_string());
            }
            if flag_is_set(flags, MF_SOURCE_READERF_ENDOFSTREAM.0) {
                self.ended = true;
                return Ok(None);
            }
            if flag_is_set(flags, MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED.0)
                || flag_is_set(flags, MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED.0)
            {
                self.refresh_media_info()?;
            }
            if sample.is_none() && flag_is_set(flags, MF_SOURCE_READERF_STREAMTICK.0) {
                continue;
            }
            let Some(sample) = sample else {
                continue;
            };
            let frame = decoded_surface(sample, timestamp)?;
            self.last_timestamp_100ns = Some(timestamp);
            return Ok(Some(frame));
        }
    }

    fn refresh_media_info(&mut self) -> Result<(), String> {
        let media_type = unsafe {
            self.reader
                .GetCurrentMediaType(stream_index(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0))
        }
        .map_err(|error| format!("无法更新视频格式: {error}"))?;
        let (width, height) = media_dimensions(&media_type)?;
        let subtype = unsafe { media_type.GetGUID(&MF_MT_SUBTYPE) }
            .map_err(|error| format!("更新后的视频格式无效: {error}"))?;
        self.info.width = width;
        self.info.height = height;
        self.info.output_format = media_subtype_to_surface_format(subtype);
        Ok(())
    }
}

fn create_reader_attributes(
    device_manager: &IMFDXGIDeviceManager,
) -> Result<IMFAttributes, String> {
    let mut attributes = None;
    unsafe { MFCreateAttributes(&mut attributes, 4) }
        .map_err(|error| format!("无法创建视频解码设置: {error}"))?;
    let attributes = attributes.ok_or_else(|| "视频解码设置创建后为空".to_string())?;
    (|| -> windows::core::Result<()> {
        unsafe {
            attributes.SetUnknown(&MF_SOURCE_READER_D3D_MANAGER, device_manager)?;
            attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)?;
            attributes.SetUINT32(&MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, 1)?;
        }
        Ok(())
    })()
    .map_err(|error| format!("无法启用显卡视频解码: {error}"))?;
    Ok(attributes)
}

fn set_output_type(reader: &IMFSourceReader, subtype: GUID) -> Result<(), String> {
    let media_type =
        unsafe { MFCreateMediaType() }.map_err(|error| format!("无法创建解码输出格式: {error}"))?;
    (|| -> windows::core::Result<()> {
        unsafe {
            media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            media_type.SetGUID(&MF_MT_SUBTYPE, &subtype)?;
            reader.SetCurrentMediaType(
                stream_index(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0),
                None,
                &media_type,
            )?;
        }
        Ok(())
    })()
    .map_err(|error| format!("系统不支持请求的显卡解码格式: {error}"))
}

fn preferred_output_subtype(native_type: &IMFMediaType) -> GUID {
    let subtype = unsafe { native_type.GetGUID(&MF_MT_SUBTYPE) }.ok();
    let profile = unsafe { native_type.GetUINT32(&MF_MT_VIDEO_PROFILE) }.ok();
    if subtype == Some(MFVideoFormat_HEVC) && profile == Some(2) {
        MFVideoFormat_P010
    } else {
        MFVideoFormat_NV12
    }
}

fn media_dimensions(media_type: &IMFMediaType) -> Result<(u32, u32), String> {
    let packed = unsafe { media_type.GetUINT64(&MF_MT_FRAME_SIZE) }
        .map_err(|error| format!("视频尺寸不可用: {error}"))?;
    let width = (packed >> 32) as u32;
    let height = packed as u32;
    if width == 0 || height == 0 {
        return Err("视频尺寸无效".to_string());
    }
    Ok((width, height))
}

fn read_rotation(native_type: &IMFMediaType, current_type: &IMFMediaType) -> u32 {
    let value = unsafe { native_type.GetUINT32(&MF_MT_VIDEO_ROTATION) }
        .or_else(|_| unsafe { current_type.GetUINT32(&MF_MT_VIDEO_ROTATION) })
        .unwrap_or(0);
    match value % 360 {
        90 => 90,
        180 => 180,
        270 => 270,
        _ => 0,
    }
}

fn decoded_surface(sample: IMFSample, timestamp_100ns: i64) -> Result<DecodedFrame, String> {
    let buffer_count = unsafe { sample.GetBufferCount() }
        .map_err(|error| format!("无法读取解码画面缓冲区: {error}"))?;
    if buffer_count == 0 {
        return Err("解码画面没有可用缓冲区".to_string());
    }
    let buffer = unsafe { sample.GetBufferByIndex(0) }
        .map_err(|error| format!("无法取得解码画面缓冲区: {error}"))?;
    let dxgi_buffer = buffer
        .cast::<IMFDXGIBuffer>()
        .map_err(|_| "解码器返回了内存画面，未进入显卡表面路径".to_string())?;

    let mut raw_texture = ptr::null_mut();
    unsafe { dxgi_buffer.GetResource(&ID3D11Texture2D::IID, &mut raw_texture) }
        .map_err(|error| format!("无法取得 Direct3D 视频表面: {error}"))?;
    if raw_texture.is_null() {
        return Err("Direct3D 视频表面为空".to_string());
    }
    let texture = unsafe { ID3D11Texture2D::from_raw(raw_texture) };
    let subresource_index = unsafe { dxgi_buffer.GetSubresourceIndex() }
        .map_err(|error| format!("无法取得视频表面层索引: {error}"))?;
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };

    Ok(DecodedFrame {
        sample,
        texture,
        timestamp_100ns,
        subresource_index,
        array_slice: subresource_index / desc.MipLevels.max(1),
        width: desc.Width,
        height: desc.Height,
        format: SurfaceFormat::from(desc.Format),
    })
}

/// 验证解码表面确实属于当前 D3D11On12 设备，并能取得同一 wgpu 队列可用的
/// D3D12 资源。这里只做所有权往返，不向队列提交工作，因此无需附带 fence。
pub(crate) fn validate_d3d12_interop(
    frame: &DecodedFrame,
    d3d11on12: &ID3D11On12Device2,
    queue: &ID3D12CommandQueue,
) -> Result<(), String> {
    if !matches!(frame.format, SurfaceFormat::Nv12 | SurfaceFormat::P010) {
        return Err(format!(
            "显卡解码输出格式不受支持: {} ({:?})",
            frame.format.label(),
            frame.format,
        ));
    }
    let resource11 = frame
        .texture
        .cast::<ID3D11Resource>()
        .map_err(|error| format!("无法取得 Direct3D 视频资源: {error}"))?;
    let resource12: ID3D12Resource =
        unsafe { d3d11on12.UnwrapUnderlyingResource(&resource11, queue) }
            .map_err(|error| format!("无法共享显卡解码表面: {error}"))?;

    let return_result =
        unsafe { d3d11on12.ReturnUnderlyingResource(&resource11, 0, ptr::null(), ptr::null()) };
    drop(resource12);
    return_result.map_err(|error| format!("无法归还显卡解码表面: {error}"))
}

fn media_subtype_to_surface_format(subtype: GUID) -> SurfaceFormat {
    if subtype == MFVideoFormat_NV12 {
        SurfaceFormat::Nv12
    } else if subtype == MFVideoFormat_P010 {
        SurfaceFormat::P010
    } else {
        SurfaceFormat::Other(-1)
    }
}

fn stream_index(value: i32) -> u32 {
    value as u32
}

fn flag_is_set(flags: u32, flag: i32) -> bool {
    flags & flag as u32 != 0
}
