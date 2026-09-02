use super::*;

impl Compositor {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn load_external_mask_texture(
        &mut self,
        data: &[u8],
        width: u32,
        height: u32,
    ) -> Result<u32, String> {
        self.load_mask_texture(data, width, height)
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn dx12_device_and_queue(
        &self,
    ) -> Result<
        (
            windows::Win32::Graphics::Direct3D12::ID3D12Device,
            windows::Win32::Graphics::Direct3D12::ID3D12CommandQueue,
        ),
        String,
    > {
        let hal_device = unsafe { self.device.as_hal::<wgpu::hal::api::Dx12>() }
            .ok_or_else(|| "当前图形设备未使用 Direct3D 12".to_string())?;
        Ok((
            hal_device.raw_device().clone(),
            hal_device.raw_queue().clone(),
        ))
    }

    #[cfg(target_os = "windows")]
    pub(crate) unsafe fn wrap_external_dx12_texture(
        &self,
        resource: windows::Win32::Graphics::Direct3D12::ID3D12Resource,
        width: u32,
        height: u32,
        usage: wgpu::TextureUsages,
        _initialized: bool,
    ) -> Result<wgpu::Texture, String> {
        let raw_desc = unsafe { resource.GetDesc() };
        let (expected_format, wgpu_format) = match raw_desc.Format {
            windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM
            | windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM_SRGB => {
                (raw_desc.Format, wgpu::TextureFormat::Bgra8UnormSrgb)
            }
            windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM
            | windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM_SRGB => {
                (raw_desc.Format, wgpu::TextureFormat::Rgba8UnormSrgb)
            }
            _ => {
                return Err(format!(
                    "external D3D12 texture format is unsupported: got {}",
                    raw_desc.Format.0
                ));
            }
        };
        if raw_desc.Format != expected_format {
            return Err(format!(
                "external D3D12 texture format mismatch: expected {}, got {}",
                expected_format.0, raw_desc.Format.0
            ));
        }
        if raw_desc.Width != width as u64 || raw_desc.Height != height {
            return Err(format!(
                "external D3D12 texture size mismatch: expected {}x{}, got {}x{}",
                width, height, raw_desc.Width, raw_desc.Height
            ));
        }
        crate::logging::write_once(&format!(
            "[D3D12] wrap external texture raw={}x{} dxgi_format={} wgpu_format={wgpu_format:?} initial_state=COMMON usage={usage:?}",
            raw_desc.Width,
            raw_desc.Height,
            raw_desc.Format.0
        ));

        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        let hal_texture = unsafe {
            wgpu::hal::dx12::Device::texture_from_raw(
                resource,
                wgpu_format,
                wgpu::TextureDimension::D2,
                size,
                1,
                1,
            )
        };
        let descriptor = wgpu::TextureDescriptor {
            label: Some("Media Foundation Direct3D texture"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu_format,
            usage,
            view_formats: &[],
        };
        Ok(unsafe {
            self.device.create_texture_from_hal::<wgpu::hal::api::Dx12>(
                hal_texture,
                &descriptor,
                // UnwrapUnderlyingResource transitions the resource to COMMON.
                // wgpu's DX12 PRESENT usage maps to COMMON, so declare the real
                // initial state instead of bypassing wgpu's state tracker.
                wgpu::wgt::TextureUses::PRESENT,
            )
        })
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn render_for_native_export(
        &mut self,
        canvas_width: u32,
        canvas_height: u32,
        layers: &[RenderLayer],
    ) -> Result<windows::Win32::Graphics::Direct3D12::ID3D12Resource, String> {
        // Keep the compositor target wgpu-owned. It is returned to COMMON by
        // render_impl, then the native bridge performs the cross-API copy.
        self.render_impl(canvas_width, canvas_height, layers, false, true)?;
        let (texture, _, _) = self
            .output_texture
            .as_ref()
            .ok_or_else(|| "native export render produced no output texture".to_string())?;
        let hal_texture = unsafe { texture.as_hal::<wgpu::hal::api::Dx12>() }
            .ok_or_else(|| "native export output is not a D3D12 texture".to_string())?;
        Ok(unsafe { hal_texture.raw_resource().clone() })
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn metal_device_ptr(&self) -> Result<*mut std::ffi::c_void, String> {
        use objc2::rc::Retained;

        let hal_device = unsafe { self.device.as_hal::<wgpu::hal::api::Metal>() }
            .ok_or_else(|| "wgpu 当前没有使用 Metal 后端".to_string())?;
        Ok(Retained::as_ptr(hal_device.raw_device()) as *mut std::ffi::c_void)
    }

    /// 将 CoreVideo 创建的 MTLTexture 包装成同一 Device 下的 wgpu Texture。
    /// 调用方必须确保关联的 CVPixelBuffer 在返回纹理使用结束前保持存活。
    #[cfg(target_os = "macos")]
    pub(crate) unsafe fn wrap_external_metal_texture(
        &self,
        metal_texture: *mut std::ffi::c_void,
        width: u32,
        height: u32,
        usage: wgpu::TextureUsages,
        initialized: bool,
    ) -> Result<wgpu::Texture, String> {
        use objc2::rc::Retained;
        use objc2::runtime::ProtocolObject;
        use objc2_metal::{MTLTexture, MTLTextureType};

        let raw = Retained::<ProtocolObject<dyn MTLTexture>>::retain(metal_texture.cast())
            .ok_or_else(|| "Metal 视频纹理为空".to_string())?;
        let hal_texture = unsafe {
            wgpu::hal::metal::Device::texture_from_raw(
                raw,
                wgpu::TextureFormat::Bgra8UnormSrgb,
                MTLTextureType::Type2D,
                1,
                1,
                wgpu::hal::CopyExtent {
                    width,
                    height,
                    depth: 1,
                },
                None,
            )
        };
        let descriptor = wgpu::TextureDescriptor {
            label: Some("CoreVideo Metal texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8UnormSrgb,
            usage,
            view_formats: &[],
        };
        Ok(unsafe {
            self.device
                .create_texture_from_hal::<wgpu::hal::api::Metal>(
                    hal_texture,
                    &descriptor,
                    if initialized {
                        wgpu::wgt::TextureUses::RESOURCE
                    } else {
                        wgpu::wgt::TextureUses::UNINITIALIZED
                    },
                )
        })
    }

    pub(crate) fn render_into_external_texture(
        &mut self,
        target: wgpu::Texture,
        canvas_width: u32,
        canvas_height: u32,
        layers: &[RenderLayer],
    ) -> Result<(), String> {
        let previous = self
            .output_texture
            .replace((target, canvas_width, canvas_height));
        let return_output_to_common = cfg!(target_os = "windows");
        let result = self
            .render_impl(
                canvas_width,
                canvas_height,
                layers,
                false,
                return_output_to_common,
            )
            .map(|_| ());
        if let Some((_texture, _, _)) = self.output_texture.take() {
            #[cfg(target_os = "windows")]
            _texture.destroy();
        }
        self.output_texture = previous;
        result
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn render_into_present_texture(
        &mut self,
        target: wgpu::Texture,
        canvas_width: u32,
        canvas_height: u32,
        layers: &[RenderLayer],
    ) -> Result<(), String> {
        let previous = self
            .output_texture
            .replace((target, canvas_width, canvas_height));
        let result = self
            .render_impl(canvas_width, canvas_height, layers, false, true)
            .map(|_| ());
        if let Some((texture, _, _)) = self.output_texture.take() {
            texture.destroy();
        }
        self.output_texture = previous;
        result
    }

    /// 注册一个外部输入纹理（macOS Metal / Windows D3D12）。
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn register_external_texture(
        &mut self,
        texture: wgpu::Texture,
        width: u32,
        height: u32,
    ) -> u32 {
        let texture_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(
            texture_id,
            TextureEntry {
                texture,
                width,
                height,
                #[cfg(target_os = "windows")]
                external: true,
            },
        );
        texture_id
    }

    /// 移除逐帧外部纹理。
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn unregister_external_texture(&mut self, texture_id: u32) {
        if let Some(_entry) = self.textures.remove(&texture_id) {
            #[cfg(target_os = "windows")]
            _entry.texture.destroy();
        }
    }

    /// 等待 GPU 完成所有已提交的工作（用于跨 API 同步）。
    #[cfg(target_os = "windows")]
    pub(crate) fn wait_for_gpu(&self) -> Result<(), String> {
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(std::time::Duration::from_secs(2)),
            })
            .map_err(|e| format!("GPU wait failed: {e}"))?;
        Ok(())
    }
}
