use std::ptr;

use windows::core::{Interface, GUID, HSTRING};
use windows::Win32::Graphics::Direct3D12::ID3D12Resource;
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_FORMAT_NV12,
    DXGI_FORMAT_P010,
};
use windows::Win32::Media::MediaFoundation::{
    IMFAttributes, IMFD3D12SynchronizationObjectCommands, IMFDXGIBuffer, IMFDXGIDeviceManager,
    IMFMediaType, IMFSample, IMFSourceReader, MFCreateAttributes, MFCreateMediaType,
    MFCreateSourceReaderFromURL, MFMediaType_Video, MFVideoFormat_HEVC, MFVideoFormat_NV12,
    MFVideoFormat_P010, MF_D3D12_SYNCHRONIZATION_OBJECT, MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE,
    MF_MT_SUBTYPE, MF_MT_VIDEO_PROFILE, MF_MT_VIDEO_ROTATION,
    MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED,
    MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READERF_ERROR,
    MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED, MF_SOURCE_READERF_STREAMTICK,
    MF_SOURCE_READER_ALL_STREAMS, MF_SOURCE_READER_D3D_MANAGER,
    MF_SOURCE_READER_FIRST_VIDEO_STREAM,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;

const TICKS_PER_SECOND: f64 = 10_000_000.0;
const MAX_SEQUENTIAL_DECODE_TICKS: i64 = 5_000_000;

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

/// A frame owned by Media Foundation and backed by a D3D12 resource.
pub(crate) enum DecodedSurface {
    D3d12 {
        resource: ID3D12Resource,
        synchronization: IMFD3D12SynchronizationObjectCommands,
    },
}

impl DecodedSurface {
    pub(crate) fn transport_label(&self) -> &'static str {
        match self {
            Self::D3d12 { .. } => "d3d12-resource",
        }
    }

    pub(crate) fn resource(&self) -> &ID3D12Resource {
        match self {
            Self::D3d12 { resource, .. } => resource,
        }
    }

    pub(crate) fn synchronization(&self) -> &IMFD3D12SynchronizationObjectCommands {
        match self {
            Self::D3d12 {
                synchronization, ..
            } => synchronization,
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

/// One decoded video frame. The sample is retained for the lifetime of the
/// resource because some hardware decoders recycle surfaces with the sample.
pub(crate) struct DecodedFrame {
    #[allow(dead_code)]
    sample: IMFSample,
    pub(crate) surface: DecodedSurface,
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
    /// Open a hardware-backed Source Reader using the D3D12 MF manager.
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
        set_output_type(&reader, output_subtype, &native_type).or_else(|first_error| {
            if output_subtype == MFVideoFormat_NV12 {
                return Err(first_error);
            }
            set_output_type(&reader, MFVideoFormat_NV12, &native_type).map_err(|fallback_error| {
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

    /// Read the first frame at or after the requested timestamp. Sequential
    /// reads are kept in place; a seek is used for backwards or distant reads.
    pub(crate) fn read_frame_at(
        &mut self,
        timestamp_100ns: i64,
    ) -> Result<Option<DecodedFrame>, String> {
        let target = timestamp_100ns.max(0);
        let should_seek = self
            .last_timestamp_100ns
            .map_or(target > MAX_SEQUENTIAL_DECODE_TICKS, |last| {
                target < last || target - last > MAX_SEQUENTIAL_DECODE_TICKS
            });
        if should_seek {
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
        let timestamp = seconds_to_timestamp(seconds);
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

fn seconds_to_timestamp(seconds: f64) -> i64 {
    // Media timestamps are quantized to the source time base. Flooring
    // avoids asking for one tick past a frame whose exact timestamp is below
    // the requested presentation time.
    (seconds.max(0.0) * TICKS_PER_SECOND).floor() as i64
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
        }
        Ok(())
    })()
    .map_err(|error| format!("无法启用显卡视频解码: {error}"))?;
    Ok(attributes)
}

fn set_output_type(
    reader: &IMFSourceReader,
    subtype: GUID,
    native_type: &IMFMediaType,
) -> Result<(), String> {
    let media_type =
        unsafe { MFCreateMediaType() }.map_err(|error| format!("无法创建解码输出格式: {error}"))?;
    (|| -> windows::core::Result<()> {
        unsafe {
            // Preserve allocator, geometry, timing and color metadata selected
            // by the decoder. Some hardware paths reject a bare pixel type.
            native_type.CopyAllItems(&media_type)?;
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
        .map_err(|_| "解码器返回了 CPU 画面，无法保持显卡零拷贝".to_string())?;

    let subresource_index = unsafe { dxgi_buffer.GetSubresourceIndex() }
        .map_err(|error| format!("无法取得解码画面子资源索引: {error}"))?;
    let mut raw_resource = ptr::null_mut();
    unsafe { dxgi_buffer.GetResource(&ID3D12Resource::IID, &mut raw_resource) }
        .map_err(|error| format!("解码器没有返回 D3D12 画面资源: {error}"))?;
    if raw_resource.is_null() {
        return Err("D3D12 解码画面为空".to_string());
    }
    let resource = unsafe { ID3D12Resource::from_raw(raw_resource) };

    let mut raw_sync = ptr::null_mut();
    unsafe {
        dxgi_buffer.GetUnknown(
            &MF_D3D12_SYNCHRONIZATION_OBJECT,
            &IMFD3D12SynchronizationObjectCommands::IID,
            &mut raw_sync,
        )
    }
    .map_err(|error| format!("无法取得 D3D12 解码同步对象: {error}"))?;
    if raw_sync.is_null() {
        return Err("D3D12 解码同步对象为空".to_string());
    }
    let synchronization = unsafe { IMFD3D12SynchronizationObjectCommands::from_raw(raw_sync) };
    let desc = unsafe { resource.GetDesc() };
    Ok(DecodedFrame {
        sample,
        surface: DecodedSurface::D3d12 {
            resource,
            synchronization,
        },
        timestamp_100ns,
        subresource_index,
        array_slice: subresource_index / u32::from(desc.MipLevels).max(1),
        width: desc.Width as u32,
        height: desc.Height as u32,
        format: SurfaceFormat::from(desc.Format),
    })
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

#[cfg(test)]
mod tests {
    use super::seconds_to_timestamp;

    #[test]
    fn seconds_to_timestamp_does_not_skip_quantized_last_frame() {
        assert_eq!(seconds_to_timestamp(89.0 / 30.0), 29_666_666);
        assert_eq!(seconds_to_timestamp(-1.0), 0);
    }
}
