use std::collections::HashMap;
use std::mem::{size_of, ManuallyDrop};
use std::time::{Duration, Instant};

use windows::core::{Interface, BOOL};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Query, ID3D11Resource, ID3D11Texture2D,
    ID3D11VideoContext, ID3D11VideoDevice, ID3D11VideoProcessor, ID3D11VideoProcessorEnumerator,
    D3D11_ASYNC_GETDATA_DONOTFLUSH, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
    D3D11_QUERY_DESC, D3D11_QUERY_EVENT, D3D11_TEX2D_VPIV, D3D11_TEX2D_VPOV, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
    D3D11_VIDEO_PROCESSOR_ALPHA_FILL_MODE_OPAQUE, D3D11_VIDEO_PROCESSOR_CONTENT_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_STREAM, D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    D3D11_VPIV_DIMENSION_TEXTURE2D, D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Direct3D11on12::ID3D11On12Device2;
use windows::Win32::Graphics::Direct3D11on12::D3D11_RESOURCE_FLAGS;
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandQueue, ID3D12Device, ID3D12Fence, ID3D12Resource, D3D12_FENCE_FLAG_NONE,
    D3D12_RESOURCE_STATE_COMMON,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
};
use windows::Win32::Media::MediaFoundation::IMFD3D12SynchronizationObjectCommands;

use super::decoder::{DecodedFrame, DecodedSurface};

pub(crate) struct VideoConverter {
    device: ID3D11Device,
    d3d12_device: ID3D12Device,
    context: ID3D11DeviceContext,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    d3d11on12: ID3D11On12Device2,
    interop_queue: ID3D12CommandQueue,
    wgpu_queue: ID3D12CommandQueue,
    fence: ID3D12Fence,
    next_fence_value: u64,
    completion_query: ID3D11Query,
    /// 视频尺寸通常在整个导出期间保持不变。缓存处理器可避免每帧重复创建
    /// D3D11 视频处理器和枚举器。
    video_processors: HashMap<VideoProcessorKey, VideoProcessorState>,
    /// 导出路径在每帧完成跨 API 交接后才归还这些纹理，因而可以安全复用。
    reusable_bgra: HashMap<(u32, u32), Vec<ID3D11Texture2D>>,
}

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

struct D3d12DecodedTextureLease {
    texture: ID3D11Texture2D,
    resource: ID3D11Resource,
    synchronization: IMFD3D12SynchronizationObjectCommands,
    d3d11on12: ID3D11On12Device2,
    context: ID3D11DeviceContext,
    interop_queue: ID3D12CommandQueue,
    released: bool,
}

impl D3d12DecodedTextureLease {
    fn new(
        resource: &ID3D12Resource,
        synchronization: &IMFD3D12SynchronizationObjectCommands,
        d3d11on12: &ID3D11On12Device2,
        context: &ID3D11DeviceContext,
        interop_queue: &ID3D12CommandQueue,
    ) -> Result<Self, String> {
        unsafe { synchronization.EnqueueResourceReadyWait(interop_queue) }
            .map_err(|error| format!("无法等待 D3D12 解码画面: {error}"))?;

        let flags = D3D11_RESOURCE_FLAGS {
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            ..Default::default()
        };
        let mut texture: Option<ID3D11Texture2D> = None;
        unsafe {
            d3d11on12.CreateWrappedResource(
                resource,
                &flags,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_COMMON,
                &mut texture,
            )
        }
        .map_err(|error| format!("无法包装 D3D12 解码画面: {error}"))?;
        let texture = texture.ok_or_else(|| "D3D12 解码画面包装后为空".to_string())?;
        let resource11 = texture
            .cast::<ID3D11Resource>()
            .map_err(|error| format!("无法取得包装后的 D3D11 解码画面: {error}"))?;
        let resources = [Some(resource11.clone())];
        unsafe { d3d11on12.AcquireWrappedResources(&resources) };

        Ok(Self {
            texture,
            resource: resource11,
            synchronization: synchronization.clone(),
            d3d11on12: d3d11on12.clone(),
            context: context.clone(),
            interop_queue: interop_queue.clone(),
            released: false,
        })
    }

    fn texture(&self) -> &ID3D11Texture2D {
        &self.texture
    }

    fn finish(&mut self) -> Result<(), String> {
        if self.released {
            return Ok(());
        }
        let resources = [Some(self.resource.clone())];
        unsafe { self.d3d11on12.ReleaseWrappedResources(&resources) };
        unsafe { self.context.Flush() };
        unsafe {
            self.synchronization
                .EnqueueResourceRelease(&self.interop_queue)
        }
        .map_err(|error| format!("无法释放 D3D12 解码画面: {error}"))?;
        self.released = true;
        Ok(())
    }
}

impl Drop for D3d12DecodedTextureLease {
    fn drop(&mut self) {
        if !self.released {
            if let Err(error) = self.finish() {
                crate::logging::write(&format!(
                    "[Export:WinGPU] D3D12 decoder surface cleanup failed: {error}"
                ));
            }
        }
    }
}

const MAX_REUSABLE_BGRA_PER_SIZE: usize = 4;

pub(crate) struct D3d12TextureLease {
    resource12: Option<ID3D12Resource>,
    resource11: ID3D11Resource,
    d3d11on12: ID3D11On12Device2,
    wgpu_queue: ID3D12CommandQueue,
    fence: ID3D12Fence,
    release_fence_value: u64,
    release_signal_submitted: bool,
    returned: bool,
}

impl D3d12TextureLease {
    pub(crate) fn resource(&self) -> &ID3D12Resource {
        self.resource12
            .as_ref()
            .expect("D3D12 lease already returned")
    }

    fn signal_d3d12_work(&mut self) -> Result<(), String> {
        if self.release_signal_submitted {
            return Ok(());
        }
        // Signal after the wgpu submission so D3D11On12 can wait before it
        // consumes the returned resource again.
        unsafe {
            self.wgpu_queue
                .Signal(&self.fence, self.release_fence_value)
        }
        .map_err(|error| format!("无法同步合成画面: {error}"))?;
        self.release_signal_submitted = true;
        Ok(())
    }

    fn return_to_d3d11(&mut self) -> Result<(), String> {
        self.signal_d3d12_work()?;
        let values = [self.release_fence_value];
        let fences = [Some(self.fence.clone())];
        unsafe {
            self.d3d11on12.ReturnUnderlyingResource(
                &self.resource11,
                1,
                values.as_ptr(),
                fences.as_ptr(),
            )
        }
        .map_err(|error| format!("无法归还合成画面: {error}"))?;
        self.resource12.take();
        self.returned = true;
        Ok(())
    }

    /// 在 wgpu 已向同一队列提交命令后调用。Signal 排在该提交之后，
    /// ReturnUnderlyingResource 会让后续 D3D11 工作等待这个 fence。
    pub(crate) fn finish(mut self) -> Result<(), String> {
        self.return_to_d3d11()
    }
}

impl Drop for D3d12TextureLease {
    fn drop(&mut self) {
        if self.returned {
            return;
        }
        // UnwrapUnderlyingResource itself can enqueue D3D12 work. Even an
        // error path must therefore return with a fence, never with NumSync=0.
        if let Err(error) = self.return_to_d3d11() {
            crate::logging::write(&format!(
                "[Export:WinGPU] D3D12 lease cleanup failed; resource kept checked out: {error}"
            ));
        }
    }
}

impl VideoConverter {
    pub(crate) fn new(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        d3d11on12: &ID3D11On12Device2,
        d3d12_device: &ID3D12Device,
        interop_queue: &ID3D12CommandQueue,
        wgpu_queue: &ID3D12CommandQueue,
    ) -> Result<Self, String> {
        let video_device = device
            .cast::<ID3D11VideoDevice>()
            .map_err(|error| format!("当前显卡不支持视频颜色转换: {error}"))?;
        let video_context = context
            .cast::<ID3D11VideoContext>()
            .map_err(|error| format!("当前显卡无法创建视频处理队列: {error}"))?;
        let fence = unsafe { d3d12_device.CreateFence(0, D3D12_FENCE_FLAG_NONE) }
            .map_err(|error| format!("无法创建显卡同步对象: {error}"))?;
        let query_desc = D3D11_QUERY_DESC {
            Query: D3D11_QUERY_EVENT,
            MiscFlags: 0,
        };
        let mut completion_query = None;
        unsafe { device.CreateQuery(&query_desc, Some(&mut completion_query)) }
            .map_err(|error| format!("无法创建视频转换同步对象: {error}"))?;
        let completion_query =
            completion_query.ok_or_else(|| "视频转换同步对象创建后为空".to_string())?;
        Ok(Self {
            device: device.clone(),
            d3d12_device: d3d12_device.clone(),
            context: context.clone(),
            video_device,
            video_context,
            d3d11on12: d3d11on12.clone(),
            interop_queue: interop_queue.clone(),
            wgpu_queue: wgpu_queue.clone(),
            fence,
            next_fence_value: 1,
            completion_query,
            video_processors: HashMap::new(),
            reusable_bgra: HashMap::new(),
        })
    }

    /// 导出路径使用的 BGRA 纹理。调用方必须在对应的 D3D12 lease 归还后
    /// 调用 `recycle_bgra_texture`，这样下一帧可以复用同一张显卡纹理。
    pub(crate) fn decode_to_bgra_for_export(
        &mut self,
        frame: &DecodedFrame,
    ) -> Result<ID3D11Texture2D, String> {
        self.decode_to_bgra_for_export_inner(frame, false)
    }

    pub(crate) fn decode_to_bgra_for_export_synchronized(
        &mut self,
        frame: &DecodedFrame,
    ) -> Result<ID3D11Texture2D, String> {
        self.decode_to_bgra_for_export_inner(frame, true)
    }

    fn decode_to_bgra_for_export_inner(
        &mut self,
        frame: &DecodedFrame,
        wait_for_completion: bool,
    ) -> Result<ID3D11Texture2D, String> {
        let output = self.take_bgra_texture(frame.width, frame.height)?;
        if let Err(error) = self.blit_decoded_surface(
            frame,
            &output,
            frame.width,
            frame.height,
            wait_for_completion,
        ) {
            self.recycle_bgra_texture(output, frame.width, frame.height);
            return Err(error);
        }
        Ok(output)
    }

    pub(crate) fn decode_to_bgra_scaled(
        &mut self,
        frame: &DecodedFrame,
        output_width: u32,
        output_height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        let output = self.take_bgra_texture(output_width, output_height)?;
        if let Err(error) =
            self.blit_decoded_surface(frame, &output, output_width, output_height, true)
        {
            self.recycle_bgra_texture(output, output_width, output_height);
            return Err(error);
        }
        Ok(output)
    }

    pub(crate) fn create_composition_target(
        &mut self,
        width: u32,
        height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        self.take_bgra_texture(width, height)
    }

    #[allow(clippy::too_many_arguments)]
    fn blit_decoded_surface(
        &mut self,
        frame: &DecodedFrame,
        output: &ID3D11Texture2D,
        output_width: u32,
        output_height: u32,
        wait_for_completion: bool,
    ) -> Result<(), String> {
        match &frame.surface {
            DecodedSurface::D3d11(texture) => self.blit(
                texture,
                frame.array_slice,
                frame.width,
                frame.height,
                output,
                output_width,
                output_height,
                wait_for_completion,
            ),
            DecodedSurface::D3d12 {
                resource,
                synchronization,
            } => {
                let mut input = D3d12DecodedTextureLease::new(
                    resource,
                    synchronization,
                    &self.d3d11on12,
                    &self.context,
                    &self.interop_queue,
                )?;
                let input_texture = input.texture().clone();
                let blit_result = self.blit(
                    &input_texture,
                    frame.array_slice,
                    frame.width,
                    frame.height,
                    output,
                    output_width,
                    output_height,
                    wait_for_completion,
                );
                let release_result = input.finish();
                match (blit_result, release_result) {
                    (Err(error), Err(release_error)) => {
                        Err(format!("{error}; D3D12 解码画面释放失败: {release_error}"))
                    }
                    (Err(error), Ok(())) => Err(error),
                    (Ok(()), Err(error)) => Err(error),
                    (Ok(()), Ok(())) => Ok(()),
                }
            }
        }
    }

    pub(crate) fn bgra_to_nv12(
        &mut self,
        input: ID3D11Texture2D,
        width: u32,
        height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err("显卡颜色转换要求 NV12 画面宽高为正偶数".to_string());
        }
        let output = self.create_texture(
            width,
            height,
            DXGI_FORMAT_NV12,
            (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        )?;
        // Media Foundation may consume the texture asynchronously. Wait for
        // VideoProcessorBlt before handing it over or recycling the BGRA input.
        self.blit(&input, 0, width, height, &output, width, height, true)?;
        self.recycle_bgra_texture(input, width, height);
        Ok(output)
    }

    fn take_bgra_texture(&mut self, width: u32, height: u32) -> Result<ID3D11Texture2D, String> {
        let key = (width, height);
        if let Some(texture) = self.reusable_bgra.get_mut(&key).and_then(|pool| pool.pop()) {
            return Ok(texture);
        }
        self.create_texture(
            width,
            height,
            DXGI_FORMAT_B8G8R8A8_UNORM,
            (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        )
    }

    pub(crate) fn recycle_bgra_texture(
        &mut self,
        texture: ID3D11Texture2D,
        width: u32,
        height: u32,
    ) {
        let pool = self.reusable_bgra.entry((width, height)).or_default();
        if pool.len() < MAX_REUSABLE_BGRA_PER_SIZE {
            pool.push(texture);
        }
    }

    pub(crate) fn unwrap_for_wgpu(
        &mut self,
        texture: &ID3D11Texture2D,
    ) -> Result<D3d12TextureLease, String> {
        let resource11 = texture
            .cast::<ID3D11Resource>()
            .map_err(|error| format!("无法取得共享纹理资源: {error}"))?;
        let resource12 = unsafe {
            self.d3d11on12
                .UnwrapUnderlyingResource::<_, _, ID3D12Resource>(&resource11, &self.interop_queue)
        }
        .map_err(|error| format!("无法将视频画面交给合成器: {error}"))?;
        // UnwrapUnderlyingResource can enqueue state transitions and waits;
        // flush after it so the following wgpu commands see the full handoff.
        unsafe { self.context.Flush() };
        let fence_value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.saturating_add(1);
        unsafe { self.interop_queue.Signal(&self.fence, fence_value) }.map_err(|error| {
            self.log_device_status("interop queue signal");
            format!("无法提交 D3D11On12 资源就绪信号: {error}")
        })?;
        unsafe { self.wgpu_queue.Wait(&self.fence, fence_value) }.map_err(|error| {
            self.log_device_status("wgpu queue wait");
            format!("无法让 wgpu 等待 D3D11On12 资源: {error}")
        })?;
        let release_fence_value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.saturating_add(1);
        crate::logging::write(&format!(
            "[Export:WinGPU] queue-sync interop-to-wgpu ready-fence={fence_value} release-fence={release_fence_value}"
        ));
        Ok(D3d12TextureLease {
            resource12: Some(resource12),
            resource11,
            d3d11on12: self.d3d11on12.clone(),
            wgpu_queue: self.wgpu_queue.clone(),
            fence: self.fence.clone(),
            release_fence_value,
            release_signal_submitted: false,
            returned: false,
        })
    }

    fn log_device_status(&self, stage: &str) {
        let d3d11 = unsafe { self.device.GetDeviceRemovedReason() }
            .map(|_| "S_OK".to_string())
            .unwrap_or_else(|error| format!("{:?}", error.code()));
        let d3d12 = unsafe { self.d3d12_device.GetDeviceRemovedReason() }
            .map(|_| "S_OK".to_string())
            .unwrap_or_else(|error| format!("{:?}", error.code()));
        crate::logging::write(&format!(
            "[Export:WinGPU] device-status stage={stage} d3d11={d3d11} d3d12={d3d12}"
        ));
    }

    fn create_texture(
        &self,
        width: u32,
        height: u32,
        format: DXGI_FORMAT,
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
            .map_err(|error| format!("无法创建显卡视频画面: {error}"))?;
        texture.ok_or_else(|| "显卡视频画面创建后为空".to_string())
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
                .map_err(|error| format!("当前显卡不支持所需视频尺寸或格式: {error}"))?;
            let processor = unsafe { self.video_device.CreateVideoProcessor(&enumerator, 0) }
                .map_err(|error| format!("无法创建显卡颜色转换器: {error}"))?;
            // Video frames have no meaningful alpha. Some drivers leave the
            // BGRA output alpha at zero, which makes premultiplied WGSL output black.
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
            .map_err(|error| format!("无法读取颜色转换输入: {error}"))?;
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
        .map_err(|error| format!("无法读取显卡解码画面: {error}"))?;
        let input_view = input_view.ok_or_else(|| "颜色转换输入视图为空".to_string())?;

        let output_resource = output
            .cast::<ID3D11Resource>()
            .map_err(|error| format!("无法取得颜色转换输出: {error}"))?;
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
        .map_err(|error| format!("无法写入显卡转换画面: {error}"))?;
        let output_view = output_view.ok_or_else(|| "颜色转换输出视图为空".to_string())?;

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
        result.map_err(|error| format!("显卡颜色转换失败: {error}"))?;
        if wait_for_completion {
            self.wait_for_blit()
        } else {
            Ok(())
        }
    }

    fn wait_for_blit(&self) -> Result<(), String> {
        unsafe {
            self.context.End(&self.completion_query);
            self.context.Flush();
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let mut complete = BOOL::default();
            unsafe {
                self.context.GetData(
                    &self.completion_query,
                    Some((&mut complete as *mut BOOL).cast()),
                    size_of::<BOOL>() as u32,
                    D3D11_ASYNC_GETDATA_DONOTFLUSH.0 as u32,
                )
            }
            .map_err(|error| format!("等待显卡颜色转换失败: {error}"))?;
            if complete.as_bool() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("等待显卡颜色转换超时".to_string());
            }
            std::thread::yield_now();
        }
    }
}
