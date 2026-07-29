use std::mem::{size_of, ManuallyDrop};
use std::ptr;
use std::time::{Duration, Instant};

use windows::core::{Interface, BOOL};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Query, ID3D11Resource, ID3D11Texture2D,
    ID3D11VideoContext, ID3D11VideoDevice, D3D11_ASYNC_GETDATA_DONOTFLUSH,
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_QUERY_DESC, D3D11_QUERY_EVENT,
    D3D11_TEX2D_VPIV, D3D11_TEX2D_VPOV, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_CONTENT_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_STREAM, D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    D3D11_VPIV_DIMENSION_TEXTURE2D, D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Direct3D11on12::ID3D11On12Device2;
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandQueue, ID3D12Device, ID3D12Fence, ID3D12Resource, D3D12_FENCE_FLAG_NONE,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
};

use super::decoder::DecodedFrame;

pub(crate) struct VideoConverter {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    d3d11on12: ID3D11On12Device2,
    queue: ID3D12CommandQueue,
    fence: ID3D12Fence,
    next_fence_value: u64,
    completion_query: ID3D11Query,
}

pub(crate) struct D3d12TextureLease {
    resource12: Option<ID3D12Resource>,
    resource11: ID3D11Resource,
    d3d11on12: ID3D11On12Device2,
    queue: ID3D12CommandQueue,
    fence: ID3D12Fence,
    fence_value: u64,
    returned: bool,
}

impl D3d12TextureLease {
    pub(crate) fn resource(&self) -> &ID3D12Resource {
        self.resource12
            .as_ref()
            .expect("D3D12 lease already returned")
    }

    /// 在 wgpu 已向同一队列提交命令后调用。Signal 排在该提交之后，
    /// ReturnUnderlyingResource 会让后续 D3D11 工作等待这个 fence。
    pub(crate) fn finish(mut self) -> Result<(), String> {
        unsafe { self.queue.Signal(&self.fence, self.fence_value) }
            .map_err(|error| format!("无法同步合成画面: {error}"))?;
        let values = [self.fence_value];
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
}

impl Drop for D3d12TextureLease {
    fn drop(&mut self) {
        if self.returned {
            return;
        }
        // 错误路径没有再向 wgpu 提交工作，可以无 fence 归还资源，避免让
        // D3D11On12 永久保留解包所有权。
        let _ = unsafe {
            self.d3d11on12
                .ReturnUnderlyingResource(&self.resource11, 0, ptr::null(), ptr::null())
        };
    }
}

impl VideoConverter {
    pub(crate) fn new(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        d3d11on12: &ID3D11On12Device2,
        d3d12_device: &ID3D12Device,
        queue: &ID3D12CommandQueue,
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
            context: context.clone(),
            video_device,
            video_context,
            d3d11on12: d3d11on12.clone(),
            queue: queue.clone(),
            fence,
            next_fence_value: 1,
            completion_query,
        })
    }

    pub(crate) fn decode_to_bgra(&self, frame: &DecodedFrame) -> Result<ID3D11Texture2D, String> {
        self.decode_to_bgra_scaled(frame, frame.width, frame.height)
    }

    pub(crate) fn decode_to_bgra_scaled(
        &self,
        frame: &DecodedFrame,
        output_width: u32,
        output_height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        let output = self.create_texture(
            output_width,
            output_height,
            DXGI_FORMAT_B8G8R8A8_UNORM,
            (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        )?;
        self.blit(
            &frame.texture,
            frame.array_slice,
            frame.width,
            frame.height,
            &output,
            output_width,
            output_height,
        )?;
        Ok(output)
    }

    pub(crate) fn create_composition_target(
        &self,
        width: u32,
        height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        self.create_texture(
            width,
            height,
            DXGI_FORMAT_B8G8R8A8_UNORM,
            (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        )
    }

    pub(crate) fn bgra_to_nv12(
        &self,
        input: &ID3D11Texture2D,
        width: u32,
        height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        let output = self.create_texture(
            width,
            height,
            DXGI_FORMAT_NV12,
            D3D11_BIND_RENDER_TARGET.0 as u32,
        )?;
        self.blit(input, 0, width, height, &output, width, height)?;
        Ok(output)
    }

    pub(crate) fn unwrap_for_wgpu(
        &mut self,
        texture: &ID3D11Texture2D,
    ) -> Result<D3d12TextureLease, String> {
        // 提交此前的视频处理命令，Unwrap 后 wgpu 会继续使用同一个 D3D12 队列。
        unsafe { self.context.Flush() };
        let resource11 = texture
            .cast::<ID3D11Resource>()
            .map_err(|error| format!("无法取得共享纹理资源: {error}"))?;
        let resource12 = unsafe {
            self.d3d11on12
                .UnwrapUnderlyingResource::<_, _, ID3D12Resource>(&resource11, &self.queue)
        }
        .map_err(|error| format!("无法将视频画面交给合成器: {error}"))?;
        let fence_value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.saturating_add(1);
        Ok(D3d12TextureLease {
            resource12: Some(resource12),
            resource11,
            d3d11on12: self.d3d11on12.clone(),
            queue: self.queue.clone(),
            fence: self.fence.clone(),
            fence_value,
            returned: false,
        })
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
        &self,
        input: &ID3D11Texture2D,
        input_subresource: u32,
        input_width: u32,
        input_height: u32,
        output: &ID3D11Texture2D,
        output_width: u32,
        output_height: u32,
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
        let enumerator = unsafe { self.video_device.CreateVideoProcessorEnumerator(&content) }
            .map_err(|error| format!("当前显卡不支持所需视频尺寸或格式: {error}"))?;
        let processor = unsafe { self.video_device.CreateVideoProcessor(&enumerator, 0) }
            .map_err(|error| format!("无法创建显卡颜色转换器: {error}"))?;

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
        self.wait_for_blit()
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
