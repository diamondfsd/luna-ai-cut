use std::ptr;

use windows::core::{Interface, GUID, HSTRING};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D, D3D11_BIND_DECODER,
    D3D11_BIND_SHADER_RESOURCE, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_FORMAT_NV12,
    DXGI_FORMAT_P010, DXGI_SAMPLE_DESC,
};
use windows::Win32::Media::MediaFoundation::{
    IMF2DBuffer, IMF2DBuffer2, IMFAttributes, IMFDXGIBuffer, IMFDXGIDeviceManager, IMFMediaBuffer,
    IMFMediaType, IMFSample, IMFSourceReader, MF2DBuffer_LockFlags_Read, MFCreateAttributes,
    MFCreateMediaType, MFCreateSourceReaderFromURL, MFMediaType_Video, MFVideoFormat_HEVC,
    MFVideoFormat_NV12, MFVideoFormat_P010, MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE,
    MF_MT_VIDEO_PROFILE, MF_MT_VIDEO_ROTATION, MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS,
    MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED, MF_SOURCE_READERF_ENDOFSTREAM,
    MF_SOURCE_READERF_ERROR, MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED,
    MF_SOURCE_READERF_STREAMTICK, MF_SOURCE_READER_ALL_STREAMS, MF_SOURCE_READER_D3D_MANAGER,
    MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, MF_SOURCE_READER_FIRST_VIDEO_STREAM,
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
    upload_device: Option<ID3D11Device>,
    upload_context: Option<ID3D11DeviceContext>,
    upload_texture: Option<ID3D11Texture2D>,
    upload_buffer: Vec<u8>,
}

impl VideoDecoder {
    pub(crate) fn open(path: &str, device_manager: &IMFDXGIDeviceManager) -> Result<Self, String> {
        Self::open_inner(path, Some(device_manager), None, None)
    }

    pub(crate) fn open_system_memory(
        path: &str,
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
    ) -> Result<Self, String> {
        Self::open_inner(path, None, Some(device), Some(context))
    }

    fn open_inner(
        path: &str,
        device_manager: Option<&IMFDXGIDeviceManager>,
        upload_device: Option<&ID3D11Device>,
        upload_context: Option<&ID3D11DeviceContext>,
    ) -> Result<Self, String> {
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
            upload_device: upload_device.cloned(),
            upload_context: upload_context.cloned(),
            upload_texture: None,
            upload_buffer: Vec::new(),
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
            let frame = self.decoded_surface(sample, timestamp)?;
            self.last_timestamp_100ns = Some(timestamp);
            return Ok(Some(frame));
        }
    }

    fn decoded_surface(
        &mut self,
        sample: IMFSample,
        timestamp_100ns: i64,
    ) -> Result<DecodedFrame, String> {
        if let (Some(device), Some(context)) =
            (self.upload_device.as_ref(), self.upload_context.as_ref())
        {
            return decoded_system_memory_surface(
                sample,
                timestamp_100ns,
                self.info.width,
                self.info.height,
                self.info.output_format,
                device,
                context,
                &mut self.upload_texture,
                &mut self.upload_buffer,
            );
        }
        decoded_surface(sample, timestamp_100ns)
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
    device_manager: Option<&IMFDXGIDeviceManager>,
) -> Result<IMFAttributes, String> {
    let mut attributes = None;
    unsafe { MFCreateAttributes(&mut attributes, 4) }
        .map_err(|error| format!("无法创建视频解码设置: {error}"))?;
    let attributes = attributes.ok_or_else(|| "视频解码设置创建后为空".to_string())?;
    (|| -> windows::core::Result<()> {
        unsafe {
            if let Some(device_manager) = device_manager {
                attributes.SetUnknown(&MF_SOURCE_READER_D3D_MANAGER, device_manager)?;
            }
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


fn decoded_system_memory_surface(
    sample: IMFSample,
    timestamp_100ns: i64,
    width: u32,
    height: u32,
    format: SurfaceFormat,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    reusable_texture: &mut Option<ID3D11Texture2D>,
    reusable_buffer: &mut Vec<u8>,
) -> Result<DecodedFrame, String> {
    let buffer = unsafe { sample.GetBufferByIndex(0) }
        .map_err(|error| format!("failed to get system-memory video buffer: {error}"))?;
    if buffer.cast::<IMFDXGIBuffer>().is_ok() {
        return Err("system-memory decoder returned a GPU surface".to_string());
    }
    let row_pitch = copy_system_memory_buffer(
        &buffer,
        width,
        height,
        format,
        reusable_buffer,
    )?;
    let texture = upload_system_memory_frame(
        device,
        context,
        reusable_texture,
        width,
        height,
        format,
        reusable_buffer,
        row_pitch,
    )?;
    Ok(DecodedFrame {
        sample,
        texture,
        timestamp_100ns,
        subresource_index: 0,
        array_slice: 0,
        width,
        height,
        format,
    })
}

fn copy_system_memory_buffer(
    buffer: &IMFMediaBuffer,
    width: u32,
    height: u32,
    format: SurfaceFormat,
    reusable_buffer: &mut Vec<u8>,
) -> Result<u32, String> {
    let bytes_per_row = match format {
        SurfaceFormat::Nv12 => width as usize,
        SurfaceFormat::P010 => width as usize * 2,
        other => {
            return Err(format!(
                "unsupported system-memory decoder format: {}",
                other.label()
            ))
        }
    };
    let row_count = height as usize + height as usize / 2;
    let data_len = bytes_per_row
        .checked_mul(row_count)
        .ok_or_else(|| "system-memory video frame is too large".to_string())?;
    reusable_buffer.resize(data_len, 0);

    if let Ok(buffer_2d) = buffer.cast::<IMF2DBuffer2>() {
        let mut scanline0 = ptr::null_mut();
        let mut pitch = 0;
        let mut _buffer_start = ptr::null_mut();
        let mut _buffer_length = 0;
        unsafe {
            buffer_2d
                .Lock2DSize(
                    MF2DBuffer_LockFlags_Read,
                    &mut scanline0,
                    &mut pitch,
                    &mut _buffer_start,
                    &mut _buffer_length,
                )
                .map_err(|error| format!("failed to lock system-memory video frame: {error}"))?;
        }
        let copy_result = copy_pitched_rows(
            scanline0,
            pitch,
            row_count,
            bytes_per_row,
            reusable_buffer,
        );
        let unlock_result = unsafe { buffer_2d.Unlock2D() };
        copy_result?;
        unlock_result
            .map_err(|error| format!("failed to unlock system-memory video frame: {error}"))?;
        return Ok(bytes_per_row as u32);
    }

    if let Ok(buffer_2d) = buffer.cast::<IMF2DBuffer>() {
        let mut scanline0 = ptr::null_mut();
        let mut pitch = 0;
        unsafe { buffer_2d.Lock2D(&mut scanline0, &mut pitch) }
            .map_err(|error| format!("failed to lock system-memory video frame: {error}"))?;
        let copy_result = copy_pitched_rows(
            scanline0,
            pitch,
            row_count,
            bytes_per_row,
            reusable_buffer,
        );
        let unlock_result = unsafe { buffer_2d.Unlock2D() };
        copy_result?;
        unlock_result
            .map_err(|error| format!("failed to unlock system-memory video frame: {error}"))?;
        return Ok(bytes_per_row as u32);
    }

    let mut raw = ptr::null_mut();
    let mut current_length: u32 = 0;
    unsafe {
        buffer
            .Lock(&mut raw, None, Some((&mut current_length) as *mut u32))
            .map_err(|error| format!("failed to lock system-memory video frame: {error}"))?;
    }
    let copy_result = if !raw.is_null() && current_length as usize >= data_len {
        unsafe { ptr::copy_nonoverlapping(raw, reusable_buffer.as_mut_ptr(), data_len) };
        Ok(())
    } else {
        Err(format!(
            "system-memory video frame is too small: {} < {}",
            current_length, data_len
        ))
    };
    let unlock_result = unsafe { buffer.Unlock() };
    copy_result?;
    unlock_result
        .map_err(|error| format!("failed to unlock system-memory video frame: {error}"))?;
    Ok(bytes_per_row as u32)
}

fn copy_pitched_rows(
    scanline0: *mut u8,
    pitch: i32,
    row_count: usize,
    bytes_per_row: usize,
    destination: &mut [u8],
) -> Result<(), String> {
    if scanline0.is_null() || (pitch.unsigned_abs() as usize) < bytes_per_row {
        return Err("system-memory video frame has an invalid row pitch".to_string());
    }
    for row in 0..row_count {
        let source = unsafe { scanline0.offset(pitch as isize * row as isize) };
        let destination_row = &mut destination[row * bytes_per_row..(row + 1) * bytes_per_row];
        unsafe { ptr::copy_nonoverlapping(source, destination_row.as_mut_ptr(), bytes_per_row) };
    }
    Ok(())
}

fn upload_system_memory_frame(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    reusable_texture: &mut Option<ID3D11Texture2D>,
    width: u32,
    height: u32,
    format: SurfaceFormat,
    data: &[u8],
    row_pitch: u32,
) -> Result<ID3D11Texture2D, String> {
    let dxgi_format = match format {
        SurfaceFormat::Nv12 => DXGI_FORMAT_NV12,
        SurfaceFormat::P010 => DXGI_FORMAT_P010,
        other => {
            return Err(format!(
                "unsupported system-memory upload format: {}",
                other.label()
            ))
        }
    };
    let texture = reusable_texture.take().filter(|texture| {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { texture.GetDesc(&mut desc) };
        desc.Width == width && desc.Height == height && desc.Format == dxgi_format
    });
    let texture = if let Some(texture) = texture {
        texture
    } else {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: dxgi_format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            // VideoProcessorInputView requires the decoder bind flag even though
            // this texture is populated by UpdateSubresource rather than a decoder.
            BindFlags: (D3D11_BIND_DECODER.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut texture = None;
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture)) }
            .map_err(|error| format!("failed to create system-memory upload texture: {error}"))?;
        texture.ok_or_else(|| "system-memory upload texture was empty".to_string())?
    };
    let resource = texture
        .cast::<ID3D11Resource>()
        .map_err(|error| format!("failed to access upload texture resource: {error}"))?;
    unsafe {
        context.UpdateSubresource(
            &resource,
            0,
            None,
            data.as_ptr().cast(),
            row_pitch,
            data.len() as u32,
        );
    }
    *reusable_texture = Some(texture.clone());
    Ok(texture)
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
