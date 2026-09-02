use std::ffi::c_void;

#[cfg(luna_ffmpeg_shared)]
use std::ffi::{c_char, CString};
#[cfg(luna_ffmpeg_shared)]
use std::path::Path;
#[cfg(luna_ffmpeg_shared)]
use std::ptr;

use libloading::Library;
#[cfg(luna_ffmpeg_shared)]
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::{ID3D11Device1, ID3D11Texture2D};
use windows::Win32::Graphics::Direct3D12::{ID3D12Device, ID3D12Resource};
#[cfg(luna_ffmpeg_shared)]
use windows::Win32::Graphics::Direct3D12::{
    D3D12_HEAP_FLAG_SHARED, D3D12_HEAP_TYPE_DEFAULT, D3D12_RESOURCE_DESC,
    D3D12_RESOURCE_DIMENSION_TEXTURE2D, D3D12_RESOURCE_FLAGS, D3D12_RESOURCE_STATE_COMMON,
    D3D12_TEXTURE_LAYOUT_UNKNOWN,
};
#[cfg(luna_ffmpeg_shared)]
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT, DXGI_SAMPLE_DESC};

use super::decoder::SurfaceFormat;
use super::device::InteropDevice;

const ERROR_BUFFER_SIZE: usize = 1024;

#[repr(C)]
struct NativeFrame {
    texture: *mut c_void,
    array_slice: u32,
    width: u32,
    height: u32,
    dxgi_format: i32,
    timestamp_100ns: i64,
}

enum NativeDecoder {}

#[cfg(luna_ffmpeg_shared)]
unsafe extern "C" {
    fn luna_ffmpeg_d3d11_open(
        path_utf8: *const c_char,
        device: *mut c_void,
        error_buffer: *mut c_char,
        error_buffer_size: u32,
    ) -> *mut NativeDecoder;
    fn luna_ffmpeg_d3d11_read_at(
        decoder: *mut NativeDecoder,
        seconds: f64,
        frame: *mut NativeFrame,
        error_buffer: *mut c_char,
        error_buffer_size: u32,
    ) -> i32;
    fn luna_ffmpeg_d3d11_convert_current(
        decoder: *mut NativeDecoder,
        output_texture: *mut c_void,
        error_buffer: *mut c_char,
        error_buffer_size: u32,
    ) -> i32;
    fn luna_ffmpeg_d3d11_close(decoder: *mut NativeDecoder);
}

pub(crate) struct FfmpegD3d11Frame {
    pub(crate) resource: ID3D12Resource,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) format: SurfaceFormat,
    pub(crate) ready_fence_value: u64,
}

pub(crate) struct FfmpegD3d11Decoder {
    #[allow(dead_code)]
    libraries: Vec<Library>,
    native: *mut NativeDecoder,
    d3d11_device: ID3D11Device1,
    d3d12_device: ID3D12Device,
    shared_texture: Option<ID3D11Texture2D>,
    shared_resource: Option<ID3D12Resource>,
    shared_description: Option<(u32, u32, i32)>,
}

impl FfmpegD3d11Decoder {
    #[cfg(luna_ffmpeg_shared)]
    pub(crate) fn open(
        ffmpeg_path: &str,
        source_path: &str,
        d3d11_device: &ID3D11Device1,
        d3d12_device: &ID3D12Device,
    ) -> Result<Self, String> {
        let libraries = load_libraries(ffmpeg_path)?;
        let path = CString::new(source_path)
            .map_err(|_| "video path contains an unsupported null character".to_string())?;
        let mut error = [0_u8; ERROR_BUFFER_SIZE];
        let native = unsafe {
            luna_ffmpeg_d3d11_open(
                path.as_ptr(),
                d3d11_device.as_raw(),
                error.as_mut_ptr().cast(),
                error.len() as u32,
            )
        };
        if native.is_null() {
            return Err(error_text(&error));
        }
        Ok(Self {
            libraries,
            native,
            d3d11_device: d3d11_device.clone(),
            d3d12_device: d3d12_device.clone(),
            shared_texture: None,
            shared_resource: None,
            shared_description: None,
        })
    }

    #[cfg(not(luna_ffmpeg_shared))]
    pub(crate) fn open(
        _ffmpeg_path: &str,
        _source_path: &str,
        _d3d11_device: &ID3D11Device1,
        _d3d12_device: &ID3D12Device,
    ) -> Result<Self, String> {
        Err("in-process FFmpeg D3D11VA support was not included in this build".to_string())
    }

    #[cfg(luna_ffmpeg_shared)]
    pub(crate) fn read_frame_at_seconds(
        &mut self,
        seconds: f64,
        max_side: u32,
        interop: &InteropDevice,
    ) -> Result<Option<FfmpegD3d11Frame>, String> {
        let mut native_frame = NativeFrame {
            texture: ptr::null_mut(),
            array_slice: 0,
            width: 0,
            height: 0,
            dxgi_format: 0,
            timestamp_100ns: 0,
        };
        let mut error = [0_u8; ERROR_BUFFER_SIZE];
        let result = unsafe {
            luna_ffmpeg_d3d11_read_at(
                self.native,
                seconds,
                &mut native_frame,
                error.as_mut_ptr().cast(),
                error.len() as u32,
            )
        };
        if result < 0 {
            return Err(error_text(&error));
        }
        if result == 0 {
            return Ok(None);
        }
        if native_frame.texture.is_null() || native_frame.width == 0 || native_frame.height == 0 {
            return Err("FFmpeg returned an invalid D3D11 decode texture".to_string());
        }

        let max_edge = native_frame.width.max(native_frame.height).max(1);
        let scale = (max_side as f64 / max_edge as f64).min(1.0);
        let width = ((native_frame.width as f64 * scale).round() as u32).max(2) & !1;
        let height = ((native_frame.height as f64 * scale).round() as u32).max(2) & !1;
        self.ensure_shared_texture(width, height)?;
        interop.wait_for_d3d11_decode_write()?;
        let mut conversion_error = [0_u8; ERROR_BUFFER_SIZE];
        let conversion_result = unsafe {
            luna_ffmpeg_d3d11_convert_current(
                self.native,
                self.shared_texture
                    .as_ref()
                    .ok_or_else(|| "shared D3D11 decode texture is unavailable".to_string())?
                    .as_raw(),
                conversion_error.as_mut_ptr().cast(),
                conversion_error.len() as u32,
            )
        };
        if conversion_result < 0 {
            return Err(error_text(&conversion_error));
        }
        let ready_fence_value = interop.signal_d3d11_decode_ready()?;
        Ok(Some(FfmpegD3d11Frame {
            resource: self
                .shared_resource
                .as_ref()
                .ok_or_else(|| "shared D3D12 decode texture is unavailable".to_string())?
                .clone(),
            width,
            height,
            format: SurfaceFormat::Bgra8,
            ready_fence_value,
        }))
    }

    #[cfg(luna_ffmpeg_shared)]
    fn ensure_shared_texture(&mut self, width: u32, height: u32) -> Result<(), String> {
        let dxgi_format = windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM.0;
        if self.shared_description == Some((width, height, dxgi_format)) {
            return Ok(());
        }
        let description = D3D12_RESOURCE_DESC {
            Dimension: D3D12_RESOURCE_DIMENSION_TEXTURE2D,
            Alignment: 0,
            Width: u64::from(width),
            Height: height,
            DepthOrArraySize: 1,
            MipLevels: 1,
            Format: DXGI_FORMAT(dxgi_format),
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Layout: D3D12_TEXTURE_LAYOUT_UNKNOWN,
            Flags: D3D12_RESOURCE_FLAGS(1),
        };
        let heap_properties = unsafe {
            self.d3d12_device
                .GetCustomHeapProperties(0, D3D12_HEAP_TYPE_DEFAULT)
        };
        let mut resource = None;
        unsafe {
            self.d3d12_device.CreateCommittedResource(
                &heap_properties,
                D3D12_HEAP_FLAG_SHARED,
                &description,
                D3D12_RESOURCE_STATE_COMMON,
                None,
                &mut resource,
            )
        }
        .map_err(|error| format!("failed to create shared D3D12 decode texture: {error}"))?;
        let resource: ID3D12Resource =
            resource.ok_or_else(|| "D3D12 did not return a shared decode texture".to_string())?;
        let handle = unsafe {
            self.d3d12_device.CreateSharedHandle(
                &resource,
                None,
                0x1000_0000,
                windows::core::PCWSTR::null(),
            )
        }
        .map_err(|error| format!("failed to create D3D12 decode texture handle: {error}"))?;
        let opened: Result<ID3D11Texture2D, String> =
            unsafe { self.d3d11_device.OpenSharedResource1(handle) }
                .map_err(|error| format!("failed to open D3D12 decode texture in D3D11: {error}"));
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
        self.shared_texture = Some(opened?);
        self.shared_resource = Some(resource);
        self.shared_description = Some((width, height, dxgi_format));
        Ok(())
    }

    #[cfg(not(luna_ffmpeg_shared))]
    pub(crate) fn read_frame_at_seconds(
        &mut self,
        _seconds: f64,
        _max_side: u32,
        _interop: &InteropDevice,
    ) -> Result<Option<FfmpegD3d11Frame>, String> {
        Ok(None)
    }
}

#[cfg(luna_ffmpeg_shared)]
impl Drop for FfmpegD3d11Decoder {
    fn drop(&mut self) {
        if !self.native.is_null() {
            unsafe { luna_ffmpeg_d3d11_close(self.native) };
            self.native = ptr::null_mut();
        }
    }
}

#[cfg(not(luna_ffmpeg_shared))]
impl Drop for FfmpegD3d11Decoder {
    fn drop(&mut self) {}
}

#[cfg(luna_ffmpeg_shared)]
fn load_libraries(ffmpeg_path: &str) -> Result<Vec<Library>, String> {
    let directory = Path::new(ffmpeg_path)
        .parent()
        .ok_or_else(|| "FFmpeg path has no containing directory".to_string())?;
    let mut libraries = Vec::new();
    for name in ["avutil-60.dll", "avcodec-62.dll", "avformat-62.dll"] {
        let path = directory.join(name);
        let library = unsafe { Library::new(&path) }
            .map_err(|error| format!("failed to load {}: {error}", path.display()))?;
        libraries.push(library);
    }
    Ok(libraries)
}

fn error_text(buffer: &[u8]) -> String {
    let end = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    String::from_utf8_lossy(&buffer[..end]).into_owned()
}
