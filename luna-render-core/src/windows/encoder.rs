use std::fs::{File, OpenOptions};
use std::io::Write;
use std::mem::ManuallyDrop;
use std::path::{Path, PathBuf};
use std::time::Duration;

use windows::core::Interface;
use windows::Win32::Graphics::Direct3D12::{
    ID3D12CommandAllocator, ID3D12CommandList, ID3D12CommandQueue, ID3D12Device, ID3D12Fence,
    ID3D12GraphicsCommandList, ID3D12Resource, D3D12_COMMAND_LIST_TYPE_COPY,
    D3D12_COMMAND_LIST_TYPE_VIDEO_ENCODE, D3D12_COMMAND_QUEUE_DESC, D3D12_COMMAND_QUEUE_FLAG_NONE,
    D3D12_CPU_PAGE_PROPERTY_UNKNOWN, D3D12_FENCE_FLAG_NONE, D3D12_HEAP_FLAG_NONE,
    D3D12_HEAP_PROPERTIES, D3D12_HEAP_TYPE_DEFAULT, D3D12_HEAP_TYPE_READBACK,
    D3D12_MEMORY_POOL_UNKNOWN, D3D12_RANGE, D3D12_RESOURCE_BARRIER, D3D12_RESOURCE_BARRIER_0,
    D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES, D3D12_RESOURCE_BARRIER_FLAG_NONE,
    D3D12_RESOURCE_BARRIER_TYPE_TRANSITION, D3D12_RESOURCE_DESC, D3D12_RESOURCE_DIMENSION_BUFFER,
    D3D12_RESOURCE_FLAGS, D3D12_RESOURCE_STATE_COMMON, D3D12_RESOURCE_STATE_COPY_DEST,
    D3D12_RESOURCE_STATE_COPY_SOURCE, D3D12_RESOURCE_STATE_VIDEO_ENCODE_READ,
    D3D12_RESOURCE_STATE_VIDEO_ENCODE_WRITE, D3D12_RESOURCE_TRANSITION_BARRIER,
    D3D12_TEXTURE_LAYOUT_ROW_MAJOR,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
};
use windows::Win32::Media::MediaFoundation::{
    ID3D12VideoDevice3, ID3D12VideoEncodeCommandList2, ID3D12VideoEncoder, ID3D12VideoEncoderHeap,
    D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION, D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_0,
    D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264,
    D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264_DIRECT_MODES_DISABLED,
    D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264_FLAG_NONE,
    D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264_SLICES_DEBLOCKING_MODE_0_ALL_LUMA_CHROMA_SLICE_BLOCK_EDGES_ALWAYS_FILTERED,
    D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_HEVC,
    D3D12_FEATURE_DATA_VIDEO_ENCODER_RESOURCE_REQUIREMENTS,
    D3D12_FEATURE_DATA_VIDEO_ENCODER_SUPPORT, D3D12_FEATURE_VIDEO_ENCODER_RESOURCE_REQUIREMENTS,
    D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_HEVC_FLAG_NONE, D3D12_VIDEO_ENCODER_CODEC_H264,
    D3D12_VIDEO_ENCODER_CODEC_HEVC, D3D12_VIDEO_ENCODER_COMPRESSED_BITSTREAM,
    D3D12_VIDEO_ENCODER_ENCODEFRAME_INPUT_ARGUMENTS,
    D3D12_VIDEO_ENCODER_ENCODEFRAME_OUTPUT_ARGUMENTS,
    D3D12_VIDEO_ENCODER_ENCODE_OPERATION_METADATA_BUFFER, D3D12_VIDEO_ENCODER_FLAG_NONE,
    D3D12_VIDEO_ENCODER_FRAME_SUBREGION_LAYOUT_MODE_FULL_FRAME,
    D3D12_VIDEO_ENCODER_FRAME_TYPE_H264_IDR_FRAME, D3D12_VIDEO_ENCODER_FRAME_TYPE_HEVC_IDR_FRAME,
    D3D12_VIDEO_ENCODER_HEAP_DESC, D3D12_VIDEO_ENCODER_HEAP_FLAG_NONE,
    D3D12_VIDEO_ENCODER_LEVELS_H264, D3D12_VIDEO_ENCODER_LEVELS_H264_51,
    D3D12_VIDEO_ENCODER_LEVELS_HEVC_51, D3D12_VIDEO_ENCODER_LEVEL_SETTING,
    D3D12_VIDEO_ENCODER_LEVEL_SETTING_0,
    D3D12_VIDEO_ENCODER_INTRA_REFRESH_MODE_NONE,
    D3D12_VIDEO_ENCODER_MOTION_ESTIMATION_PRECISION_MODE_MAXIMUM,
    D3D12_VIDEO_ENCODER_OUTPUT_METADATA, D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA,
    D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_0,
    D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_H264,
    D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_HEVC, D3D12_VIDEO_ENCODER_PICTURE_CONTROL_DESC,
    D3D12_VIDEO_ENCODER_PICTURE_CONTROL_FLAG_NONE, D3D12_VIDEO_ENCODER_PICTURE_RESOLUTION_DESC,
    D3D12_VIDEO_ENCODER_PROFILE_DESC, D3D12_VIDEO_ENCODER_PROFILE_DESC_0,
    D3D12_VIDEO_ENCODER_PROFILE_H264, D3D12_VIDEO_ENCODER_PROFILE_H264_MAIN,
    D3D12_VIDEO_ENCODER_PROFILE_HEVC, D3D12_VIDEO_ENCODER_PROFILE_HEVC_MAIN,
    D3D12_VIDEO_ENCODER_RATE_CONTROL, D3D12_VIDEO_ENCODER_RATE_CONTROL_CBR,
    D3D12_VIDEO_ENCODER_RATE_CONTROL_CONFIGURATION_PARAMS,
    D3D12_VIDEO_ENCODER_RATE_CONTROL_CONFIGURATION_PARAMS_0,
    D3D12_VIDEO_ENCODER_RATE_CONTROL_FLAG_NONE, D3D12_VIDEO_ENCODER_RATE_CONTROL_MODE_CBR,
    D3D12_VIDEO_ENCODER_SEQUENCE_CONTROL_DESC, D3D12_VIDEO_ENCODER_SEQUENCE_CONTROL_FLAG_NONE,
    D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE, D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_0,
    D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_H264,
    D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_HEVC, D3D12_VIDEO_ENCODER_SUPPORT_FLAG_GENERAL_SUPPORT_OK,
    D3D12_VIDEO_ENCODER_TIER_HEVC_MAIN,
};

const METADATA_BUFFER_SIZE: u64 = 256;
const ENCODE_WAIT_TIMEOUT: Duration = Duration::from_secs(2);

pub(crate) struct VideoEncoder {
    queue: ID3D12CommandQueue,
    allocator: ID3D12CommandAllocator,
    command_list: ID3D12VideoEncodeCommandList2,
    encoder: ID3D12VideoEncoder,
    heap: ID3D12VideoEncoderHeap,
    bitstream: ID3D12Resource,
    metadata: ID3D12Resource,
    resolved_metadata: ID3D12Resource,
    bitstream_capacity: u64,
    bitstream_alignment: u64,
    metadata_size: u64,
    metadata_alignment: u64,
    sequence_header: Vec<u8>,
    aligned_header_size: u64,
    fence: ID3D12Fence,
    next_fence_value: u64,
    width: u32,
    height: u32,
    fps: f64,
    bitrate: u64,
    hevc: bool,
    output_path: PathBuf,
    output: Option<File>,
    finished: bool,
}

impl VideoEncoder {
    pub(crate) fn new(
        output_path: &Path,
        device: &ID3D12Device,
        queue: &ID3D12CommandQueue,
        width: u32,
        height: u32,
        fps: f64,
        bitrate: u64,
        hevc: bool,
    ) -> Result<Self, String> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err("D3D12 video encoder requires non-zero even dimensions".to_string());
        }
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create encoder output directory: {error}"))?;
        }
        let output = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(output_path)
            .map_err(|error| format!("failed to open D3D12 bitstream output: {error}"))?;

        let video_device: ID3D12VideoDevice3 = device
            .cast()
            .map_err(|error| format!("D3D12 video encoder is unavailable: {error}"))?;
        let mut h264_profile = D3D12_VIDEO_ENCODER_PROFILE_H264_MAIN;
        let mut hevc_profile = D3D12_VIDEO_ENCODER_PROFILE_HEVC_MAIN;
        let profile = profile_desc(hevc, &mut h264_profile, &mut hevc_profile);
        let mut h264_config = D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264 {
            ConfigurationFlags: D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264_FLAG_NONE,
            DirectModeConfig: D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264_DIRECT_MODES_DISABLED,
            DisableDeblockingFilterConfig:
                D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264_SLICES_DEBLOCKING_MODE_0_ALL_LUMA_CHROMA_SLICE_BLOCK_EDGES_ALWAYS_FILTERED,
        };
        let mut hevc_config = D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_HEVC::default();
        hevc_config.ConfigurationFlags = D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_HEVC_FLAG_NONE;
        let codec_config = if hevc {
            D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_HEVC>()
                    as u32,
                Anonymous: D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_0 {
                    pHEVCConfig: &mut hevc_config,
                },
            }
        } else {
            D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_H264>()
                    as u32,
                Anonymous: D3D12_VIDEO_ENCODER_CODEC_CONFIGURATION_0 {
                    pH264Config: &mut h264_config,
                },
            }
        };
        let codec = if hevc {
            D3D12_VIDEO_ENCODER_CODEC_HEVC
        } else {
            D3D12_VIDEO_ENCODER_CODEC_H264
        };
        let mut h264_level = D3D12_VIDEO_ENCODER_LEVELS_H264_51;
        let mut hevc_level = windows::Win32::Media::MediaFoundation::D3D12_VIDEO_ENCODER_LEVEL_TIER_CONSTRAINTS_HEVC {
            Level: D3D12_VIDEO_ENCODER_LEVELS_HEVC_51,
            Tier: D3D12_VIDEO_ENCODER_TIER_HEVC_MAIN,
        };
        let level = level_setting(hevc, &mut h264_level, &mut hevc_level);
        let encoder_desc = windows::Win32::Media::MediaFoundation::D3D12_VIDEO_ENCODER_DESC {
            NodeMask: 0,
            Flags: D3D12_VIDEO_ENCODER_FLAG_NONE,
            EncodeCodec: codec,
            EncodeProfile: profile,
            InputFormat: DXGI_FORMAT_NV12,
            CodecConfiguration: codec_config,
            MaxMotionEstimationPrecision:
                D3D12_VIDEO_ENCODER_MOTION_ESTIMATION_PRECISION_MODE_MAXIMUM,
        };

        let resolution = D3D12_VIDEO_ENCODER_PICTURE_RESOLUTION_DESC {
            Width: width,
            Height: height,
        };
        let mut h264_gop = D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_H264 {
            GOPLength: 1,
            PPicturePeriod: 1,
            pic_order_cnt_type: 0,
            log2_max_frame_num_minus4: 0,
            log2_max_pic_order_cnt_lsb_minus4: 0,
        };
        let mut hevc_gop = D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_HEVC {
            GOPLength: 1,
            PPicturePeriod: 1,
            log2_max_pic_order_cnt_lsb_minus4: 0,
        };
        let codec_gop = if hevc {
            D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_HEVC>()
                    as u32,
                Anonymous: D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_0 {
                    pHEVCGroupOfPictures: &mut hevc_gop,
                },
            }
        } else {
            D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_H264>()
                    as u32,
                Anonymous: D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_0 {
                    pH264GroupOfPictures: &mut h264_gop,
                },
            }
        };
        let mut cbr = D3D12_VIDEO_ENCODER_RATE_CONTROL_CBR {
            InitialQP: 0,
            MinQP: 0,
            MaxQP: 51,
            MaxFrameBitSize: encoded_buffer_capacity(width, height).saturating_mul(8),
            TargetBitRate: bitrate.max(1),
            VBVCapacity: bitrate.max(1),
            InitialVBVFullness: bitrate.max(1) / 2,
        };
        let rate_control = D3D12_VIDEO_ENCODER_RATE_CONTROL {
            Mode: D3D12_VIDEO_ENCODER_RATE_CONTROL_MODE_CBR,
            Flags: D3D12_VIDEO_ENCODER_RATE_CONTROL_FLAG_NONE,
            ConfigParams: D3D12_VIDEO_ENCODER_RATE_CONTROL_CONFIGURATION_PARAMS {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_RATE_CONTROL_CBR>() as u32,
                Anonymous: D3D12_VIDEO_ENCODER_RATE_CONTROL_CONFIGURATION_PARAMS_0 {
                    pConfiguration_CBR: &mut cbr,
                },
            },
            TargetFrameRate: rational(fps),
        };
        let mut support = D3D12_FEATURE_DATA_VIDEO_ENCODER_SUPPORT {
            NodeIndex: 0,
            Codec: codec,
            InputFormat: DXGI_FORMAT_NV12,
            CodecConfiguration: codec_config,
            CodecGopSequence: codec_gop,
            RateControl: rate_control,
            IntraRefresh: D3D12_VIDEO_ENCODER_INTRA_REFRESH_MODE_NONE,
            SubregionFrameEncoding: D3D12_VIDEO_ENCODER_FRAME_SUBREGION_LAYOUT_MODE_FULL_FRAME,
            ResolutionsListCount: 1,
            pResolutionList: &resolution,
            MaxReferenceFramesInDPB: 0,
            ..Default::default()
        };
        unsafe {
            video_device.CheckFeatureSupport(
                windows::Win32::Media::MediaFoundation::D3D12_FEATURE_VIDEO_ENCODER_SUPPORT,
                (&mut support as *mut D3D12_FEATURE_DATA_VIDEO_ENCODER_SUPPORT).cast(),
                std::mem::size_of::<D3D12_FEATURE_DATA_VIDEO_ENCODER_SUPPORT>() as u32,
            )
        }
        .map_err(|error| format!("failed to query D3D12 video encoder support: {error}"))?;
        if !support
            .SupportFlags
            .contains(D3D12_VIDEO_ENCODER_SUPPORT_FLAG_GENERAL_SUPPORT_OK)
        {
            return Err(format!(
                "D3D12 video encoder configuration is unsupported: validation_flags=0x{:x}",
                support.ValidationFlags.0
            ));
        }

        let mut requirements = D3D12_FEATURE_DATA_VIDEO_ENCODER_RESOURCE_REQUIREMENTS {
            NodeIndex: 0,
            Codec: codec,
            Profile: profile,
            InputFormat: DXGI_FORMAT_NV12,
            PictureTargetResolution: resolution,
            ..Default::default()
        };
        unsafe {
            video_device.CheckFeatureSupport(
                D3D12_FEATURE_VIDEO_ENCODER_RESOURCE_REQUIREMENTS,
                (&mut requirements
                    as *mut D3D12_FEATURE_DATA_VIDEO_ENCODER_RESOURCE_REQUIREMENTS)
                    .cast(),
                std::mem::size_of::<D3D12_FEATURE_DATA_VIDEO_ENCODER_RESOURCE_REQUIREMENTS>()
                    as u32,
            )
        }
        .map_err(|error| format!("failed to query D3D12 video encoder resource requirements: {error}"))?;
        if !requirements.IsSupported.as_bool() {
            return Err("D3D12 video encoder resource requirements are unsupported".to_string());
        }
        let bitstream_alignment = u64::from(requirements.CompressedBitstreamBufferAccessAlignment.max(1));
        let metadata_alignment = u64::from(requirements.EncoderMetadataBufferAccessAlignment.max(1));
        let metadata_size = align_up(
            u64::from(requirements.MaxEncoderOutputMetadataBufferSize.max(
                std::mem::size_of::<D3D12_VIDEO_ENCODER_OUTPUT_METADATA>() as u32,
            )),
            metadata_alignment,
        );
        crate::logging::write(&format!(
            "[Export:WinGPU] encoder requirements bitstream_alignment={} metadata_alignment={} metadata_size={}",
            bitstream_alignment, metadata_alignment, metadata_size,
        ));

        let encoder: ID3D12VideoEncoder =
            unsafe { video_device.CreateVideoEncoder::<ID3D12VideoEncoder>(&encoder_desc) }
                .map_err(|error| format!("failed to create D3D12 video encoder: {error}"))?;
        let heap_desc = D3D12_VIDEO_ENCODER_HEAP_DESC {
            NodeMask: 0,
            Flags: D3D12_VIDEO_ENCODER_HEAP_FLAG_NONE,
            EncodeCodec: codec,
            EncodeProfile: profile,
            EncodeLevel: level,
            ResolutionsListCount: 1,
            pResolutionList: &resolution,
        };
        let heap: ID3D12VideoEncoderHeap =
            unsafe { video_device.CreateVideoEncoderHeap::<ID3D12VideoEncoderHeap>(&heap_desc) }
                .map_err(|error| format!("failed to create D3D12 video encoder heap: {error}"))?;

        let allocator: ID3D12CommandAllocator =
            unsafe { device.CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_VIDEO_ENCODE) }
                .map_err(|error| {
                    format!("failed to create D3D12 video-encode allocator: {error}")
                })?;
        let command_list: ID3D12VideoEncodeCommandList2 = unsafe {
            device.CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_VIDEO_ENCODE, &allocator, None)
        }
        .map_err(|error| format!("failed to create D3D12 video-encode command list: {error}"))?;
        unsafe { command_list.Close() }
            .map_err(|error| format!("failed to close D3D12 video-encode command list: {error}"))?;
        let bitstream_capacity = align_up(
            encoded_buffer_capacity(width, height),
            bitstream_alignment,
        );
        let bitstream = create_buffer(
            device,
            D3D12_HEAP_TYPE_READBACK,
            bitstream_capacity,
            D3D12_RESOURCE_STATE_COMMON,
        )?;
        let metadata = create_buffer(
            device,
            D3D12_HEAP_TYPE_DEFAULT,
            metadata_size,
            D3D12_RESOURCE_STATE_COMMON,
        )?;
        let resolved_metadata = create_buffer(
            device,
            D3D12_HEAP_TYPE_READBACK,
            metadata_size,
            D3D12_RESOURCE_STATE_COMMON,
        )?;
        let fence: ID3D12Fence = unsafe { device.CreateFence(0, D3D12_FENCE_FLAG_NONE) }
            .map_err(|error| format!("failed to create D3D12 video-encode fence: {error}"))?;

        let sequence_header = if hevc {
            return Err("D3D12 HEVC export sequence headers are not implemented yet".to_string());
        } else {
            h264_sequence_header(width, height)
        };
        let aligned_header_size = align_up(sequence_header.len() as u64, bitstream_alignment);
        if aligned_header_size > bitstream_capacity {
            return Err(format!(
                "D3D12 encoder sequence header is larger than the bitstream buffer: {} > {}",
                aligned_header_size, bitstream_capacity
            ));
        }
        write_bitstream_header(&bitstream, &sequence_header, aligned_header_size)?;

        crate::logging::write(&format!(
            "[Export:WinGPU] encoder backend=d3d12-video codec={} input=NV12 output=AnnexB bitstream_capacity={}B",
            if hevc { "hevc" } else { "h264" },
            bitstream_capacity,
        ));
        Ok(Self {
            queue: queue.clone(),
            allocator,
            command_list,
            encoder,
            heap,
            bitstream,
            metadata,
            resolved_metadata,
            bitstream_capacity,
            bitstream_alignment,
            metadata_size,
            metadata_alignment,
            sequence_header,
            aligned_header_size,
            fence,
            next_fence_value: 1,
            width,
            height,
            fps: fps.max(1.0),
            bitrate,
            hevc,
            output_path: output_path.to_path_buf(),
            output: Some(output),
            finished: false,
        })
    }

    pub(crate) fn append(
        &mut self,
        input: &ID3D12Resource,
        frame_index: u64,
    ) -> Result<(), String> {
        let desc = unsafe { input.GetDesc() };
        if desc.Format != DXGI_FORMAT_NV12
            || desc.Width != u64::from(self.width)
            || desc.Height != self.height
        {
            return Err(format!(
                "D3D12 encoder input must be NV12 {}x{}, got format={} {}x{}",
                self.width, self.height, desc.Format.0, desc.Width, desc.Height
            ));
        }

        self.begin_command_list()?;
        let mut barriers = vec![
            transition_barrier(
                input,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_READ,
            ),
            transition_barrier(
                &self.bitstream,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_WRITE,
            ),
            transition_barrier(
                &self.metadata,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_WRITE,
            ),
        ];
        unsafe { self.command_list.ResourceBarrier(&barriers) };
        release_barriers(&mut barriers);

        let mut h264_gop = D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_H264 {
            GOPLength: 1,
            PPicturePeriod: 1,
            pic_order_cnt_type: 0,
            log2_max_frame_num_minus4: 0,
            log2_max_pic_order_cnt_lsb_minus4: 0,
        };
        let mut hevc_gop = D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_HEVC {
            GOPLength: 1,
            PPicturePeriod: 1,
            log2_max_pic_order_cnt_lsb_minus4: 0,
        };
        let gop = if self.hevc {
            D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_HEVC>()
                    as u32,
                Anonymous: D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_0 {
                    pHEVCGroupOfPictures: &mut hevc_gop,
                },
            }
        } else {
            D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_H264>()
                    as u32,
                Anonymous: D3D12_VIDEO_ENCODER_SEQUENCE_GOP_STRUCTURE_0 {
                    pH264GroupOfPictures: &mut h264_gop,
                },
            }
        };
        let mut cbr = D3D12_VIDEO_ENCODER_RATE_CONTROL_CBR {
            InitialQP: 0,
            MinQP: 0,
            MaxQP: 51,
            MaxFrameBitSize: self.bitstream_capacity.saturating_mul(8),
            TargetBitRate: self.bitrate.max(1),
            VBVCapacity: self.bitrate.max(1),
            InitialVBVFullness: self.bitrate.max(1) / 2,
        };
        let rate_control = D3D12_VIDEO_ENCODER_RATE_CONTROL {
            Mode: D3D12_VIDEO_ENCODER_RATE_CONTROL_MODE_CBR,
            Flags: D3D12_VIDEO_ENCODER_RATE_CONTROL_FLAG_NONE,
            ConfigParams: D3D12_VIDEO_ENCODER_RATE_CONTROL_CONFIGURATION_PARAMS {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_RATE_CONTROL_CBR>() as u32,
                Anonymous: D3D12_VIDEO_ENCODER_RATE_CONTROL_CONFIGURATION_PARAMS_0 {
                    pConfiguration_CBR: &mut cbr,
                },
            },
            TargetFrameRate: rational(self.fps),
        };
        let sequence = D3D12_VIDEO_ENCODER_SEQUENCE_CONTROL_DESC {
            Flags: D3D12_VIDEO_ENCODER_SEQUENCE_CONTROL_FLAG_NONE,
            IntraRefreshConfig: Default::default(),
            RateControl: rate_control,
            PictureTargetResolution: D3D12_VIDEO_ENCODER_PICTURE_RESOLUTION_DESC {
                Width: self.width,
                Height: self.height,
            },
            SelectedLayoutMode: D3D12_VIDEO_ENCODER_FRAME_SUBREGION_LAYOUT_MODE_FULL_FRAME,
            FrameSubregionsLayoutData: Default::default(),
            CodecGopSequence: gop,
        };

        let mut h264_picture = D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_H264::default();
        h264_picture.FrameType = D3D12_VIDEO_ENCODER_FRAME_TYPE_H264_IDR_FRAME;
        h264_picture.pic_parameter_set_id = 0;
        h264_picture.idr_pic_id = frame_index as u32;
        h264_picture.PictureOrderCountNumber = frame_index as u32;
        h264_picture.FrameDecodingOrderNumber = frame_index as u32;
        let mut hevc_picture = D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_HEVC::default();
        hevc_picture.FrameType = D3D12_VIDEO_ENCODER_FRAME_TYPE_HEVC_IDR_FRAME;
        hevc_picture.PictureOrderCountNumber = frame_index as u32;
        hevc_picture.TemporalLayerIndex = 0;
        let picture_codec_data = if self.hevc {
            D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_HEVC>()
                    as u32,
                Anonymous: D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_0 {
                    pHEVCPicData: &mut hevc_picture,
                },
            }
        } else {
            D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA {
                DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_H264>()
                    as u32,
                Anonymous: D3D12_VIDEO_ENCODER_PICTURE_CONTROL_CODEC_DATA_0 {
                    pH264PicData: &mut h264_picture,
                },
            }
        };
        let picture = D3D12_VIDEO_ENCODER_PICTURE_CONTROL_DESC {
            IntraRefreshFrameIndex: 0,
            Flags: D3D12_VIDEO_ENCODER_PICTURE_CONTROL_FLAG_NONE,
            PictureControlCodecData: picture_codec_data,
            ReferenceFrames: Default::default(),
        };
        let mut input_args = D3D12_VIDEO_ENCODER_ENCODEFRAME_INPUT_ARGUMENTS {
            SequenceControlDesc: sequence,
            PictureControlDesc: picture,
            pInputFrame: ManuallyDrop::new(Some(input.clone())),
            InputFrameSubresource: 0,
            CurrentFrameBitstreamMetadataSize: if frame_index == 0 {
                self.aligned_header_size as u32
            } else {
                0
            },
        };
        let mut output_args = D3D12_VIDEO_ENCODER_ENCODEFRAME_OUTPUT_ARGUMENTS {
            Bitstream: D3D12_VIDEO_ENCODER_COMPRESSED_BITSTREAM {
                pBuffer: ManuallyDrop::new(Some(self.bitstream.clone())),
                FrameStartOffset: if frame_index == 0 {
                    self.aligned_header_size
                } else {
                    0
                },
            },
            ReconstructedPicture: Default::default(),
            EncoderOutputMetadata: D3D12_VIDEO_ENCODER_ENCODE_OPERATION_METADATA_BUFFER {
                pBuffer: ManuallyDrop::new(Some(self.metadata.clone())),
                Offset: 0,
            },
        };
        unsafe {
            self.command_list
                .EncodeFrame(&self.encoder, &self.heap, &input_args, &output_args);
            ManuallyDrop::drop(&mut input_args.pInputFrame);
            ManuallyDrop::drop(&mut output_args.Bitstream.pBuffer);
            ManuallyDrop::drop(&mut output_args.EncoderOutputMetadata.pBuffer);
        }
        let mut after_encode = vec![
            transition_barrier(
                input,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_READ,
                D3D12_RESOURCE_STATE_COMMON,
            ),
            transition_barrier(
                &self.bitstream,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_WRITE,
                D3D12_RESOURCE_STATE_COMMON,
            ),
            transition_barrier(
                &self.metadata,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_WRITE,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_READ,
            ),
            transition_barrier(
                &self.resolved_metadata,
                D3D12_RESOURCE_STATE_COMMON,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_WRITE,
            ),
        ];
        unsafe { self.command_list.ResourceBarrier(&after_encode) };
        release_barriers(&mut after_encode);

        let mut h264_profile = D3D12_VIDEO_ENCODER_PROFILE_H264_MAIN;
        let mut hevc_profile = D3D12_VIDEO_ENCODER_PROFILE_HEVC_MAIN;
        let profile = profile_desc(self.hevc, &mut h264_profile, &mut hevc_profile);
        let resolve_input =
            windows::Win32::Media::MediaFoundation::D3D12_VIDEO_ENCODER_RESOLVE_METADATA_INPUT_ARGUMENTS {
                EncoderCodec: if self.hevc {
                    D3D12_VIDEO_ENCODER_CODEC_HEVC
                } else {
                    D3D12_VIDEO_ENCODER_CODEC_H264
                },
                EncoderProfile: profile,
                EncoderInputFormat: DXGI_FORMAT_NV12,
                EncodedPictureEffectiveResolution: D3D12_VIDEO_ENCODER_PICTURE_RESOLUTION_DESC {
                    Width: self.width,
                    Height: self.height,
                },
                HWLayoutMetadata:
                    D3D12_VIDEO_ENCODER_ENCODE_OPERATION_METADATA_BUFFER {
                        pBuffer: ManuallyDrop::new(Some(self.metadata.clone())),
                        Offset: 0,
                    },
            };
        let resolve_output =
            windows::Win32::Media::MediaFoundation::D3D12_VIDEO_ENCODER_RESOLVE_METADATA_OUTPUT_ARGUMENTS {
                ResolvedLayoutMetadata:
                    D3D12_VIDEO_ENCODER_ENCODE_OPERATION_METADATA_BUFFER {
                        pBuffer: ManuallyDrop::new(Some(self.resolved_metadata.clone())),
                        Offset: 0,
                    },
            };
        unsafe {
            self.command_list
                .ResolveEncoderOutputMetadata(&resolve_input, &resolve_output);
            ManuallyDrop::drop(&mut resolve_input.HWLayoutMetadata.pBuffer);
            ManuallyDrop::drop(&mut resolve_output.ResolvedLayoutMetadata.pBuffer);
        }
        let mut after_resolve = vec![
            transition_barrier(
                &self.metadata,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_READ,
                D3D12_RESOURCE_STATE_COMMON,
            ),
            transition_barrier(
                &self.resolved_metadata,
                D3D12_RESOURCE_STATE_VIDEO_ENCODE_WRITE,
                D3D12_RESOURCE_STATE_COMMON,
            ),
        ];
        unsafe { self.command_list.ResourceBarrier(&after_resolve) };
        release_barriers(&mut after_resolve);
        self.submit_video_and_wait()?;

        let metadata = self.read_metadata()?;
        if metadata.EncodeErrorFlags != 0 {
            return Err(format!(
                "D3D12 video encoder reported encode error flags=0x{:x}",
                metadata.EncodeErrorFlags
            ));
        }
        let written = metadata.EncodedBitstreamWrittenBytesCount;
        if written == 0 || written > self.bitstream_capacity {
            return Err(format!(
                "D3D12 video encoder returned invalid bitstream length {} (capacity {})",
                written, self.bitstream_capacity
            ));
        }

        let bytes = self.readback_bytes(
            if frame_index == 0 {
                self.aligned_header_size
            } else {
                0
            },
            written,
        )?;
        let output = self
            .output
            .as_mut()
            .ok_or_else(|| "D3D12 bitstream output is already closed".to_string())?
            .write_all(if frame_index == 0 {
                &self.sequence_header
            } else {
                &[]
            })
            .map_err(|error| format!("failed to write encoded bitstream: {error}"))?;
        output
            .write_all(&bytes)
            .map_err(|error| format!("failed to write encoded bitstream: {error}"))?;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<(), String> {
        if let Some(mut output) = self.output.take() {
            output
                .flush()
                .map_err(|error| format!("failed to flush D3D12 bitstream: {error}"))?;
        }
        self.finished = true;
        Ok(())
    }

    fn begin_command_list(&self) -> Result<(), String> {
        unsafe { self.allocator.Reset() }
            .map_err(|error| format!("failed to reset D3D12 video-encode allocator: {error}"))?;
        unsafe { self.command_list.Reset(&self.allocator) }
            .map_err(|error| format!("failed to reset D3D12 video-encode command list: {error}"))
    }

    fn begin_copy_command_list(&self) -> Result<(), String> {
        unsafe { self.copy_allocator.Reset() }
            .map_err(|error| format!("failed to reset D3D12 copy allocator: {error}"))?;
        unsafe {
            self.copy_command_list.Reset(
                &self.copy_allocator,
                None::<&windows::Win32::Graphics::Direct3D12::ID3D12PipelineState>,
            )
        }
        .map_err(|error| format!("failed to reset D3D12 copy command list: {error}"))
    }

    fn submit_video_and_wait(&mut self) -> Result<(), String> {
        unsafe { self.command_list.Close() }
            .map_err(|error| format!("failed to close D3D12 video-encode command list: {error}"))?;
        let command_list: ID3D12CommandList = self
            .command_list
            .cast()
            .map_err(|error| format!("failed to cast D3D12 video-encode command list: {error}"))?;
        unsafe { self.queue.ExecuteCommandLists(&[Some(command_list)]) };
        let fence_value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.saturating_add(1);
        unsafe { self.queue.Signal(&self.fence, fence_value) }
            .map_err(|error| format!("failed to signal D3D12 video-encode fence: {error}"))?;
        let deadline = std::time::Instant::now() + ENCODE_WAIT_TIMEOUT;
        loop {
            let completed = unsafe { self.fence.GetCompletedValue() };
            if completed >= fence_value {
                return Ok(());
            }
            if completed == u64::MAX {
                return Err("D3D12 device was removed during video encoding".to_string());
            }
            if std::time::Instant::now() >= deadline {
                return Err("timed out waiting for D3D12 video encoding".to_string());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn submit_copy_and_wait(&mut self) -> Result<(), String> {
        unsafe { self.copy_command_list.Close() }
            .map_err(|error| format!("failed to close D3D12 copy command list: {error}"))?;
        let command_list: ID3D12CommandList = self
            .copy_command_list
            .cast()
            .map_err(|error| format!("failed to cast D3D12 copy command list: {error}"))?;
        unsafe { self.copy_queue.ExecuteCommandLists(&[Some(command_list)]) };
        let fence_value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.saturating_add(1);
        unsafe { self.copy_queue.Signal(&self.fence, fence_value) }
            .map_err(|error| format!("failed to signal D3D12 copy fence: {error}"))?;
        let deadline = std::time::Instant::now() + ENCODE_WAIT_TIMEOUT;
        loop {
            let completed = unsafe { self.fence.GetCompletedValue() };
            if completed >= fence_value {
                return Ok(());
            }
            if completed == u64::MAX {
                return Err("D3D12 device was removed during encoded bitstream copy".to_string());
            }
            if std::time::Instant::now() >= deadline {
                return Err("timed out waiting for encoded bitstream copy".to_string());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn read_metadata(&self) -> Result<D3D12_VIDEO_ENCODER_OUTPUT_METADATA, String> {
        let range = D3D12_RANGE {
            Begin: 0,
            End: std::mem::size_of::<D3D12_VIDEO_ENCODER_OUTPUT_METADATA>(),
        };
        let mut pointer = std::ptr::null_mut();
        unsafe {
            self.metadata_readback
                .Map(0, Some(&range as *const _), Some(&mut pointer))
        }
        .map_err(|error| format!("failed to map D3D12 encode metadata: {error}"))?;
        let metadata = unsafe { *(pointer as *const D3D12_VIDEO_ENCODER_OUTPUT_METADATA) };
        unsafe { self.metadata_readback.Unmap(0, Some(&range as *const _)) };
        Ok(metadata)
    }

    fn readback_bytes(&self, length: u64) -> Result<Vec<u8>, String> {
        let range = D3D12_RANGE {
            Begin: 0,
            End: length as usize,
        };
        let mut pointer = std::ptr::null_mut();
        unsafe {
            self.bitstream_readback
                .Map(0, Some(&range as *const _), Some(&mut pointer))
        }
        .map_err(|error| format!("failed to map D3D12 encoded bitstream: {error}"))?;
        let bytes = unsafe { std::slice::from_raw_parts(pointer as *const u8, length as usize) };
        let result = bytes.to_vec();
        unsafe { self.bitstream_readback.Unmap(0, Some(&range as *const _)) };
        Ok(result)
    }
}

impl Drop for VideoEncoder {
    fn drop(&mut self) {
        self.output.take();
        if !self.finished {
            let _ = std::fs::remove_file(&self.output_path);
        }
    }
}

fn encoded_buffer_capacity(width: u32, height: u32) -> u64 {
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    pixels.saturating_mul(2).saturating_add(4 * 1024 * 1024)
}

fn profile_desc(
    hevc: bool,
    h264_profile: &mut D3D12_VIDEO_ENCODER_PROFILE_H264,
    hevc_profile: &mut D3D12_VIDEO_ENCODER_PROFILE_HEVC,
) -> D3D12_VIDEO_ENCODER_PROFILE_DESC {
    if hevc {
        D3D12_VIDEO_ENCODER_PROFILE_DESC {
            DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_PROFILE_HEVC>() as u32,
            Anonymous: D3D12_VIDEO_ENCODER_PROFILE_DESC_0 {
                pHEVCProfile: hevc_profile,
            },
        }
    } else {
        D3D12_VIDEO_ENCODER_PROFILE_DESC {
            DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_PROFILE_H264>() as u32,
            Anonymous: D3D12_VIDEO_ENCODER_PROFILE_DESC_0 {
                pH264Profile: h264_profile,
            },
        }
    }
}

fn level_setting(
    hevc: bool,
    h264_level: &mut D3D12_VIDEO_ENCODER_LEVELS_H264,
    hevc_level: &mut windows::Win32::Media::MediaFoundation::D3D12_VIDEO_ENCODER_LEVEL_TIER_CONSTRAINTS_HEVC,
) -> D3D12_VIDEO_ENCODER_LEVEL_SETTING {
    if hevc {
        D3D12_VIDEO_ENCODER_LEVEL_SETTING {
            DataSize: std::mem::size_of::<windows::Win32::Media::MediaFoundation::D3D12_VIDEO_ENCODER_LEVEL_TIER_CONSTRAINTS_HEVC>() as u32,
            Anonymous: D3D12_VIDEO_ENCODER_LEVEL_SETTING_0 {
                pHEVCLevelSetting: hevc_level,
            },
        }
    } else {
        D3D12_VIDEO_ENCODER_LEVEL_SETTING {
            DataSize: std::mem::size_of::<D3D12_VIDEO_ENCODER_LEVELS_H264>() as u32,
            Anonymous: D3D12_VIDEO_ENCODER_LEVEL_SETTING_0 {
                pH264LevelSetting: h264_level,
            },
        }
    }
}

fn rational(fps: f64) -> DXGI_RATIONAL {
    let numerator = (fps * 1000.0).round().max(1.0) as u32;
    DXGI_RATIONAL {
        Numerator: numerator,
        Denominator: 1000,
    }
}

fn create_buffer(
    device: &ID3D12Device,
    heap_type: windows::Win32::Graphics::Direct3D12::D3D12_HEAP_TYPE,
    size: u64,
    initial_state: windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_STATES,
) -> Result<ID3D12Resource, String> {
    let heap_properties = if heap_type == D3D12_HEAP_TYPE_DEFAULT {
        unsafe { device.GetCustomHeapProperties(0, heap_type) }
    } else {
        D3D12_HEAP_PROPERTIES {
            Type: heap_type,
            CPUPageProperty: D3D12_CPU_PAGE_PROPERTY_UNKNOWN,
            MemoryPoolPreference: D3D12_MEMORY_POOL_UNKNOWN,
            CreationNodeMask: 1,
            VisibleNodeMask: 1,
        }
    };
    let desc = D3D12_RESOURCE_DESC {
        Dimension: D3D12_RESOURCE_DIMENSION_BUFFER,
        Alignment: 0,
        Width: size.max(256),
        Height: 1,
        DepthOrArraySize: 1,
        MipLevels: 1,
        Format: DXGI_FORMAT(0),
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Layout: D3D12_TEXTURE_LAYOUT_ROW_MAJOR,
        Flags: D3D12_RESOURCE_FLAGS(0),
    };
    let mut resource = None;
    unsafe {
        device.CreateCommittedResource(
            &heap_properties,
            D3D12_HEAP_FLAG_NONE,
            &desc,
            initial_state,
            None,
            &mut resource,
        )
    }
    .map_err(|error| format!("failed to create D3D12 encoder buffer: {error}"))?;
    resource.ok_or_else(|| "D3D12 encoder buffer was not returned".to_string())
}

fn transition_barrier(
    resource: &ID3D12Resource,
    state_before: windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_STATES,
    state_after: windows::Win32::Graphics::Direct3D12::D3D12_RESOURCE_STATES,
) -> D3D12_RESOURCE_BARRIER {
    D3D12_RESOURCE_BARRIER {
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

unsafe fn release_barrier(barrier: &mut D3D12_RESOURCE_BARRIER) {
    let transition = &mut *barrier.Anonymous.Transition;
    let _ = ManuallyDrop::take(&mut transition.pResource);
}

fn release_barriers(barriers: &mut [D3D12_RESOURCE_BARRIER]) {
    for barrier in barriers {
        unsafe { release_barrier(barrier) };
    }
}
