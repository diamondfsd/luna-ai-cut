use std::collections::HashMap;
use std::mem::ManuallyDrop;
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandAllocator, ID3D12CommandList, ID3D12CommandQueue, ID3D12Device, ID3D12Fence,
    ID3D12Resource, D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS, D3D12_FENCE_FLAG_NONE, D3D12_HEAP_FLAGS,
    D3D12_HEAP_FLAG_NONE, D3D12_HEAP_FLAG_SHARED, D3D12_HEAP_TYPE_DEFAULT, D3D12_RESOURCE_BARRIER,
    D3D12_RESOURCE_BARRIER_0, D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
    D3D12_RESOURCE_BARRIER_FLAG_NONE, D3D12_RESOURCE_BARRIER_TYPE_TRANSITION, D3D12_RESOURCE_DESC,
    D3D12_RESOURCE_DIMENSION_TEXTURE2D, D3D12_RESOURCE_FLAGS, D3D12_RESOURCE_STATES,
    D3D12_RESOURCE_STATE_COMMON, D3D12_RESOURCE_STATE_VIDEO_PROCESS_READ,
    D3D12_RESOURCE_STATE_VIDEO_PROCESS_WRITE, D3D12_RESOURCE_TRANSITION_BARRIER,
    D3D12_TEXTURE_LAYOUT_UNKNOWN,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709, DXGI_COLOR_SPACE_TYPE,
    DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709, DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM,
    DXGI_FORMAT_NV12, DXGI_FORMAT_P010, DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_RATIONAL,
    DXGI_SAMPLE_DESC,
};
use windows::Win32::Media::MediaFoundation::{
    ID3D12VideoDevice, ID3D12VideoProcessCommandList, ID3D12VideoProcessor,
    IMFD3D12SynchronizationObjectCommands, D3D12_VIDEO_FIELD_TYPE_NONE,
    D3D12_VIDEO_FRAME_STEREO_FORMAT_NONE, D3D12_VIDEO_PROCESS_ALPHA_BLENDING,
    D3D12_VIDEO_PROCESS_ALPHA_FILL_MODE_OPAQUE, D3D12_VIDEO_PROCESS_DEINTERLACE_FLAG_NONE,
    D3D12_VIDEO_PROCESS_FILTER_FLAG_NONE, D3D12_VIDEO_PROCESS_INPUT_STREAM,
    D3D12_VIDEO_PROCESS_INPUT_STREAM_ARGUMENTS, D3D12_VIDEO_PROCESS_INPUT_STREAM_DESC,
    D3D12_VIDEO_PROCESS_INPUT_STREAM_FLAG_NONE, D3D12_VIDEO_PROCESS_INPUT_STREAM_RATE,
    D3D12_VIDEO_PROCESS_ORIENTATION_DEFAULT, D3D12_VIDEO_PROCESS_OUTPUT_STREAM,
    D3D12_VIDEO_PROCESS_OUTPUT_STREAM_ARGUMENTS, D3D12_VIDEO_PROCESS_OUTPUT_STREAM_DESC,
    D3D12_VIDEO_PROCESS_TRANSFORM, D3D12_VIDEO_SIZE_RANGE,
};

use super::decoder::{DecodedFrame, DecodedSurface};
use super::encoder_backend::{EncoderFrame, EncoderPixelFormat, GpuFrame, GpuPixelFormat};

const MAX_REUSABLE_BGRA_PER_SIZE: usize = 4;
const PROCESS_WAIT_TIMEOUT: Duration = Duration::from_secs(2);

/// A D3D12 resource handoff between the video-process queue and wgpu.
///
/// The external-texture contract returns resources to COMMON, so the lease
/// only needs queue fences. No graphics API wrapper or pixel readback is used.
pub(crate) struct D3d12TextureLease {
    resource: ID3D12Resource,
    process_queue: ID3D12CommandQueue,
    wgpu_queue: ID3D12CommandQueue,
    fence: ID3D12Fence,
    release_fence_value: u64,
    release_signal_submitted: bool,
    returned: bool,
}

impl D3d12TextureLease {
    pub(crate) fn resource(&self) -> &ID3D12Resource {
        &self.resource
    }

    fn return_to_process_queue(&mut self) -> Result<(), String> {
        if self.returned {
            return Ok(());
        }

        if !self.release_signal_submitted {
            unsafe {
                self.wgpu_queue
                    .Signal(&self.fence, self.release_fence_value)
            }
            .map_err(|error| format!("failed to signal wgpu work: {error}"))?;
            self.release_signal_submitted = true;
        }

        unsafe {
            self.process_queue
                .Wait(&self.fence, self.release_fence_value)
        }
        .map_err(|error| format!("failed to wait for wgpu work: {error}"))?;
        self.returned = true;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<(), String> {
        self.return_to_process_queue()
    }
}

impl Drop for D3d12TextureLease {
    fn drop(&mut self) {
        if self.returned {
            return;
        }
        if let Err(error) = self.return_to_process_queue() {
            crate::logging::write(&format!(
                "[Export:WinGPU] D3D12 texture lease cleanup failed: {error}"
            ));
        }
    }
}

pub(crate) struct VideoConverter {
    d3d12_device: ID3D12Device,
    video_device: ID3D12VideoDevice,
    process_queue: ID3D12CommandQueue,
    wgpu_queue: ID3D12CommandQueue,
    process_allocator: ID3D12CommandAllocator,
    process_command_list: ID3D12VideoProcessCommandList,
    fence: ID3D12Fence,
    next_fence_value: u64,
    process_in_flight_value: u64,
    video_processors: HashMap<VideoProcessorKey, VideoProcessorState>,
    reusable_bgra: HashMap<(u32, u32), Vec<ID3D12Resource>>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct VideoProcessorKey {
    input_width: u32,
    input_height: u32,
    output_width: u32,
    output_height: u32,
    input_format: i32,
    output_format: i32,
}

struct VideoProcessorState {
    processor: ID3D12VideoProcessor,
}

impl VideoConverter {
    pub(crate) fn new(
        d3d12_device: &ID3D12Device,
        process_queue: &ID3D12CommandQueue,
        wgpu_queue: &ID3D12CommandQueue,
    ) -> Result<Self, String> {
        let video_device = d3d12_device
            .cast::<ID3D12VideoDevice>()
            .map_err(|error| format!("D3D12 video processing is unavailable: {error}"))?;

        let process_allocator: ID3D12CommandAllocator = unsafe {
            d3d12_device.CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS)
        }
        .map_err(|error| format!("failed to create D3D12 video-process allocator: {error}"))?;

        let process_command_list: ID3D12VideoProcessCommandList = unsafe {
            d3d12_device.CreateCommandList(
                0,
                D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS,
                &process_allocator,
                None,
            )
        }
        .map_err(|error| format!("failed to create D3D12 video-process command list: {error}"))?;
        unsafe { process_command_list.Close() }.map_err(|error| {
            format!("failed to close D3D12 video-process command list: {error}")
        })?;

        let fence: ID3D12Fence = unsafe { d3d12_device.CreateFence(0, D3D12_FENCE_FLAG_NONE) }
            .map_err(|error| format!("failed to create D3D12 inter-queue fence: {error}"))?;

        crate::logging::write(
            "[Export:WinGPU] converter backend=d3d12-video process-queue=VIDEO_PROCESS pixel-transport=GPU",
        );

        Ok(Self {
            d3d12_device: d3d12_device.clone(),
            video_device,
            process_queue: process_queue.clone(),
            wgpu_queue: wgpu_queue.clone(),
            process_allocator,
            process_command_list,
            fence,
            next_fence_value: 1,
            process_in_flight_value: 0,
            video_processors: HashMap::new(),
            reusable_bgra: HashMap::new(),
        })
    }

    pub(crate) fn decode_to_bgra_for_export(
        &mut self,
        frame: &DecodedFrame,
    ) -> Result<ID3D12Resource, String> {
        self.decode_to_bgra_for_export_inner(frame, false)
    }

    pub(crate) fn decode_to_bgra_for_export_synchronized(
        &mut self,
        frame: &DecodedFrame,
    ) -> Result<ID3D12Resource, String> {
        self.decode_to_bgra_for_export_inner(frame, true)
    }

    fn decode_to_bgra_for_export_inner(
        &mut self,
        frame: &DecodedFrame,
        wait_for_completion: bool,
    ) -> Result<ID3D12Resource, String> {
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
    ) -> Result<ID3D12Resource, String> {
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
    ) -> Result<ID3D12Resource, String> {
        self.create_texture(
            width,
            height,
            DXGI_FORMAT_B8G8R8A8_UNORM,
            D3D12_RESOURCE_FLAGS(1),
            D3D12_HEAP_FLAG_SHARED,
        )
    }

    fn blit_decoded_surface(
        &mut self,
        frame: &DecodedFrame,
        output: &ID3D12Resource,
        output_width: u32,
        output_height: u32,
        wait_for_completion: bool,
    ) -> Result<(), String> {
        match &frame.surface {
            DecodedSurface::D3d12 {
                resource,
                synchronization,
            } => self.blit_resource(
                resource,
                frame.subresource_index,
                frame.width,
                frame.height,
                output,
                output_width,
                output_height,
                Some(synchronization),
                wait_for_completion,
            ),
        }
    }

    pub(crate) fn bgra_to_nv12(
        &mut self,
        input: &ID3D12Resource,
        width: u32,
        height: u32,
    ) -> Result<ID3D12Resource, String> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err("NV12 conversion requires non-zero even dimensions".to_string());
        }

        let input_desc = unsafe { input.GetDesc() };
        let input_format = input_desc.Format;
        if !is_rgb_format(input_format) {
            return Err(format!(
                "D3D12 video processor input must be RGBA8/BGRA8, got DXGI format {}",
                input_format.0
            ));
        }
        if input_desc.Width != u64::from(width) || input_desc.Height != height {
            return Err(format!(
                "D3D12 conversion input size mismatch: expected {}x{}, got {}x{}",
                width, height, input_desc.Width, input_desc.Height
            ));
        }

        // The compositor returns its external target to COMMON, but the
        // queues are independent. This fence makes earlier wgpu work visible
        // to the video-process queue without reading pixels back.
        self.enqueue_wgpu_ready_wait()?;

        let output = self.create_texture(
            width,
            height,
            DXGI_FORMAT_NV12,
            D3D12_RESOURCE_FLAGS(0),
            D3D12_HEAP_FLAG_SHARED,
        )?;
        if let Err(error) =
            self.blit_resource(&input, 0, width, height, &output, width, height, None, true)
        {
            return Err(error);
        }
        Ok(output)
    }

    pub(crate) fn convert_for_encoder(
        &mut self,
        frame: &GpuFrame,
        format: EncoderPixelFormat,
    ) -> Result<EncoderFrame, String> {
        if frame.format != GpuPixelFormat::Rgba8 {
            return Err(format!(
                "D3D12 frame converter does not support compositor format {:?}",
                frame.format
            ));
        }

        let resource = match format {
            EncoderPixelFormat::Bgra8 => frame.resource.clone(),
            EncoderPixelFormat::Nv12 => {
                self.bgra_to_nv12(&frame.resource, frame.width, frame.height)?
            }
            EncoderPixelFormat::P010 => {
                return Err("D3D12 P010 conversion is not implemented yet".to_string());
            }
        };
        Ok(EncoderFrame::new(
            resource,
            frame.width,
            frame.height,
            format,
        ))
    }

    fn take_bgra_texture(&mut self, width: u32, height: u32) -> Result<ID3D12Resource, String> {
        if width == 0 || height == 0 {
            return Err("cannot create a zero-sized D3D12 texture".to_string());
        }
        if let Some(texture) = self
            .reusable_bgra
            .get_mut(&(width, height))
            .and_then(|pool| pool.pop())
        {
            return Ok(texture);
        }
        self.create_texture(
            width,
            height,
            DXGI_FORMAT_B8G8R8A8_UNORM,
            D3D12_RESOURCE_FLAGS(1),
            D3D12_HEAP_FLAG_NONE,
        )
    }

    pub(crate) fn recycle_bgra_texture(
        &mut self,
        texture: ID3D12Resource,
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
        resource: &ID3D12Resource,
    ) -> Result<D3d12TextureLease, String> {
        self.lease_for_wgpu(resource)
    }

    pub(crate) fn wrap_for_wgpu(
        &mut self,
        resource: &ID3D12Resource,
    ) -> Result<D3d12TextureLease, String> {
        self.lease_for_wgpu(resource)
    }

    fn lease_for_wgpu(&mut self, resource: &ID3D12Resource) -> Result<D3d12TextureLease, String> {
        if self.process_in_flight_value != 0 {
            unsafe {
                self.wgpu_queue
                    .Wait(&self.fence, self.process_in_flight_value)
            }
            .map_err(|error| format!("failed to wait for video-process work: {error}"))?;
        }

        let release_fence_value = self.allocate_fence_value();
        Ok(D3d12TextureLease {
            resource: resource.clone(),
            process_queue: self.process_queue.clone(),
            wgpu_queue: self.wgpu_queue.clone(),
            fence: self.fence.clone(),
            release_fence_value,
            release_signal_submitted: false,
            returned: false,
        })
    }

    fn log_device_status(&self, stage: &str) {
        let d3d12 = unsafe { self.d3d12_device.GetDeviceRemovedReason() }
            .map(|_| "S_OK".to_string())
            .unwrap_or_else(|error| format!("{:?}", error.code()));
        crate::logging::write(&format!(
            "[Export:WinGPU] device-status stage={stage} d3d12={d3d12}"
        ));
    }

    fn create_texture(
        &self,
        width: u32,
        height: u32,
        format: DXGI_FORMAT,
        flags: D3D12_RESOURCE_FLAGS,
        heap_flags: D3D12_HEAP_FLAGS,
    ) -> Result<ID3D12Resource, String> {
        let desc = D3D12_RESOURCE_DESC {
            Dimension: D3D12_RESOURCE_DIMENSION_TEXTURE2D,
            Alignment: 0,
            Width: u64::from(width),
            Height: height,
            DepthOrArraySize: 1,
            MipLevels: 1,
            Format: format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Layout: D3D12_TEXTURE_LAYOUT_UNKNOWN,
            Flags: flags,
        };
        let heap_properties = unsafe {
            self.d3d12_device
                .GetCustomHeapProperties(0, D3D12_HEAP_TYPE_DEFAULT)
        };
        let mut resource = None;
        unsafe {
            self.d3d12_device.CreateCommittedResource(
                &heap_properties,
                heap_flags,
                &desc,
                D3D12_RESOURCE_STATE_COMMON,
                None,
                &mut resource,
            )
        }
        .map_err(|error| format!("failed to create D3D12 {format:?} texture: {error}"))?;
        resource.ok_or_else(|| "D3D12 resource creation returned no resource".to_string())
    }

    fn processor_for(
        &mut self,
        input_width: u32,
        input_height: u32,
        output_width: u32,
        output_height: u32,
        input_format: DXGI_FORMAT,
        output_format: DXGI_FORMAT,
    ) -> Result<ID3D12VideoProcessor, String> {
        let key = VideoProcessorKey {
            input_width,
            input_height,
            output_width,
            output_height,
            input_format: input_format.0,
            output_format: output_format.0,
        };
        if let Some(state) = self.video_processors.get(&key) {
            return Ok(state.processor.clone());
        }

        let input_desc = D3D12_VIDEO_PROCESS_INPUT_STREAM_DESC {
            Format: input_format,
            ColorSpace: color_space_for(input_format),
            SourceAspectRatio: DXGI_RATIONAL {
                Numerator: 1,
                Denominator: 1,
            },
            DestinationAspectRatio: DXGI_RATIONAL {
                Numerator: 1,
                Denominator: 1,
            },
            FrameRate: DXGI_RATIONAL {
                Numerator: 30,
                Denominator: 1,
            },
            SourceSizeRange: video_size_range(input_width, input_height),
            DestinationSizeRange: video_size_range(output_width, output_height),
            EnableOrientation: false.into(),
            FilterFlags: D3D12_VIDEO_PROCESS_FILTER_FLAG_NONE,
            StereoFormat: D3D12_VIDEO_FRAME_STEREO_FORMAT_NONE,
            FieldType: D3D12_VIDEO_FIELD_TYPE_NONE,
            DeinterlaceMode: D3D12_VIDEO_PROCESS_DEINTERLACE_FLAG_NONE,
            EnableAlphaBlending: false.into(),
            LumaKey: Default::default(),
            NumPastFrames: 0,
            NumFutureFrames: 0,
            EnableAutoProcessing: false.into(),
        };
        let output_desc = D3D12_VIDEO_PROCESS_OUTPUT_STREAM_DESC {
            Format: output_format,
            ColorSpace: color_space_for(output_format),
            AlphaFillMode: D3D12_VIDEO_PROCESS_ALPHA_FILL_MODE_OPAQUE,
            AlphaFillModeSourceStreamIndex: 0,
            BackgroundColor: [0.0, 0.0, 0.0, 1.0],
            FrameRate: DXGI_RATIONAL {
                Numerator: 30,
                Denominator: 1,
            },
            EnableStereo: false.into(),
        };
        let processor: ID3D12VideoProcessor = unsafe {
            self.video_device
                .CreateVideoProcessor(0, &output_desc, &[input_desc])
        }
        .map_err(|error| {
            format!(
                "D3D12 video processor does not support {} -> {} at {}x{} -> {}x{}: {error}",
                input_format.0,
                output_format.0,
                input_width,
                input_height,
                output_width,
                output_height
            )
        })?;
        self.video_processors.insert(
            key,
            VideoProcessorState {
                processor: processor.clone(),
            },
        );
        Ok(processor)
    }

    fn blit_resource(
        &mut self,
        input: &ID3D12Resource,
        input_subresource: u32,
        input_width: u32,
        input_height: u32,
        output: &ID3D12Resource,
        output_width: u32,
        output_height: u32,
        synchronization: Option<&IMFD3D12SynchronizationObjectCommands>,
        wait_for_completion: bool,
    ) -> Result<(), String> {
        let input_format = unsafe { input.GetDesc() }.Format;
        let output_format = unsafe { output.GetDesc() }.Format;
        if !is_video_process_input_format(input_format) {
            return Err(format!(
                "D3D12 video processor input format {} is unsupported",
                input_format.0
            ));
        }
        if !is_video_process_output_format(output_format) {
            return Err(format!(
                "D3D12 video processor output format {} is unsupported",
                output_format.0
            ));
        }

        if let Some(synchronization) = synchronization {
            unsafe { synchronization.EnqueueResourceReadyWait(&self.process_queue) }
                .map_err(|error| format!("failed to wait for decoded D3D12 surface: {error}"))?;
        }

        let process_result = self.submit_video_process(
            input,
            input_subresource,
            input_width,
            input_height,
            output,
            output_width,
            output_height,
            input_format,
            output_format,
        );

        let release_result = synchronization
            .map(|synchronization| unsafe {
                synchronization.EnqueueResourceRelease(&self.process_queue)
            })
            .transpose()
            .map_err(|error| format!("failed to release decoded D3D12 surface: {error}"));

        let fence_value = match process_result {
            Ok(value) => value,
            Err(error) => {
                if let Err(release_error) = release_result {
                    return Err(format!("{error}; surface release failed: {release_error}"));
                }
                return Err(error);
            }
        };
        release_result?;

        if wait_for_completion {
            self.wait_for_fence(fence_value)?;
        }
        Ok(())
    }

    fn submit_video_process(
        &mut self,
        input: &ID3D12Resource,
        input_subresource: u32,
        input_width: u32,
        input_height: u32,
        output: &ID3D12Resource,
        output_width: u32,
        output_height: u32,
        input_format: DXGI_FORMAT,
        output_format: DXGI_FORMAT,
    ) -> Result<u64, String> {
        if self.process_in_flight_value != 0 {
            self.wait_for_fence(self.process_in_flight_value)?;
        }

        let processor = self.processor_for(
            input_width,
            input_height,
            output_width,
            output_height,
            input_format,
            output_format,
        )?;

        unsafe { self.process_allocator.Reset() }
            .map_err(|error| format!("failed to reset D3D12 video-process allocator: {error}"))?;
        unsafe { self.process_command_list.Reset(&self.process_allocator) }.map_err(|error| {
            format!("failed to reset D3D12 video-process command list: {error}")
        })?;

        let mut before_barriers = vec![
            transition_barrier(
                input,
                input_subresource,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_VIDEO_PROCESS_READ,
            ),
            transition_barrier(
                output,
                D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_VIDEO_PROCESS_WRITE,
            ),
        ];
        unsafe { self.process_command_list.ResourceBarrier(&before_barriers) };
        for barrier in &mut before_barriers {
            unsafe { release_transition_barrier_resource(barrier) };
        }

        let mut input_arguments = [D3D12_VIDEO_PROCESS_INPUT_STREAM_ARGUMENTS::default()];
        input_arguments[0].InputStream[0] = D3D12_VIDEO_PROCESS_INPUT_STREAM {
            pTexture2D: ManuallyDrop::new(Some(input.clone())),
            Subresource: input_subresource,
            ReferenceSet: Default::default(),
        };
        input_arguments[0].Transform = D3D12_VIDEO_PROCESS_TRANSFORM {
            SourceRectangle: RECT {
                left: 0,
                top: 0,
                right: input_width as i32,
                bottom: input_height as i32,
            },
            DestinationRectangle: RECT {
                left: 0,
                top: 0,
                right: output_width as i32,
                bottom: output_height as i32,
            },
            Orientation: D3D12_VIDEO_PROCESS_ORIENTATION_DEFAULT,
        };
        input_arguments[0].Flags = D3D12_VIDEO_PROCESS_INPUT_STREAM_FLAG_NONE;
        input_arguments[0].RateInfo = D3D12_VIDEO_PROCESS_INPUT_STREAM_RATE {
            OutputIndex: 0,
            InputFrameOrField: 0,
        };
        input_arguments[0].AlphaBlending = D3D12_VIDEO_PROCESS_ALPHA_BLENDING {
            Enable: false.into(),
            Alpha: 1.0,
        };

        let mut output_arguments = D3D12_VIDEO_PROCESS_OUTPUT_STREAM_ARGUMENTS::default();
        output_arguments.OutputStream[0] = D3D12_VIDEO_PROCESS_OUTPUT_STREAM {
            pTexture2D: ManuallyDrop::new(Some(output.clone())),
            Subresource: 0,
        };
        output_arguments.TargetRectangle = RECT {
            left: 0,
            top: 0,
            right: output_width as i32,
            bottom: output_height as i32,
        };

        unsafe {
            self.process_command_list.ProcessFrames(
                &processor,
                &output_arguments,
                &input_arguments,
            );
            ManuallyDrop::drop(&mut input_arguments[0].InputStream[0].pTexture2D);
            ManuallyDrop::drop(&mut output_arguments.OutputStream[0].pTexture2D);
        }

        let mut after_barriers = vec![
            transition_barrier(
                input,
                input_subresource,
                D3D12_RESOURCE_STATE_VIDEO_PROCESS_READ,
                D3D12_RESOURCE_STATE_COMMON,
            ),
            transition_barrier(
                output,
                D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
                D3D12_RESOURCE_STATE_VIDEO_PROCESS_WRITE,
                D3D12_RESOURCE_STATE_COMMON,
            ),
        ];
        unsafe { self.process_command_list.ResourceBarrier(&after_barriers) };
        for barrier in &mut after_barriers {
            unsafe { release_transition_barrier_resource(barrier) };
        }

        unsafe { self.process_command_list.Close() }.map_err(|error| {
            format!("failed to close D3D12 video-process command list: {error}")
        })?;

        let command_list: ID3D12CommandList = self
            .process_command_list
            .cast()
            .map_err(|error| format!("failed to cast video-process command list: {error}"))?;
        unsafe {
            self.process_queue
                .ExecuteCommandLists(&[Some(command_list)]);
        }
        let fence_value = self.allocate_fence_value();
        unsafe { self.process_queue.Signal(&self.fence, fence_value) }.map_err(|error| {
            self.log_device_status("video-process queue signal");
            format!("failed to signal D3D12 video-process work: {error}")
        })?;
        self.process_in_flight_value = fence_value;
        Ok(fence_value)
    }

    fn enqueue_wgpu_ready_wait(&mut self) -> Result<(), String> {
        let fence_value = self.allocate_fence_value();
        unsafe { self.wgpu_queue.Signal(&self.fence, fence_value) }
            .map_err(|error| format!("failed to signal wgpu queue before conversion: {error}"))?;
        unsafe { self.process_queue.Wait(&self.fence, fence_value) }
            .map_err(|error| format!("failed to wait for wgpu queue before conversion: {error}"))?;
        Ok(())
    }

    fn allocate_fence_value(&mut self) -> u64 {
        let value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.saturating_add(1);
        value
    }

    fn wait_for_fence(&self, value: u64) -> Result<(), String> {
        if value == 0 {
            return Ok(());
        }
        let deadline = Instant::now() + PROCESS_WAIT_TIMEOUT;
        loop {
            let completed = unsafe { self.fence.GetCompletedValue() };
            if completed >= value {
                return Ok(());
            }
            if completed == u64::MAX {
                self.log_device_status("video-process fence");
                return Err(
                    "D3D12 device was removed while waiting for video processing".to_string(),
                );
            }
            if Instant::now() >= deadline {
                self.log_device_status("video-process fence timeout");
                return Err("timed out waiting for D3D12 video processing".to_string());
            }
            std::thread::yield_now();
        }
    }
}

fn video_size_range(width: u32, height: u32) -> D3D12_VIDEO_SIZE_RANGE {
    D3D12_VIDEO_SIZE_RANGE {
        MaxWidth: width,
        MaxHeight: height,
        MinWidth: width,
        MinHeight: height,
    }
}

fn color_space_for(format: DXGI_FORMAT) -> DXGI_COLOR_SPACE_TYPE {
    if matches!(format, DXGI_FORMAT_NV12 | DXGI_FORMAT_P010) {
        DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709
    } else {
        DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709
    }
}

fn is_rgb_format(format: DXGI_FORMAT) -> bool {
    matches!(
        format,
        DXGI_FORMAT_B8G8R8A8_UNORM | DXGI_FORMAT_R8G8B8A8_UNORM
    )
}

fn is_video_process_input_format(format: DXGI_FORMAT) -> bool {
    is_rgb_format(format) || matches!(format, DXGI_FORMAT_NV12 | DXGI_FORMAT_P010)
}

fn is_video_process_output_format(format: DXGI_FORMAT) -> bool {
    is_rgb_format(format) || matches!(format, DXGI_FORMAT_NV12 | DXGI_FORMAT_P010)
}

fn transition_barrier(
    resource: &ID3D12Resource,
    subresource: u32,
    state_before: D3D12_RESOURCE_STATES,
    state_after: D3D12_RESOURCE_STATES,
) -> D3D12_RESOURCE_BARRIER {
    D3D12_RESOURCE_BARRIER {
        Type: D3D12_RESOURCE_BARRIER_TYPE_TRANSITION,
        Flags: D3D12_RESOURCE_BARRIER_FLAG_NONE,
        Anonymous: D3D12_RESOURCE_BARRIER_0 {
            Transition: ManuallyDrop::new(D3D12_RESOURCE_TRANSITION_BARRIER {
                pResource: ManuallyDrop::new(Some(resource.clone())),
                Subresource: subresource,
                StateBefore: state_before,
                StateAfter: state_after,
            }),
        },
    }
}

unsafe fn release_transition_barrier_resource(barrier: &mut D3D12_RESOURCE_BARRIER) {
    let transition = &mut *barrier.Anonymous.Transition;
    let _ = ManuallyDrop::take(&mut transition.pResource);
}
