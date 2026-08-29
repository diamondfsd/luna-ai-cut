use windows::core::{IUnknown, Interface};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Direct3D11on12::D3D11On12CreateDevice;
use windows::Win32::Graphics::Direct3D11on12::ID3D11On12Device2;
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandQueue, ID3D12Device, D3D12_COMMAND_LIST_TYPE_DIRECT, D3D12_COMMAND_QUEUE_DESC,
    D3D12_COMMAND_QUEUE_FLAG_NONE,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory2, IDXGIAdapter, IDXGIFactory4, DXGI_CREATE_FACTORY_FLAGS,
};
use windows::Win32::Media::MediaFoundation::{IMFDXGIDeviceManager, MFCreateDXGIDeviceManager};

/// wgpu D3D12 与 Media Foundation 之间共用的设备组。
///
/// Source Reader uses a real D3D12 manager, while Sink Writer remains on the
/// D3D11On12 manager because Sink Writer does not accept a D3D12 manager.
pub(crate) struct InteropDevice {
    // 保持创建 D3D11On12 子对象所依赖的基础设备存活。
    #[allow(dead_code)]
    pub(crate) d3d12_device: ID3D12Device,
    #[allow(dead_code)]
    pub(crate) d3d11_device: ID3D11Device,
    pub(crate) d3d11on12_device: ID3D11On12Device2,
    #[allow(dead_code)]
    pub(crate) d3d11_context: ID3D11DeviceContext,
    /// Keep D3D11On12 work off the wgpu queue. Some drivers can deadlock when
    /// UnwrapUnderlyingResource and the consumer use the same queue.
    pub(crate) interop_queue: ID3D12CommandQueue,
    /// Ordinary D3D11 device used by Media Foundation and the native shared
    /// texture bridge. It is created from the wgpu adapter LUID.
    pub(crate) native_d3d11_device: ID3D11Device,
    pub(crate) native_d3d11_context: ID3D11DeviceContext,
    pub(crate) native_device_manager: IMFDXGIDeviceManager,
    pub(crate) decoder_device_manager: IMFDXGIDeviceManager,
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
            "[Export:WinGPU] interop adapter-luid high={} low={} (from wgpu D3D12 device)",
            adapter_luid.HighPart, adapter_luid.LowPart,
        ));
        let queue_desc = D3D12_COMMAND_QUEUE_DESC {
            Type: D3D12_COMMAND_LIST_TYPE_DIRECT,
            Priority: 0,
            Flags: D3D12_COMMAND_QUEUE_FLAG_NONE,
            NodeMask: 0,
        };
        let interop_queue: ID3D12CommandQueue =
            unsafe { d3d12_device.CreateCommandQueue(&queue_desc) }
                .map_err(|error| format!("无法创建 D3D11On12 独立命令队列: {error}"))?;
        crate::logging::write(
            "[Export:WinGPU] interop queue=separate-d3d12-direct (wgpu queue is not reused)",
        );
        let queue: IUnknown = interop_queue
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

        let (native_d3d11_device, native_d3d11_context) = create_native_d3d11_device(adapter_luid)?;

        let d3d11_unknown: IUnknown = d3d11_device
            .cast()
            .map_err(|error| format!("无法取得 D3D11 encoder device: {error}"))?;
        let d3d12_unknown: IUnknown = d3d12_device
            .cast()
            .map_err(|error| format!("无法取得 D3D12 decoder device: {error}"))?;
        let (reset_token, device_manager) =
            create_device_manager(&d3d11_unknown, "D3D11On12 encoder")?;
        let (decoder_reset_token, decoder_device_manager) =
            create_device_manager(&d3d12_unknown, "D3D12 Media Foundation decoder")?;
        let native_d3d11_unknown: IUnknown = native_d3d11_device
            .cast()
            .map_err(|error| format!("无法取得 native D3D11 device: {error}"))?;
        let (_native_reset_token, native_device_manager) =
            create_device_manager(&native_d3d11_unknown, "native D3D11 Media Foundation")?;
        crate::logging::write(
            "[Export:WinGPU] device-managers native=D3D11 source-reader/encoder legacy=D3D11On12 compatible d3d12=D3D12",
        );

        Ok(Self {
            d3d12_device: d3d12_device.clone(),
            d3d11_device,
            d3d11on12_device,
            d3d11_context,
            interop_queue,
            native_d3d11_device,
            native_d3d11_context,
            native_device_manager,
            decoder_device_manager,
            device_manager,
            reset_token,
            decoder_reset_token,
        })
    }

    pub(crate) fn log_device_status(&self, stage: &str) {
        let d3d11 = unsafe { self.d3d11_device.GetDeviceRemovedReason() }
            .map(|_| "S_OK".to_string())
            .unwrap_or_else(|error| format!("{:?}", error.code()));
        let d3d12 = unsafe { self.d3d12_device.GetDeviceRemovedReason() }
            .map(|_| "S_OK".to_string())
            .unwrap_or_else(|error| format!("{:?}", error.code()));
        crate::logging::write(&format!(
            "[Export:WinGPU] device-status stage={stage} d3d11={d3d11} d3d12={d3d12}"
        ));
    }
}

fn create_native_d3d11_device(
    adapter_luid: windows::Win32::Foundation::LUID,
) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let factory: IDXGIFactory4 =
        unsafe { CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS::default()) }
            .map_err(|error| format!("无法创建 native D3D11 DXGI 工厂: {error}"))?;
    let adapter: IDXGIAdapter = unsafe { factory.EnumAdapterByLuid(adapter_luid) }
        .map_err(|error| format!("无法按 adapter LUID 获取 native D3D11 adapter: {error}"))?;
    let feature_levels = [D3D_FEATURE_LEVEL_11_0];
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            &adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            windows::Win32::Foundation::HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            Some(&feature_levels),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
    }
    .map_err(|error| format!("无法创建 native D3D11 device: {error}"))?;
    let device = device.ok_or_else(|| "native D3D11 device was not returned".to_string())?;
    let context = context.ok_or_else(|| "native D3D11 context was not returned".to_string())?;
    crate::logging::write("[Export:WinGPU] native D3D11 device created on wgpu adapter LUID");
    Ok((device, context))
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
