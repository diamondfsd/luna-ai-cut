use std::sync::atomic::{AtomicU64, Ordering};

use windows::core::{IUnknown, Interface};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device1, ID3D11Device5, ID3D11DeviceContext4, ID3D11Fence, D3D11_FENCE_FLAG_SHARED,
};
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandQueue, ID3D12Device, ID3D12Fence, D3D12_COMMAND_LIST_TYPE,
    D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS, D3D12_COMMAND_QUEUE_DESC, D3D12_COMMAND_QUEUE_FLAG_NONE,
};
use windows::Win32::Media::MediaFoundation::{IMFDXGIDeviceManager, MFCreateDXGIDeviceManager};

/// D3D12 resources shared by wgpu and Media Foundation.
///
/// The manager is reset with the same D3D12 device that wgpu uses. Decoded
/// frames therefore remain D3D12 resources, and the two video queues can be
/// used by the native video process and encode paths without an API bridge.
pub(crate) struct InteropDevice {
    pub(crate) d3d12_device: ID3D12Device,
    pub(crate) video_process_queue: ID3D12CommandQueue,
    pub(crate) decoder_device_manager: Option<IMFDXGIDeviceManager>,
    pub(crate) ffmpeg_d3d11_device: ID3D11Device1,
    pub(crate) ffmpeg_d3d12_fence: ID3D12Fence,
    ffmpeg_d3d11_context: ID3D11DeviceContext4,
    ffmpeg_d3d11_fence: ID3D11Fence,
    ffmpeg_fence_value: AtomicU64,
    ffmpeg_wgpu_release_value: AtomicU64,
}

impl InteropDevice {
    pub(crate) fn new(d3d12_device: &ID3D12Device) -> Result<Self, String> {
        Self::new_inner(d3d12_device, true)
    }

    pub(crate) fn new_for_export(d3d12_device: &ID3D12Device) -> Result<Self, String> {
        Self::new_inner(d3d12_device, false)
    }

    fn new_inner(
        d3d12_device: &ID3D12Device,
        enable_media_foundation: bool,
    ) -> Result<Self, String> {
        let adapter_luid = unsafe { d3d12_device.GetAdapterLuid() };
        crate::logging::write(&format!(
            "[Export:WinGPU] d3d12 adapter-luid high={} low={}",
            adapter_luid.HighPart, adapter_luid.LowPart,
        ));

        let video_process_queue = create_video_queue(
            d3d12_device,
            D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS,
            "D3D12 video process",
        )?;
        let decoder_device_manager = if enable_media_foundation {
            let d3d12_unknown: IUnknown = d3d12_device
                .cast()
                .map_err(|error| format!("无法取得 D3D12 Media Foundation device: {error}"))?;
            Some(create_device_manager(&d3d12_unknown, "D3D12 Media Foundation")?.1)
        } else {
            None
        };
        let (ffmpeg_d3d11_device, ffmpeg_d3d11_context) =
            super::nvenc::create_d3d11_device(d3d12_device)?;
        let ffmpeg_d3d11_context: ID3D11DeviceContext4 = ffmpeg_d3d11_context
            .cast()
            .map_err(|error| format!("D3D11.4 decode synchronization is unavailable: {error}"))?;
        let ffmpeg_d3d11_device5: ID3D11Device5 = ffmpeg_d3d11_device
            .cast()
            .map_err(|error| format!("D3D11.5 decode synchronization is unavailable: {error}"))?;
        let mut ffmpeg_d3d11_fence: Option<ID3D11Fence> = None;
        unsafe {
            ffmpeg_d3d11_device5.CreateFence(0, D3D11_FENCE_FLAG_SHARED, &mut ffmpeg_d3d11_fence)
        }
        .map_err(|error| format!("failed to create FFmpeg D3D11 decode fence: {error}"))?;
        let ffmpeg_d3d11_fence = ffmpeg_d3d11_fence
            .ok_or_else(|| "D3D11 did not return an FFmpeg decode fence".to_string())?;
        let fence_handle = unsafe {
            ffmpeg_d3d11_fence.CreateSharedHandle(None, 0x1000_0000, windows::core::PCWSTR::null())
        }
        .map_err(|error| format!("failed to share FFmpeg decode fence: {error}"))?;
        let ffmpeg_d3d12_fence = (|| {
            let mut fence = None;
            unsafe { d3d12_device.OpenSharedHandle(fence_handle, &mut fence) }
                .map_err(|error| format!("failed to open FFmpeg decode fence in D3D12: {error}"))?;
            fence.ok_or_else(|| "D3D12 did not return the FFmpeg decode fence".to_string())
        })();
        let _ = unsafe { CloseHandle(fence_handle) };
        let ffmpeg_d3d12_fence = ffmpeg_d3d12_fence?;

        crate::logging::write(&format!(
            "[Export:WinGPU] backend=d3d12 video-process-queue=true vendor-encoder=true media-foundation-device={}",
            if enable_media_foundation { "D3D12" } else { "disabled" },
        ));

        Ok(Self {
            d3d12_device: d3d12_device.clone(),
            video_process_queue,
            decoder_device_manager,
            ffmpeg_d3d11_device,
            ffmpeg_d3d12_fence,
            ffmpeg_d3d11_context,
            ffmpeg_d3d11_fence,
            ffmpeg_fence_value: AtomicU64::new(1),
            ffmpeg_wgpu_release_value: AtomicU64::new(0),
        })
    }

    pub(crate) fn signal_d3d11_decode_ready(&self) -> Result<u64, String> {
        let value = self.ffmpeg_fence_value.fetch_add(1, Ordering::SeqCst);
        unsafe {
            self.ffmpeg_d3d11_context
                .Signal(&self.ffmpeg_d3d11_fence, value)
        }
        .map_err(|error| format!("failed to signal FFmpeg D3D11 decode work: {error}"))?;
        Ok(value)
    }

    pub(crate) fn wait_for_d3d11_decode_write(&self) -> Result<(), String> {
        let value = self.ffmpeg_wgpu_release_value.load(Ordering::SeqCst);
        if value == 0 {
            return Ok(());
        }
        unsafe {
            self.ffmpeg_d3d11_context
                .Wait(&self.ffmpeg_d3d11_fence, value)
        }
        .map_err(|error| format!("failed to wait before reusing FFmpeg decode texture: {error}"))
    }

    pub(crate) fn reserve_ffmpeg_wgpu_release(&self) -> u64 {
        let value = self.ffmpeg_fence_value.fetch_add(1, Ordering::SeqCst);
        self.ffmpeg_wgpu_release_value
            .store(value, Ordering::SeqCst);
        value
    }

    pub(crate) fn log_device_status(&self, stage: &str) {
        let d3d12 = unsafe { self.d3d12_device.GetDeviceRemovedReason() }
            .map(|_| "S_OK".to_string())
            .unwrap_or_else(|error| format!("{:?}", error.code()));
        crate::logging::write(&format!(
            "[Export:WinGPU] device-status stage={stage} d3d12={d3d12}"
        ));
    }
}

fn create_video_queue(
    device: &ID3D12Device,
    queue_type: D3D12_COMMAND_LIST_TYPE,
    label: &str,
) -> Result<ID3D12CommandQueue, String> {
    let desc = D3D12_COMMAND_QUEUE_DESC {
        Type: queue_type,
        Priority: 0,
        Flags: D3D12_COMMAND_QUEUE_FLAG_NONE,
        NodeMask: 0,
    };
    unsafe { device.CreateCommandQueue(&desc) }
        .map_err(|error| format!("无法创建 {label} command queue: {error}"))
}

fn create_device_manager(
    device: &IUnknown,
    label: &str,
) -> Result<(u32, IMFDXGIDeviceManager), String> {
    let mut reset_token = 0;
    let mut device_manager = None;
    unsafe { MFCreateDXGIDeviceManager(&mut reset_token, &mut device_manager) }
        .map_err(|error| format!("无法创建 {label} device manager: {error}"))?;
    let device_manager =
        device_manager.ok_or_else(|| format!("{label} device manager was not returned"))?;
    unsafe { device_manager.ResetDevice(device, reset_token) }
        .map_err(|error| format!("无法连接 {label} device manager: {error}"))?;
    Ok((reset_token, device_manager))
}
