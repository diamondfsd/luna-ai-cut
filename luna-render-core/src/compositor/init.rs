pub(super) fn instance_descriptor(
    backends: wgpu::Backends,
    log_path: Option<&str>,
) -> Result<wgpu::InstanceDescriptor, String> {
    #[allow(unused_mut)]
    let mut descriptor = wgpu::InstanceDescriptor {
        backends,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    };

    #[cfg(target_os = "windows")]
    {
        if !backends.contains(wgpu::Backends::DX12) {
            return Ok(descriptor);
        }
        let configured = std::env::var_os("LUNA_DXC_PATH")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                log_path
                    .and_then(|path| std::path::Path::new(path).parent())
                    .map(|parent| parent.join("dxcompiler.dll"))
            })
            .unwrap_or_else(|| std::path::PathBuf::from("dxcompiler.dll"));
        let dxc_path = std::fs::canonicalize(&configured).map_err(|error| {
            format!(
                "DXC compiler is missing at {}: {error}",
                configured.display()
            )
        })?;
        let dxil_path = dxc_path.with_file_name("dxil.dll");
        if !dxil_path.is_file() {
            return Err(format!(
                "DXC support library is missing at {}",
                dxil_path.display()
            ));
        }
        crate::logging::write(&format!(
            "wgpu DX12 shader compiler: dynamic-dxc path={}",
            dxc_path.display()
        ));
        descriptor.backend_options.dx12.shader_compiler = wgpu::Dx12Compiler::DynamicDxc {
            dxc_path: dxc_path.to_string_lossy().into_owned(),
        };
    }

    #[cfg(not(target_os = "windows"))]
    let _ = log_path;

    Ok(descriptor)
}

pub(super) struct SelectedGpu {
    pub(super) device: wgpu::Device,
    pub(super) queue: wgpu::Queue,
    pub(super) info: wgpu::AdapterInfo,
    pub(super) backend: wgpu::Backend,
}

#[cfg(not(target_os = "windows"))]
pub(super) fn select_gpu(log_path: Option<&str>) -> Result<SelectedGpu, String> {
    let backends = wgpu::Backends::default();
    crate::logging::write(&format!("Enabled wgpu backends: {backends:?}"));
    let instance = wgpu::Instance::new(instance_descriptor(backends, log_path)?);
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::LowPower,
        compatible_surface: None,
        force_fallback_adapter: false,
        apply_limit_buckets: false,
    }))
    .map_err(|error| format!("No suitable GPU adapter: {error}"))?;
    let info = adapter.get_info();
    let (device, queue) = request_device(&adapter)?;
    let backend = info.backend;
    Ok(SelectedGpu {
        device,
        queue,
        info,
        backend,
    })
}

#[cfg(any(target_os = "windows", test))]
fn is_usable_dx12_adapter(name: &str, device_type: wgpu::DeviceType) -> bool {
    device_type != wgpu::DeviceType::Cpu
        && !name
            .to_ascii_lowercase()
            .contains("microsoft basic render driver")
}

#[cfg(target_os = "windows")]
fn adapter_priority(info: &wgpu::AdapterInfo) -> u8 {
    match info.device_type {
        wgpu::DeviceType::DiscreteGpu => 5,
        wgpu::DeviceType::IntegratedGpu => 4,
        wgpu::DeviceType::VirtualGpu => 3,
        wgpu::DeviceType::Other => 2,
        wgpu::DeviceType::Cpu => 1,
    }
}

fn request_device(adapter: &wgpu::Adapter) -> Result<(wgpu::Device, wgpu::Queue), String> {
    pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("Luna Render Core"),
        required_features: wgpu::Features::empty(),
        required_limits: wgpu::Limits::default(),
        ..Default::default()
    }))
    .map_err(|error| format!("Failed to create device: {error}"))
}

#[cfg(target_os = "windows")]
fn adapters_for(
    backend: wgpu::Backends,
    log_path: Option<&str>,
) -> Result<Vec<wgpu::Adapter>, String> {
    let instance = wgpu::Instance::new(instance_descriptor(backend, log_path)?);
    Ok(pollster::block_on(instance.enumerate_adapters(backend)))
}

#[cfg(target_os = "windows")]
pub(super) fn select_gpu(log_path: Option<&str>) -> Result<SelectedGpu, String> {
    crate::logging::write("Selecting Windows GPU backend (D3D12 -> OpenGL fallback)...");
    let mut dx12 = match adapters_for(wgpu::Backends::DX12, log_path) {
        Ok(adapters) => adapters,
        Err(error) => {
            crate::logging::write(&format!(
                "D3D12 initialization failed; falling back to OpenGL: {error}"
            ));
            Vec::new()
        }
    };
    for adapter in &dx12 {
        let info = adapter.get_info();
        crate::logging::write(&format!(
            "GPU candidate backend=Dx12 name={} type={:?} vendor={} device={}",
            info.name, info.device_type, info.vendor, info.device,
        ));
    }
    dx12.sort_by_key(|adapter| std::cmp::Reverse(adapter_priority(&adapter.get_info())));
    for adapter in dx12 {
        let info = adapter.get_info();
        if !is_usable_dx12_adapter(&info.name, info.device_type) {
            crate::logging::write(&format!(
                "GPU candidate rejected backend=Dx12 name={} type={:?} reason=software-adapter",
                info.name, info.device_type,
            ));
            continue;
        }
        match request_device(&adapter) {
            Ok((device, queue)) => {
                return Ok(SelectedGpu {
                    device,
                    queue,
                    info,
                    backend: wgpu::Backend::Dx12,
                });
            }
            Err(error) => crate::logging::write(&format!(
                "GPU candidate rejected backend=Dx12 name={} reason={}",
                info.name, error,
            )),
        }
    }

    crate::logging::write("No usable D3D12 adapter; falling back to OpenGL");
    let mut gl = adapters_for(wgpu::Backends::GL, log_path)?;
    for adapter in &gl {
        let info = adapter.get_info();
        crate::logging::write(&format!(
            "GPU candidate backend=Gl name={} type={:?} vendor={} device={}",
            info.name, info.device_type, info.vendor, info.device,
        ));
    }
    gl.sort_by_key(|adapter| std::cmp::Reverse(adapter_priority(&adapter.get_info())));
    for adapter in gl {
        let info = adapter.get_info();
        match request_device(&adapter) {
            Ok((device, queue)) => {
                return Ok(SelectedGpu {
                    device,
                    queue,
                    info,
                    backend: wgpu::Backend::Gl,
                });
            }
            Err(error) => crate::logging::write(&format!(
                "GPU candidate rejected backend=Gl name={} reason={}",
                info.name, error,
            )),
        }
    }

    Err("No usable D3D12 or OpenGL adapter".to_string())
}

#[cfg(test)]
mod tests {
    use super::is_usable_dx12_adapter;

    #[test]
    fn rejects_windows_software_dx12_adapter() {
        assert!(!is_usable_dx12_adapter(
            "Microsoft Basic Render Driver",
            wgpu::DeviceType::Cpu,
        ));
        assert!(!is_usable_dx12_adapter(
            "Microsoft Basic Render Driver",
            wgpu::DeviceType::Other,
        ));
        assert!(!is_usable_dx12_adapter("LLVMpipe", wgpu::DeviceType::Cpu,));
        assert!(is_usable_dx12_adapter(
            "NVIDIA GeForce RTX",
            wgpu::DeviceType::DiscreteGpu,
        ));
        assert!(is_usable_dx12_adapter(
            "VMware SVGA 3D",
            wgpu::DeviceType::VirtualGpu,
        ));
    }
}
