use std::collections::HashMap;
use std::mem::ManuallyDrop;

use windows::core::Interface;
use windows::Win32::Foundation::{CloseHandle, GENERIC_ALL};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11Device5, ID3D11DeviceContext, ID3D11DeviceContext4, ID3D11Fence,
    ID3D11Resource, ID3D11Texture2D, ID3D11VideoContext, ID3D11VideoDevice, ID3D11VideoProcessor,
    ID3D11VideoProcessorEnumerator, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
    D3D11_BIND_VIDEO_ENCODER, D3D11_FENCE_FLAG_SHARED, D3D11_RESOURCE_MISC_SHARED_NTHANDLE,
    D3D11_TEX2D_VPIV, D3D11_TEX2D_VPOV, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_ALPHA_FILL_MODE_OPAQUE,
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0, D3D11_VIDEO_PROCESSOR_STREAM,
    D3D11_VIDEO_USAGE_PLAYBACK_NORMAL, D3D11_VPIV_DIMENSION_TEXTURE2D,
    D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandAllocator, ID3D12CommandList, ID3D12CommandQueue, ID3D12Device, ID3D12Fence,
    ID3D12GraphicsCommandList, ID3D12Resource, D3D12_COMMAND_LIST_TYPE_DIRECT,
    D3D12_FENCE_FLAG_NONE, D3D12_RESOURCE_BARRIER_0, D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
    D3D12_RESOURCE_BARRIER_FLAG_NONE, D3D12_RESOURCE_BARRIER_TYPE_TRANSITION,
    D3D12_RESOURCE_STATE_COMMON, D3D12_RESOURCE_STATE_COPY_DEST, D3D12_RESOURCE_STATE_COPY_SOURCE,
    D3D12_RESOURCE_TRANSITION_BARRIER,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_RATIONAL,
    DXGI_SAMPLE_DESC,
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

fn transition_barrier(
    resource: &ID3D12Resource,
    state_before: windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_STATES,
    state_after: windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_STATES,
) -> windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_BARRIER {
    windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_BARRIER {
        Type: D3D12_RESOURCE_BARRIER_TYPE_TRANSITION,
        Flags: D3D12_RESOURCE_BARRIER_FLAG_NONE,
        Anonymous: D3D12_RESOURCE_BARRIER_0 {
            Transition: ManuallyDrop::new(D3D12_RESOURCE_TRANSITION_BARRIER {
                pResource: ManuallyDrop::new(Some(resource.clone())),
                Subresource: D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
                StateBefore: state_before,
                StateAfter: state_after,
            }),
        },
    }
}

unsafe fn release_barrier_resource(
    barrier: &mut windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_BARRIER,
) {
    // The Windows bindings model the D3D12 union members as ManuallyDrop.
    // Release the temporary COM reference after ResourceBarrier has consumed
    // the descriptor so the per-frame copy path does not leak references.
    let transition = (&mut barrier.Anonymous as *mut D3D12_RESOURCE_BARRIER_0)
        .cast::<D3D12_RESOURCE_TRANSITION_BARRIER>();
    let resource = &mut (*transition).pResource as *mut _;
    ManuallyDrop::drop(&mut *resource);
}

/// A BGRA texture allocated by the ordinary D3D11 device and opened by the
/// wgpu D3D12 device through an NT shared handle. No pixel data crosses the
/// CPU boundary.
pub(crate) struct NativeSharedTexture {
    d3d11: ID3D11Texture2D,
    processing: ID3D11Texture2D,
    d3d12: ID3D12Resource,
    format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
    width: u32,
    height: u32,
}

impl NativeSharedTexture {
    pub(crate) fn resource(&self) -> &ID3D12Resource {
        &self.d3d12
    }

    fn d3d11(&self) -> &ID3D11Texture2D {
        &self.d3d11
    }

    fn processing(&self) -> &ID3D11Texture2D {
        &self.processing
    }
}

/// Holds one shared texture checked out by wgpu.
///
/// `render_into_external_texture` waits for the wgpu submission before this
/// lease is finished. That CPU-side completion point is the ownership handoff
/// back to the native D3D11 path. Do not enqueue a D3D12 signal followed by a
/// D3D11 context wait here: NVIDIA drivers can stop making progress on this
/// cross-API asynchronous return path after a few frames.
pub(crate) struct NativeTextureLease {
    resource: ID3D12Resource,
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
        // The caller has already waited for the wgpu submission that used the
        // resource. Keeping the handoff CPU-ordered avoids the D3D11/D3D12
        // shared-fence return sequence that can deadlock on NVIDIA/Windows.
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
    copy_allocator: ID3D12CommandAllocator,
    copy_list: ID3D12GraphicsCommandList,
    copy_fence: ID3D12Fence,
    next_copy_fence_value: u64,
    fence11: ID3D11Fence,
    fence12: ID3D12Fence,
    next_fence_value: u64,
    blit_count: u64,
    video_processors: HashMap<VideoProcessorKey, VideoProcessorState>,
    reusable_bgra: HashMap<(u32, u32, i32), Vec<NativeSharedTexture>>,
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

        let copy_allocator: ID3D12CommandAllocator =
            unsafe { d3d12_device.CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT) }
                .map_err(|error| format!("native D3D12 copy allocator creation failed: {error}"))?;
        let copy_list: ID3D12GraphicsCommandList = unsafe {
            d3d12_device.CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, &copy_allocator, None)
        }
        .map_err(|error| format!("native D3D12 copy list creation failed: {error}"))?;
        unsafe { copy_list.Close() }
            .map_err(|error| format!("native D3D12 copy list initialization failed: {error}"))?;
        let copy_fence: ID3D12Fence = unsafe { d3d12_device.CreateFence(0, D3D12_FENCE_FLAG_NONE) }
            .map_err(|error| format!("native D3D12 copy fence creation failed: {error}"))?;

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
        crate::logging::write(
            "[Export:WinGPU] native bridge=d3d11-video-processor,shared-nt-handle,cpu-fence-completion",
        );
        Ok(Self {
            device: device.clone(),
            context: context.clone(),
            context4,
            video_device,
            video_context,
            d3d12_device: d3d12_device.clone(),
            d3d12_queue: d3d12_queue.clone(),
            copy_allocator,
            copy_list,
            copy_fence,
            next_copy_fence_value: 1,
            fence11,
            fence12,
            next_fence_value: 1,
            blit_count: 0,
            video_processors: HashMap::new(),
            reusable_bgra: HashMap::new(),
        })
    }

    pub(crate) fn decode_to_bgra_for_export(
        &mut self,
        frame: &DecodedFrame,
    ) -> Result<NativeSharedTexture, String> {
        crate::logging::write_once("[Export:WinGPU:NativeBridge] create=begin");
        let output =
            self.take_shared_bgra_texture(frame.width, frame.height, DXGI_FORMAT_B8G8R8A8_UNORM)?;
        crate::logging::write_once("[Export:WinGPU:NativeBridge] create=complete");
        let result = match &frame.surface {
            DecodedSurface::D3d11(texture) => self
                .blit(
                    texture,
                    frame.array_slice,
                    frame.width,
                    frame.height,
                    output.processing(),
                    output.width,
                    output.height,
                    true,
                )
                .and_then(|()| self.copy_processing_to_shared(&output)),
            DecodedSurface::D3d12 { .. } => Err(
                "native D3D11 bridge received a D3D12 decoder surface; use the D3D11 manager"
                    .to_string(),
            ),
        };
        if let Err(error) = result {
            self.recycle_bgra_texture(output);
            return Err(error);
        }
        Ok(output)
    }

    pub(crate) fn copy_wgpu_to_shared(
        &mut self,
        source: &ID3D12Resource,
        width: u32,
        height: u32,
    ) -> Result<NativeSharedTexture, String> {
        let output = self.take_shared_bgra_texture(width, height, DXGI_FORMAT_R8G8B8A8_UNORM)?;
        self.copy_d3d12_resource(source, output.resource(), width, height)?;
        Ok(output)
    }

    pub(crate) fn wrap_for_wgpu(
        &mut self,
        texture: &NativeSharedTexture,
    ) -> Result<NativeTextureLease, String> {
        Ok(NativeTextureLease {
            resource: texture.d3d12.clone(),
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
            true,
        )?;
        self.recycle_bgra_texture(input);
        Ok(output)
    }

    pub(crate) fn recycle_bgra_texture(&mut self, texture: NativeSharedTexture) {
        let pools = &mut self.reusable_bgra;
        let pool = pools
            .entry((texture.width, texture.height, texture.format.0))
            .or_default();
        if pool.len() < MAX_REUSABLE_BGRA_PER_SIZE {
            pool.push(texture);
        }
    }

    fn take_shared_bgra_texture(
        &mut self,
        width: u32,
        height: u32,
        format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
    ) -> Result<NativeSharedTexture, String> {
        let pools = &mut self.reusable_bgra;
        if let Some(texture) = pools
            .get_mut(&(width, height, format.0))
            .and_then(|pool| pool.pop())
        {
            return Ok(texture);
        }
        let processing = self.create_texture(
            width,
            height,
            DXGI_FORMAT_B8G8R8A8_UNORM,
            D3D11_BIND_RENDER_TARGET.0 as u32,
        )?;
        crate::logging::write_once("[Export:WinGPU:NativeBridge] processing=created");
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
            // A video-processor input view does not require render or shader
            // binding flags. This is the shape used by the reference bridge.
            BindFlags: 0,
            CPUAccessFlags: 0,
            MiscFlags: D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0 as u32,
        };
        let mut d3d11 = None;
        unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut d3d11)) }
            .map_err(|error| format!("native shared BGRA texture creation failed: {error}"))?;
        crate::logging::write_once("[Export:WinGPU:NativeBridge] shared=created");
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
            processing,
            d3d12,
            format,
            width,
            height,
        })
    }

    fn copy_d3d12_resource(
        &mut self,
        source: &ID3D12Resource,
        destination: &ID3D12Resource,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        let source_desc = unsafe { source.GetDesc() };
        let destination_desc = unsafe { destination.GetDesc() };
        if source_desc.Dimension
            != windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_DIMENSION_TEXTURE2D
            || destination_desc.Dimension
                != windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_DIMENSION_TEXTURE2D
            || source_desc.Width != width as u64
            || destination_desc.Width != width as u64
            || source_desc.Height != height
            || destination_desc.Height != height
            || source_desc.Format
                != windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM
                && source_desc.Format
                    != windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM_SRGB
            || destination_desc.Format
                != windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM
        {
            return Err(format!(
                "native D3D12 RGBA8 bridge metadata mismatch: source={}x{} format={} destination={}x{} format={}",
                source_desc.Width,
                source_desc.Height,
                source_desc.Format.0,
                destination_desc.Width,
                destination_desc.Height,
                destination_desc.Format.0,
            ));
        }

        unsafe { self.copy_allocator.Reset() }
            .map_err(|error| format!("native D3D12 copy allocator reset failed: {error}"))?;
        unsafe { self.copy_list.Reset(&self.copy_allocator, None) }
            .map_err(|error| format!("native D3D12 copy list reset failed: {error}"))?;

        let mut before = [
            transition_barrier(
                source,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_COPY_SOURCE,
            ),
            transition_barrier(
                destination,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_COPY_DEST,
            ),
        ];
        unsafe { self.copy_list.ResourceBarrier(&before) };
        unsafe { self.copy_list.CopyResource(destination, source) };
        let mut after = [
            transition_barrier(
                source,
                D3D12_RESOURCE_STATE_COPY_SOURCE,
                D3D12_RESOURCE_STATE_COMMON,
            ),
            transition_barrier(
                destination,
                D3D12_RESOURCE_STATE_COPY_DEST,
                D3D12_RESOURCE_STATE_COMMON,
            ),
        ];
        unsafe { self.copy_list.ResourceBarrier(&after) };
        unsafe { self.copy_list.Close() }
            .map_err(|error| format!("native D3D12 copy list close failed: {error}"))?;
        let command_list: ID3D12CommandList = self
            .copy_list
            .cast()
            .map_err(|error| format!("native D3D12 copy list cast failed: {error}"))?;
        unsafe { self.d3d12_queue.ExecuteCommandLists(&[Some(command_list)]) };
        let fence_value = self.next_copy_fence_value;
        self.next_copy_fence_value = self.next_copy_fence_value.saturating_add(1);
        unsafe { self.d3d12_queue.Signal(&self.copy_fence, fence_value) }
            .map_err(|error| format!("native D3D12 copy fence signal failed: {error}"))?;
        self.wait_for_d3d12_copy(fence_value)?;
        unsafe {
            for barrier in &mut before {
                release_barrier_resource(barrier);
            }
            for barrier in &mut after {
                release_barrier_resource(barrier);
            }
        }
        Ok(())
    }

    fn wait_for_d3d12_copy(&self, fence_value: u64) -> Result<(), String> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let complete = unsafe { self.copy_fence.GetCompletedValue() };
            if complete >= fence_value {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err(format!(
                    "native D3D12 RGBA8 bridge copy timed out at {complete}/{fence_value}"
                ));
            }
            std::thread::yield_now();
        }
    }

    fn blit(
        &mut self,
        input: &ID3D11Texture2D,
        input_subresource: u32,
        input_width: u32,
        input_height: u32,
        output: &ID3D11Texture2D,
        output_width: u32,
        output_height: u32,
        wait_for_completion: bool,
    ) -> Result<(), String> {
        let blit_id = self.blit_count;
        self.blit_count = self.blit_count.saturating_add(1);
        let log_phase = |phase: &str| {
            if blit_id < 4 {
                crate::logging::write(&format!(
                    "[Export:WinGPU:NativeBlit] id={} phase={phase} wait={wait_for_completion}",
                    blit_id + 1
                ));
            }
        };
        log_phase("start");
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
        log_phase("video-processor-returned");
        unsafe { ManuallyDrop::drop(&mut stream.pInputSurface) };
        result.map_err(|error| format!("native video processor blit failed: {error}"))?;
        if wait_for_completion {
            log_phase("before-fence");
            self.wait_for_native_completion()?;
            log_phase("fence-complete");
        }
        Ok(())
    }

    fn copy_processing_to_shared(&mut self, texture: &NativeSharedTexture) -> Result<(), String> {
        unsafe {
            self.context
                .CopyResource(texture.d3d11(), texture.processing());
        }
        self.wait_for_native_completion()
    }

    fn wait_for_native_completion(&mut self) -> Result<(), String> {
        let fence_value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.saturating_add(1);
        unsafe { self.context4.Signal(&self.fence11, fence_value) }
            .map_err(|error| format!("native D3D11 fence signal failed: {error}"))?;
        unsafe { self.context.Flush() };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let complete = unsafe { self.fence12.GetCompletedValue() };
            if complete >= fence_value {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err(format!(
                    "native D3D11 fence wait timed out at {complete}/{fence_value}"
                ));
            }
            std::thread::yield_now();
        }
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
