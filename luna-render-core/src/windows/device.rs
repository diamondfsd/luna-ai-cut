use windows::core::{IUnknown, Interface};
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandQueue, ID3D12Device, D3D12_COMMAND_LIST_TYPE,
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
    pub(crate) decoder_device_manager: IMFDXGIDeviceManager,
    /// Compatibility alias for callers that used the generic manager name.
    #[allow(dead_code)]
    pub(crate) device_manager: IMFDXGIDeviceManager,
    #[allow(dead_code)]
    pub(crate) reset_token: u32,
    #[allow(dead_code)]
    pub(crate) decoder_reset_token: u32,
}

impl InteropDevice {
    pub(crate) fn new(d3d12_device: &ID3D12Device) -> Result<Self, String> {
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
        let d3d12_unknown: IUnknown = d3d12_device
            .cast()
            .map_err(|error| format!("无法取得 D3D12 Media Foundation device: {error}"))?;
        let (reset_token, device_manager) =
            create_device_manager(&d3d12_unknown, "D3D12 Media Foundation")?;

        crate::logging::write(
            "[Export:WinGPU] backend=d3d12 video-process-queue=true vendor-encoder=true media-foundation-device=D3D12",
        );

        Ok(Self {
            d3d12_device: d3d12_device.clone(),
            video_process_queue,
            decoder_device_manager: device_manager.clone(),
            device_manager,
            reset_token,
            decoder_reset_token: reset_token,
        })
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
