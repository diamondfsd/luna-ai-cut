use windows::core::{IUnknown, Interface};
use windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL_11_0;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
};
use windows::Win32::Graphics::Direct3D11on12::D3D11On12CreateDevice;
use windows::Win32::Graphics::Direct3D11on12::ID3D11On12Device2;
use windows::Win32::Graphics::Direct3D12::{ID3D12CommandQueue, ID3D12Device};
use windows::Win32::Media::MediaFoundation::{IMFDXGIDeviceManager, MFCreateDXGIDeviceManager};

/// wgpu D3D12 与 Media Foundation 之间共用的设备组。
///
/// D3D11On12 让 Media Foundation 继续使用其原生 D3D11 设备管理接口，
/// 同时确保视频表面与 compositor 的 D3D12 队列位于同一设备上。
pub(crate) struct InteropDevice {
    // 保持创建 D3D11On12 子对象所依赖的基础设备存活。
    #[allow(dead_code)]
    pub(crate) d3d11_device: ID3D11Device,
    pub(crate) d3d11on12_device: ID3D11On12Device2,
    #[allow(dead_code)]
    pub(crate) d3d11_context: ID3D11DeviceContext,
    #[allow(dead_code)]
    pub(crate) device_manager: IMFDXGIDeviceManager,
    #[allow(dead_code)]
    pub(crate) reset_token: u32,
}

impl InteropDevice {
    pub(crate) fn new(
        d3d12_device: &ID3D12Device,
        d3d12_queue: &ID3D12CommandQueue,
    ) -> Result<Self, String> {
        let queue: IUnknown = d3d12_queue
            .cast()
            .map_err(|error| format!("无法共享图形队列: {error}"))?;
        let queues = [Some(queue)];
        let feature_levels = [D3D_FEATURE_LEVEL_11_0];
        let mut d3d11_device = None;
        let mut d3d11_context = None;

        unsafe {
            D3D11On12CreateDevice(
                d3d12_device,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT.0 | D3D11_CREATE_DEVICE_VIDEO_SUPPORT.0,
                Some(&feature_levels),
                Some(&queues),
                0,
                Some(&mut d3d11_device),
                Some(&mut d3d11_context),
                None,
            )
        }
        .map_err(|error| format!("无法创建共享视频设备: {error}"))?;

        let d3d11_device =
            d3d11_device.ok_or_else(|| "共享视频设备创建后未返回设备".to_string())?;
        let d3d11_context =
            d3d11_context.ok_or_else(|| "共享视频设备创建后未返回队列".to_string())?;
        let d3d11on12_device = d3d11_device
            .cast::<ID3D11On12Device2>()
            .map_err(|error| format!("系统不支持 Direct3D 共享资源解包: {error}"))?;

        let mut reset_token = 0;
        let mut device_manager = None;
        unsafe { MFCreateDXGIDeviceManager(&mut reset_token, &mut device_manager) }
            .map_err(|error| format!("无法创建视频设备管理器: {error}"))?;
        let device_manager =
            device_manager.ok_or_else(|| "视频设备管理器创建后未返回实例".to_string())?;
        unsafe { device_manager.ResetDevice(&d3d11_device, reset_token) }
            .map_err(|error| format!("无法连接视频设备管理器: {error}"))?;

        Ok(Self {
            d3d11_device,
            d3d11on12_device,
            d3d11_context,
            device_manager,
            reset_token,
        })
    }
}
