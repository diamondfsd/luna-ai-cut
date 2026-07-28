pub(super) fn instance_descriptor(
    backends: wgpu::Backends,
    log_path: Option<&str>,
) -> Result<wgpu::InstanceDescriptor, String> {
    let mut descriptor = wgpu::InstanceDescriptor {
        backends,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    };

    #[cfg(target_os = "windows")]
    {
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
