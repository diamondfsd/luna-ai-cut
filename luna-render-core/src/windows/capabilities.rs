use std::ptr;

use windows::core::Interface;
use windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL_11_0;
use windows::Win32::Graphics::Direct3D12::{D3D12CreateDevice, ID3D12Device};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1, DXGI_ERROR_NOT_FOUND,
};
use windows::Win32::Media::MediaFoundation::{
    ID3D12VideoDevice, ID3D12VideoDevice3, IMFActivate, MFMediaType_Video, MFTEnumEx,
    MFVideoFormat_H264, MFVideoFormat_HEVC, MFVideoFormat_NV12,
    D3D12_FEATURE_DATA_VIDEO_ENCODER_CODEC, D3D12_FEATURE_DATA_VIDEO_FEATURE_AREA_SUPPORT,
    D3D12_FEATURE_VIDEO_ENCODER_CODEC, D3D12_FEATURE_VIDEO_FEATURE_AREA_SUPPORT,
    D3D12_VIDEO_ENCODER_CODEC_H264, D3D12_VIDEO_ENCODER_CODEC_HEVC, MFT_CATEGORY_VIDEO_ENCODER,
    MFT_ENUM_FLAG, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER, MFT_REGISTER_TYPE_INFO,
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

pub(crate) fn probe_hardware_encoders(
    active_device: &ID3D12Device,
) -> Result<EncoderCapabilities, String> {
    // Keep the full adapter scan for diagnostics, but never use a different
    // adapter's capability to select the encoder for the active wgpu device.
    let all_adapters = probe_d3d12_video_diagnostics();
    let d3d12 = diagnose_video_interfaces(0, active_device);
    let media_foundation = EncoderCapabilities {
        h264: has_hardware_encoder(MFVideoFormat_H264).unwrap_or_else(|error| {
            crate::logging::write(&format!(
                "[Export:WinGPU:Diagnostics] MFT H.264 probe failed: {error}"
            ));
            false
        }),
        hevc: has_hardware_encoder(MFVideoFormat_HEVC).unwrap_or_else(|error| {
            crate::logging::write(&format!(
                "[Export:WinGPU:Diagnostics] MFT HEVC probe failed: {error}"
            ));
            false
        }),
    };

    crate::logging::write(&format!(
        "[Export:WinGPU:Diagnostics] encoder-capabilities active-d3d12-h264={} active-d3d12-hevc={} all-d3d12-h264={} all-d3d12-hevc={} mft-h264={} mft-hevc={}",
        d3d12.h264,
        d3d12.hevc,
        all_adapters.h264,
        all_adapters.hevc,
        media_foundation.h264,
        media_foundation.hevc,
    ));
    // MFTEnumEx describes separately installed Media Foundation transforms.
    // The selected backend is D3D12 Video Encode, so its capability comes from
    // the active ID3D12VideoDevice rather than from the global MFT registry.
    Ok(EncoderCapabilities {
        h264: d3d12.h264,
        hevc: d3d12.hevc,
    })
}

#[derive(Debug, Clone, Copy, Default)]
struct D3d12EncoderCapabilities {
    h264: bool,
    hevc: bool,
}

/// Logs read-only D3D12 video capability diagnostics without affecting the
/// Media Foundation result used by the export path.
fn probe_d3d12_video_diagnostics() -> D3d12EncoderCapabilities {
    crate::logging::write("[Export:WinGPU:Diagnostics] d3d12 capability probe begin");
    let mut capabilities = D3d12EncoderCapabilities::default();

    let factory: IDXGIFactory1 = match unsafe { CreateDXGIFactory1() } {
        Ok(factory) => factory,
        Err(error) => {
            log_hresult("create-dxgi-factory1", &error);
            return capabilities;
        }
    };

    let mut index = 0;
    loop {
        let adapter = match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => adapter,
            Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(error) => {
                log_hresult(&format!("enum-adapter index={index}"), &error);
                break;
            }
        };

        let adapter_capabilities = diagnose_d3d12_adapter(index, &adapter);
        capabilities.h264 |= adapter_capabilities.h264;
        capabilities.hevc |= adapter_capabilities.hevc;
        index += 1;
    }

    crate::logging::write(&format!(
        "[Export:WinGPU:Diagnostics] d3d12 capability probe end adapters={index}"
    ));
    capabilities
}

fn diagnose_d3d12_adapter(index: u32, adapter: &IDXGIAdapter1) -> D3d12EncoderCapabilities {
    let mut capabilities = D3d12EncoderCapabilities::default();
    let desc = match unsafe { adapter.GetDesc1() } {
        Ok(desc) => desc,
        Err(error) => {
            log_hresult(&format!("adapter-desc index={index}"), &error);
            return capabilities;
        }
    };
    let name = utf16_string(&desc.Description);
    let luid = format_luid(desc.AdapterLuid);
    let is_nvidia = desc.VendorId == 0x10DE;
    let is_software = (desc.Flags & 0x2) != 0;
    let driver = match unsafe { adapter.CheckInterfaceSupport(&IDXGIDevice::IID) } {
        Ok(version) => format_driver_version(version),
        Err(error) => format!("unavailable(hr={})", hresult_code(&error)),
    };

    crate::logging::write(&format!(
        "[Export:WinGPU:Diagnostics] adapter index={index} name={name:?} vendor=0x{:04x} device=0x{:04x} nvidia={} software={} luid={} driver={driver}",
        desc.VendorId, desc.DeviceId, is_nvidia, is_software, luid,
    ));

    let mut device: Option<ID3D12Device> = None;
    match unsafe { D3D12CreateDevice(adapter, D3D_FEATURE_LEVEL_11_0, &mut device) } {
        Ok(()) => {
            let Some(device) = device else {
                crate::logging::write(&format!(
                    "[Export:WinGPU:Diagnostics] adapter index={index} d3d12-create-device result=ok device=null"
                ));
                return capabilities;
            };
            crate::logging::write(&format!(
                "[Export:WinGPU:Diagnostics] adapter index={index} d3d12-create-device result=ok nodes={}",
                unsafe { device.GetNodeCount() },
            ));
            capabilities = diagnose_video_interfaces(index, &device);
        }
        Err(error) => log_hresult(
            &format!("adapter index={index} d3d12-create-device"),
            &error,
        ),
    }
    capabilities
}

fn diagnose_video_interfaces(index: u32, device: &ID3D12Device) -> D3d12EncoderCapabilities {
    let video_device: ID3D12VideoDevice = match device.cast() {
        Ok(video_device) => {
            crate::logging::write(&format!(
                "[Export:WinGPU:Diagnostics] adapter index={index} interface=ID3D12VideoDevice cast=ok"
            ));
            video_device
        }
        Err(error) => {
            log_hresult(
                &format!("adapter index={index} interface=ID3D12VideoDevice cast"),
                &error,
            );
            return D3d12EncoderCapabilities::default();
        }
    };

    match device.cast::<ID3D12VideoDevice3>() {
        Ok(_) => crate::logging::write(&format!(
            "[Export:WinGPU:Diagnostics] adapter index={index} interface=ID3D12VideoDevice3 cast=ok"
        )),
        Err(error) => log_hresult(
            &format!("adapter index={index} interface=ID3D12VideoDevice3 cast"),
            &error,
        ),
    }

    let video_encode_supported = probe_video_feature_area(index, &video_device);
    if !video_encode_supported {
        return D3d12EncoderCapabilities::default();
    }
    D3d12EncoderCapabilities {
        h264: probe_video_encoder_codec(
            index,
            &video_device,
            "h264",
            D3D12_VIDEO_ENCODER_CODEC_H264,
        ),
        hevc: probe_video_encoder_codec(
            index,
            &video_device,
            "hevc",
            D3D12_VIDEO_ENCODER_CODEC_HEVC,
        ),
    }
}

fn probe_video_feature_area(index: u32, video_device: &ID3D12VideoDevice) -> bool {
    let mut support = D3D12_FEATURE_DATA_VIDEO_FEATURE_AREA_SUPPORT {
        NodeIndex: 0,
        ..Default::default()
    };
    let result = unsafe {
        video_device.CheckFeatureSupport(
            D3D12_FEATURE_VIDEO_FEATURE_AREA_SUPPORT,
            (&mut support as *mut D3D12_FEATURE_DATA_VIDEO_FEATURE_AREA_SUPPORT).cast(),
            std::mem::size_of::<D3D12_FEATURE_DATA_VIDEO_FEATURE_AREA_SUPPORT>() as u32,
        )
    };
    match result {
        Ok(()) => {
            let encode_supported = support.VideoEncodeSupport.as_bool();
            crate::logging::write(&format!(
                "[Export:WinGPU:Diagnostics] adapter index={index} feature=VideoFeatureAreaSupport result=ok decode={} process={} encode={}",
                support.VideoDecodeSupport.as_bool(),
                support.VideoProcessSupport.as_bool(),
                encode_supported,
            ));
            encode_supported
        }
        Err(error) => {
            log_hresult(
                &format!("adapter index={index} feature=VideoFeatureAreaSupport"),
                &error,
            );
            false
        }
    }
}

fn probe_video_encoder_codec(
    index: u32,
    video_device: &ID3D12VideoDevice,
    codec_name: &str,
    codec: windows::Win32::Media::MediaFoundation::D3D12_VIDEO_ENCODER_CODEC,
) -> bool {
    let mut support = D3D12_FEATURE_DATA_VIDEO_ENCODER_CODEC {
        NodeIndex: 0,
        Codec: codec,
        ..Default::default()
    };
    let result = unsafe {
        video_device.CheckFeatureSupport(
            D3D12_FEATURE_VIDEO_ENCODER_CODEC,
            (&mut support as *mut D3D12_FEATURE_DATA_VIDEO_ENCODER_CODEC).cast(),
            std::mem::size_of::<D3D12_FEATURE_DATA_VIDEO_ENCODER_CODEC>() as u32,
        )
    };
    match result {
        Ok(()) => {
            let supported = support.IsSupported.as_bool();
            crate::logging::write(&format!(
                "[Export:WinGPU:Diagnostics] adapter index={index} feature=EncoderCodec codec={codec_name} result=ok supported={supported}"
            ));
            supported
        }
        Err(error) => {
            log_hresult(
                &format!("adapter index={index} feature=EncoderCodec codec={codec_name}"),
                &error,
            );
            false
        }
    }
}

fn log_hresult(stage: &str, error: &windows::core::Error) {
    crate::logging::write(&format!(
        "[Export:WinGPU:Diagnostics] stage={stage} result=error hr={} message={error}",
        hresult_code(error),
    ));
}

fn hresult_code(error: &windows::core::Error) -> String {
    format!("0x{:08X}", error.code().0 as u32)
}

fn format_luid(luid: windows::Win32::Foundation::LUID) -> String {
    let value = ((luid.HighPart as i64 as u64) << 32) | u64::from(luid.LowPart);
    format!(
        "0x{value:016X}(high={},low={})",
        luid.HighPart, luid.LowPart
    )
}

fn format_driver_version(version: i64) -> String {
    let version = version as u64;
    format!(
        "{}.{}.{}.{}(raw=0x{version:016X})",
        version >> 48,
        (version >> 32) & 0xFFFF,
        (version >> 16) & 0xFFFF,
        version & 0xFFFF,
    )
}

fn utf16_string(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end])
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
