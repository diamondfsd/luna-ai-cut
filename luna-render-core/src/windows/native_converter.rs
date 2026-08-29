use std::collections::HashMap;
use std::mem::ManuallyDrop;

use windows::core::{Interface, BOOL};
use windows::Win32::Foundation::{CloseHandle, GENERIC_ALL};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11Device5, ID3D11DeviceContext, ID3D11DeviceContext4, ID3D11Fence,
    ID3D11Resource, ID3D11Texture2D, ID3D11VideoContext, ID3D11VideoDevice, ID3D11VideoProcessor,
    ID3D11VideoProcessorEnumerator, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
    D3D11_BIND_VIDEO_ENCODER, D3D11_FENCE_FLAG_SHARED, D3D11_QUERY_DESC, D3D11_QUERY_EVENT,
    D3D11_RESOURCE_MISC_SHARED, D3D11_RESOURCE_MISC_SHARED_NTHANDLE, D3D11_TEX2D_VPIV,
    D3D11_TEX2D_VPOV, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_ALPHA_FILL_MODE_OPAQUE,
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0, D3D11_VIDEO_PROCESSOR_STREAM,
    D3D11_VIDEO_USAGE_PLAYBACK_NORMAL, D3D11_VPIV_DIMENSION_TEXTURE2D,
    D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandQueue, ID3D12Device, ID3D12Fence, ID3D12Resource,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIResource1, DXGI_SHARED_RESOURCE_READ, DXGI_SHARED_RESOURCE_WRITE,
};

use super::decoder::{DecodedFrame, DecodedSurface};

const MAX_REUSABLE_BGRA_PER_SIZE: usize = 4;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct VideoProcessorKey {
    input_width: u32,
    input_height: u32,
    output_width: u32,
    output_height: u32,
}

struct VideoProcessorState {
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
}

/// A BGRA texture allocated by the ordinary D3D11 device and opened by the
/// wgpu D3D12 device through an NT shared handle. No pixel data crosses the
/// CPU boundary.
pub(crate) struct NativeSharedTexture {
    d3d11: ID3D11Texture2D,
    d3d12: ID3D12Resource,
    width: u32,
    height: u32,
    ready_value: u64,
}

impl NativeSharedTexture {
    pub(crate) fn resource(&self) -> &ID3D12Resource {
        &self.d3d12
    }

    fn d3d11(&self) -> &ID3D11Texture2D {
        &self.d3d11
    }
}

/// Holds one shared texture checked out by wgpu. The D3D12 queue signals the
/// shared fence after the wgpu submission; D3D11 waits on that fence before it
/// reuses the texture for the next video-process operation.
pub(crate) struct NativeTextureLease {
    resource: ID3D12Resource,
    context: ID3D11DeviceContext4,
    fence11: ID3D11Fence,
    fence12: ID3D12Fence,
    queue: ID3D12CommandQueue,
    release_value: u64,
    returned: bool,
}

impl NativeTextureLease {
    pub(crate) fn resource(&self) -> &ID3D12Resource {
        &self.resource
    }

    fn return_to_d3d11(&mut self) -> Result<(), String> {
        if self.returned {
            return Ok(());
        }
        unsafe { self.queue.Signal(&self.fence12, self.release_value) }
            .map_err(|error| format!("native D3D12 queue signal failed: {error}"))?;
        unsafe { self.context.Wait(&self.fence11, self.release_value) }
            .map_err(|error| format!("native D3D11 queue wait failed: {error}"))?;
        unsafe { self.context.Flush() };
        self.returned = true;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<(), String> {
        self.return_to_d3d11()
    }
}

impl Drop for NativeTextureLease {
    fn drop(&mut self) {
        if !self.returned {
            if let Err(error) = self.return_to_d3d11() {
                crate::logging::write(&format!(
                    "[Export:WinGPU] native shared texture cleanup failed: {error}"
                ));
            }
        }
    }
}

pub(crate) struct NativeVideoConverter {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    context4: ID3D11DeviceContext4,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    d3d12_device: ID3D12Device,
    d3d12_queue: ID3D12CommandQueue,
    fence11: ID3D11Fence,
    fence12: ID3D12Fence,
    next_fence_value: u64,
    completion_query: windows::Win32::Graphics::Direct3D11::ID3D11Query,
    last_ready_value: Option<u64>,
    video_processors: HashMap<VideoProcessorKey, VideoProcessorState>,
    reusable_bgra: HashMap<(u32, u32), Vec<NativeSharedTexture>>,
}

impl NativeVideoConverter {
    pub(crate) fn new(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        d3d12_device: &ID3D12Device,
        d3d12_queue: &ID3D12CommandQueue,
    ) -> Result<Self, String> {
        let video_device = device
            .cast::<ID3D11VideoDevice>()
            .map_err(|error| format!("native D3D11 video device unavailable: {error}"))?;
        let video_context = context
            .cast::<ID3D11VideoContext>()
            .map_err(|error| format!("native D3D11 video context unavailable: {error}"))?;
        let context4 = context
            .cast::<ID3D11DeviceContext4>()
            .map_err(|error| format!("native D3D11 fence synchronization unavailable: {error}"))?;

        let device5 = device
            .cast::<ID3D11Device5>()
            .map_err(|error| format!("native D3D11 shared fence unavailable: {error}"))?;
        let mut fence11 = None;
        unsafe { device5.CreateFence::<ID3D11Fence>(0, D3D11_FENCE_FLAG_SHARED, &mut fence11) }
            .map_err(|error| format!("native D3D11 fence creation failed: {error}"))?;
        let fence11 = fence11.ok_or_else(|| "native D3D11 fence was not returned".to_string())?;
        let fence_handle = unsafe {
            fence11.CreateSharedHandle(None, GENERIC_ALL.0, windows::core::PCWSTR::null())
        }
        .map_err(|error| format!("native D3D11 fence handle creation failed: {error}"))?;
        let mut fence12 = None;
        let open_result = unsafe { d3d12_device.OpenSharedHandle(fence_handle, &mut fence12) };
        let _ = unsafe { CloseHandle(fence_handle) };
        open_result.map_err(|error| format!("native D3D12 fence import failed: {error}"))?;
        let fence12 = fence12.ok_or_else(|| "native D3D12 fence was not returned".to_string())?;

        let query_desc = D3D11_QUERY_DESC {
            Query: D3D11_QUERY_EVENT,
            MiscFlags: 0,
        };
        let mut completion_query = None;
        unsafe { device.CreateQuery(&query_desc, Some(&mut completion_query)) }
            .map_err(|error| format!("native D3D11 completion query creation failed: {error}"))?;
        let completion_query = completion_query
            .ok_or_else(|| "native D3D11 completion query was not returned".to_string())?;

        crate::logging::write(
            "[Export:WinGPU] native bridge=d3d11-video-processor,shared-nt-handle,d3d12-fence",
        );
        Ok(Self {
            device: device.clone(),
            context: context.clone(),
            context4,
            video_device,
            video_context,
            d3d12_device: d3d12_device.clone(),
            d3d12_queue: d3d12_queue.clone(),
            fence11,
            fence12,
            next_fence_value: 1,
            completion_query,
            last_ready_value: None,
            video_processors: HashMap::new(),
            reusable_bgra: HashMap::new(),
        })
    }

    pub(crate) fn decode_to_bgra_for_export(
        &mut self,
        frame: &DecodedFrame,
    ) -> Result<NativeSharedTexture, String> {
        let mut output = self.take_shared_bgra_texture(frame.width, frame.height)?;
        let result = match &frame.surface {
            DecodedSurface::D3d11(texture) => self.blit(
                texture,
                frame.array_slice,
                frame.width,
                frame.height,
                output.d3d11(),
                output.width,
                output.height,
                true,
                false,
            ),
            DecodedSurface::D3d12 { .. } => Err(
                "native D3D11 bridge received a D3D12 decoder surface; use the D3D11 manager"
                    .to_string(),
            ),
        };
        if let Err(error) = result {
            self.last_ready_value = None;
            self.recycle_bgra_texture(output);
            return Err(error);
        }
        self.mark_ready(&mut output);
        Ok(output)
    }

    pub(crate) fn create_composition_target(
        &mut self,
        width: u32,
        height: u32,
    ) -> Result<NativeSharedTexture, String> {
        self.take_shared_bgra_texture(width, height)
    }

    pub(crate) fn wrap_for_wgpu(
        &mut self,
        texture: &NativeSharedTexture,
    ) -> Result<NativeTextureLease, String> {
        if texture.ready_value != 0 {
            unsafe { self.d3d12_queue.Wait(&self.fence12, texture.ready_value) }
                .map_err(|error| format!("native D3D12 queue wait failed: {error}"))?;
        }
        let release_value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.saturating_add(1);
        Ok(NativeTextureLease {
            resource: texture.d3d12.clone(),
            context: self.context4.clone(),
            fence11: self.fence11.clone(),
            fence12: self.fence12.clone(),
            queue: self.d3d12_queue.clone(),
            release_value,
            returned: false,
        })
    }

    pub(crate) fn bgra_to_nv12(
        &mut self,
        input: NativeSharedTexture,
        width: u32,
        height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err("native NV12 conversion requires even dimensions".to_string());
        }
        let output = self.create_texture(
            width,
            height,
            DXGI_FORMAT_NV12,
            (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_VIDEO_ENCODER.0)
                as u32,
        )?;
        self.blit(
            input.d3d11(),
            0,
            width,
            height,
            &output,
            width,
            height,
            false,
            true,
        )?;
        self.recycle_bgra_texture(input);
        Ok(output)
    }

    pub(crate) fn recycle_bgra_texture(&mut self, mut texture: NativeSharedTexture) {
        texture.ready_value = 0;
        let pool = self
            .reusable_bgra
            .entry((texture.width, texture.height))
            .or_default();
        if pool.len() < MAX_REUSABLE_BGRA_PER_SIZE {
            pool.push(texture);
        }
    }

    fn take_shared_bgra_texture(
        &mut self,
        width: u32,
        height: u32,
    ) -> Result<NativeSharedTexture, String> {
        if let Some(texture) = self
            .reusable_bgra
            .get_mut(&(width, height))
            .and_then(|pool| pool.pop())
        {
            return Ok(texture);
        }
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            // wgpu's D3D12 queue cannot acquire an IDXGIKeyedMutex. The
            // shared fence below is the ownership transfer mechanism.
            MiscFlags: (D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0 | D3D11_RESOURCE_MISC_SHARED.0)
                as u32,
        };
        let mut d3d11 = None;
        unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut d3d11)) }
            .map_err(|error| format!("native shared BGRA texture creation failed: {error}"))?;
        let d3d11 =
            d3d11.ok_or_else(|| "native shared BGRA texture was not returned".to_string())?;
        let resource11 = d3d11
            .cast::<ID3D11Resource>()
            .map_err(|error| format!("native shared texture resource query failed: {error}"))?;
        let resource1 = resource11
            .cast::<IDXGIResource1>()
            .map_err(|error| format!("native shared texture DXGI query failed: {error}"))?;
        let handle = unsafe {
            resource1.CreateSharedHandle(
                None,
                (DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE).0,
                windows::core::PCWSTR::null(),
            )
        }
        .map_err(|error| format!("native shared texture handle creation failed: {error}"))?;
        let mut d3d12 = None;
        let open_result = unsafe { self.d3d12_device.OpenSharedHandle(handle, &mut d3d12) };
        let _ = unsafe { CloseHandle(handle) };
        open_result
            .map_err(|error| format!("native D3D12 shared texture import failed: {error}"))?;
        let d3d12 =
            d3d12.ok_or_else(|| "native D3D12 shared texture was not returned".to_string())?;
        Ok(NativeSharedTexture {
            d3d11,
            d3d12,
            width,
            height,
            ready_value: 0,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn blit(
        &mut self,
        input: &ID3D11Texture2D,
        input_subresource: u32,
        input_width: u32,
        input_height: u32,
        output: &ID3D11Texture2D,
        output_width: u32,
        output_height: u32,
        signal_d3d12: bool,
        wait_for_completion: bool,
    ) -> Result<(), String> {
        let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: DXGI_RATIONAL {
                Numerator: 30,
                Denominator: 1,
            },
            InputWidth: input_width,
            InputHeight: input_height,
            OutputFrameRate: DXGI_RATIONAL {
                Numerator: 30,
                Denominator: 1,
            },
            OutputWidth: output_width,
            OutputHeight: output_height,
            Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
        };
        let key = VideoProcessorKey {
            input_width,
            input_height,
            output_width,
            output_height,
        };
        let (enumerator, processor) = if let Some(state) = self.video_processors.get(&key) {
            (state.enumerator.clone(), state.processor.clone())
        } else {
            let enumerator = unsafe { self.video_device.CreateVideoProcessorEnumerator(&content) }
                .map_err(|error| {
                    format!("native video processor enumerator creation failed: {error}")
                })?;
            let processor = unsafe { self.video_device.CreateVideoProcessor(&enumerator, 0) }
                .map_err(|error| format!("native video processor creation failed: {error}"))?;
            unsafe {
                self.video_context.VideoProcessorSetOutputAlphaFillMode(
                    &processor,
                    D3D11_VIDEO_PROCESSOR_ALPHA_FILL_MODE_OPAQUE,
                    0,
                );
            }
            self.video_processors.insert(
                key,
                VideoProcessorState {
                    enumerator: enumerator.clone(),
                    processor: processor.clone(),
                },
            );
            (enumerator, processor)
        };

        let input_resource = input
            .cast::<ID3D11Resource>()
            .map_err(|error| format!("native video input resource query failed: {error}"))?;
        let input_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPIV {
                    MipSlice: 0,
                    ArraySlice: input_subresource,
                },
            },
        };
        let mut input_view = None;
        unsafe {
            self.video_device.CreateVideoProcessorInputView(
                &input_resource,
                &enumerator,
                &input_desc,
                Some(&mut input_view),
            )
        }
        .map_err(|error| format!("native video input view creation failed: {error}"))?;
        let input_view =
            input_view.ok_or_else(|| "native video input view was not returned".to_string())?;

        let output_resource = output
            .cast::<ID3D11Resource>()
            .map_err(|error| format!("native video output resource query failed: {error}"))?;
        let output_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
            },
        };
        let mut output_view = None;
        unsafe {
            self.video_device.CreateVideoProcessorOutputView(
                &output_resource,
                &enumerator,
                &output_desc,
                Some(&mut output_view),
            )
        }
        .map_err(|error| format!("native video output view creation failed: {error}"))?;
        let output_view =
            output_view.ok_or_else(|| "native video output view was not returned".to_string())?;

        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: ManuallyDrop::new(Some(input_view)),
            ..Default::default()
        };
        let result = unsafe {
            self.video_context.VideoProcessorBlt(
                &processor,
                &output_view,
                0,
                std::slice::from_ref(&stream),
            )
        };
        unsafe { ManuallyDrop::drop(&mut stream.pInputSurface) };
        result.map_err(|error| format!("native video processor blit failed: {error}"))?;

        if signal_d3d12 {
            let ready_value = self.next_fence_value;
            self.next_fence_value = self.next_fence_value.saturating_add(1);
            unsafe { self.context4.Signal(&self.fence11, ready_value) }
                .map_err(|error| format!("native D3D11 ready fence signal failed: {error}"))?;
            unsafe { self.context.Flush() };
            // The caller assigns this value to the shared texture immediately
            // after this function returns through `mark_ready`.
            self.last_ready_value = Some(ready_value);
        }
        if wait_for_completion {
            self.wait_for_blit()?;
        }
        Ok(())
    }

    fn wait_for_blit(&self) -> Result<(), String> {
        unsafe {
            self.context.End(&self.completion_query);
            self.context.Flush();
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let mut complete = BOOL::default();
            unsafe {
                self.context.GetData(
                    &self.completion_query,
                    Some((&mut complete as *mut BOOL).cast()),
                    std::mem::size_of::<BOOL>() as u32,
                    windows::Win32::Graphics::Direct3D11::D3D11_ASYNC_GETDATA_DONOTFLUSH.0 as u32,
                )
            }
            .map_err(|error| format!("native video processor wait failed: {error}"))?;
            if complete.as_bool() {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err("native video processor wait timed out".to_string());
            }
            std::thread::yield_now();
        }
    }

    fn mark_ready(&mut self, texture: &mut NativeSharedTexture) {
        texture.ready_value = self.last_ready_value.take().unwrap_or(0);
    }

    fn create_texture(
        &self,
        width: u32,
        height: u32,
        format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
        bind_flags: u32,
    ) -> Result<ID3D11Texture2D, String> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: bind_flags,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut texture = None;
        unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut texture)) }
            .map_err(|error| format!("native video texture creation failed: {error}"))?;
        texture.ok_or_else(|| "native video texture was not returned".to_string())
    }
}
