use std::ffi::{c_void, CStr};
use std::ptr;

use libloading::Library;
use nvidia_video_codec_sdk::sys::nvEncodeAPI::*;
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HMODULE};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11Device1, ID3D11DeviceContext, ID3D11Resource,
    ID3D11Texture2D, ID3D11VideoContext, ID3D11VideoDevice, ID3D11VideoProcessor,
    ID3D11VideoProcessorEnumerator, ID3D11VideoProcessorOutputView, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_VIDEO_ENCODER, D3D11_CREATE_DEVICE_FLAG, D3D11_SDK_VERSION, D3D11_TEX2D_VPIV,
    D3D11_TEX2D_VPOV, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_CONTENT_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_STREAM, D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    D3D11_VPIV_DIMENSION_TEXTURE2D, D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Direct3D12::{ID3D12CommandQueue, ID3D12Device, ID3D12Resource};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory2, IDXGIAdapter, IDXGIFactory4, DXGI_CREATE_FACTORY_FLAGS,
};

use super::encoder_backend::{
    CodecHeaders, EncodedPacket, EncoderBackend, EncoderBackendKind, EncoderConfig, EncoderFrame,
    EncoderPixelFormat, VideoCodec,
};

pub(crate) struct NvencEncoder {
    _library: Library,
    api: NV_ENCODE_API_FUNCTION_LIST,
    encoder: *mut c_void,
    config: EncoderConfig,
    d3d12_device: ID3D12Device,
    d3d11_device: ID3D11Device1,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    video_enumerator: ID3D11VideoProcessorEnumerator,
    video_processor: ID3D11VideoProcessor,
    nv12_texture: ID3D11Texture2D,
    nv12_output_view: ID3D11VideoProcessorOutputView,
    output_bitstream: NV_ENC_OUTPUT_PTR,
}

impl NvencEncoder {
    pub(crate) fn new(
        device: &ID3D12Device,
        _queue: &ID3D12CommandQueue,
        config: EncoderConfig,
    ) -> Result<Self, String> {
        let library = unsafe { Library::new("nvEncodeAPI64.dll") }
            .map_err(|error| format!("NVENC driver library is unavailable: {error}"))?;
        let get_max_version = unsafe {
            library
                .get::<unsafe extern "C" fn(*mut u32) -> NVENCSTATUS>(
                    b"NvEncodeAPIGetMaxSupportedVersion\0",
                )
                .map_err(|error| format!("NVENC version entry point is unavailable: {error}"))?
        };
        let create_instance = unsafe {
            library
                .get::<unsafe extern "C" fn(*mut NV_ENCODE_API_FUNCTION_LIST) -> NVENCSTATUS>(
                    b"NvEncodeAPICreateInstance\0",
                )
                .map_err(|error| format!("NVENC API entry point is unavailable: {error}"))?
        };
        let mut driver_version = 0;
        check_status(
            unsafe { get_max_version(&mut driver_version) },
            ptr::null_mut(),
            None,
        )?;
        let driver_api = (driver_version >> 4, driver_version & 0xf);
        let required_api = (NVENCAPI_MAJOR_VERSION, NVENCAPI_MINOR_VERSION);
        if driver_api < required_api {
            return Err(format!(
                "NVENC driver API {}.{} is older than required {}.{}",
                driver_version >> 4,
                driver_version & 0xf,
                NVENCAPI_MAJOR_VERSION,
                NVENCAPI_MINOR_VERSION,
            ));
        }

        let mut api = NV_ENCODE_API_FUNCTION_LIST {
            version: NV_ENCODE_API_FUNCTION_LIST_VER,
            ..Default::default()
        };
        check_status(unsafe { create_instance(&mut api) }, ptr::null_mut(), None)?;

        let (d3d11_device, d3d11_context) = create_d3d11_device(device)?;
        let mut encoder = ptr::null_mut();
        let mut open = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS {
            version: NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER,
            deviceType: NV_ENC_DEVICE_TYPE::NV_ENC_DEVICE_TYPE_DIRECTX,
            device: d3d11_device.as_raw(),
            apiVersion: NVENCAPI_VERSION,
            ..Default::default()
        };
        let open_session = required(api.nvEncOpenEncodeSessionEx, "nvEncOpenEncodeSessionEx")?;
        check_status(
            unsafe { open_session(&mut open, &mut encoder) },
            encoder,
            api.nvEncGetLastErrorString,
        )?;

        let init_result = initialize_encoder(&api, encoder, config);
        if let Err(error) = init_result {
            if let Some(destroy) = api.nvEncDestroyEncoder {
                let _ = unsafe { destroy(encoder) };
            }
            return Err(error);
        }
        let (
            video_device,
            video_context,
            video_enumerator,
            video_processor,
            nv12_texture,
            nv12_output_view,
        ) = create_video_pipeline(&d3d11_device, &d3d11_context, config)?;

        let mut output_params = NV_ENC_CREATE_BITSTREAM_BUFFER {
            version: NV_ENC_CREATE_BITSTREAM_BUFFER_VER,
            ..Default::default()
        };
        let create_output = required(api.nvEncCreateBitstreamBuffer, "nvEncCreateBitstreamBuffer")?;
        check_status(
            unsafe { create_output(encoder, &mut output_params) },
            encoder,
            api.nvEncGetLastErrorString,
        )?;

        crate::logging::write(&format!(
            "[Export:WinGPU] encoder backend=nvenc-directx api={}.{} codec=h264 input=BGRA-via-D3D11-video-process output=AnnexB-system-memory",
            driver_version >> 4,
            driver_version & 0xf,
        ));
        Ok(Self {
            _library: library,
            api,
            encoder,
            config,
            d3d12_device: device.clone(),
            d3d11_device,
            video_device,
            video_context,
            video_enumerator,
            video_processor,
            nv12_texture,
            nv12_output_view,
            output_bitstream: output_params.bitstreamBuffer,
        })
    }

    fn encode_frame(&mut self, frame: EncoderFrame, frame_index: u64) -> Result<Vec<u8>, String> {
        if frame.format != EncoderPixelFormat::Bgra8
            || frame.width != self.config.width
            || frame.height != self.config.height
        {
            return Err(format!(
                "NVENC received incompatible frame: format={:?} size={}x{}",
                frame.format, frame.width, frame.height
            ));
        }
        let bgra_texture = self.open_shared_texture(&frame.resource)?;
        self.convert_bgra_to_nv12(&bgra_texture)?;
        self.encode_nv12_texture(frame_index)
    }

    fn encode_nv12_texture(&self, frame_index: u64) -> Result<Vec<u8>, String> {
        let (registered, mapped) = register_raw_resource(
            &self.api,
            self.encoder,
            self.nv12_texture.as_raw(),
            self.config.width,
            self.config.height,
            NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_NV12,
            NV_ENC_BUFFER_USAGE::NV_ENC_INPUT_IMAGE,
        )?;

        let mut picture = NV_ENC_PIC_PARAMS {
            version: NV_ENC_PIC_PARAMS_VER,
            inputWidth: self.config.width,
            inputHeight: self.config.height,
            frameIdx: frame_index as u32,
            inputTimeStamp: frame_index,
            inputDuration: 1,
            inputBuffer: mapped,
            outputBitstream: self.output_bitstream,
            bufferFmt: NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_NV12,
            pictureStruct: NV_ENC_PIC_STRUCT::NV_ENC_PIC_STRUCT_FRAME,
            ..Default::default()
        };
        if frame_index == 0 {
            picture.encodePicFlags = NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_FORCEIDR as u32
                | NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_OUTPUT_SPSPPS as u32;
        }

        let encode = required(self.api.nvEncEncodePicture, "nvEncEncodePicture")?;
        let encode_result = check_status(
            unsafe { encode(self.encoder, &mut picture) },
            self.encoder,
            self.api.nvEncGetLastErrorString,
        );
        let data = match encode_result {
            Ok(()) => self.lock_output(),
            Err(error) => Err(error),
        };
        unregister_resource(&self.api, self.encoder, registered, mapped)?;
        data
    }

    fn open_shared_texture(&self, resource: &ID3D12Resource) -> Result<ID3D11Texture2D, String> {
        let handle = unsafe {
            self.d3d12_device
                .CreateSharedHandle(resource, None, 0x1000_0000, PCWSTR::null())
        }
        .map_err(|error| format!("failed to share D3D12 BGRA texture with D3D11: {error}"))?;
        let opened = unsafe { self.d3d11_device.OpenSharedResource1(handle) }
            .map_err(|error| format!("failed to open BGRA texture in D3D11: {error}"));
        let _ = unsafe { CloseHandle(handle) };
        opened
    }

    fn convert_bgra_to_nv12(&self, input: &ID3D11Texture2D) -> Result<(), String> {
        let resource: ID3D11Resource = input
            .cast()
            .map_err(|error| format!("failed to query D3D11 BGRA resource: {error}"))?;
        let input_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPIV {
                    MipSlice: 0,
                    ArraySlice: 0,
                },
            },
        };
        let mut input_view = None;
        unsafe {
            self.video_device.CreateVideoProcessorInputView(
                &resource,
                &self.video_enumerator,
                &input_desc,
                Some(&mut input_view),
            )
        }
        .map_err(|error| format!("failed to create D3D11 BGRA video input view: {error}"))?;
        let input_view = input_view
            .ok_or_else(|| "D3D11 video processor did not return a BGRA input view".to_string())?;
        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: std::mem::ManuallyDrop::new(Some(input_view)),
            ..Default::default()
        };
        let result = unsafe {
            self.video_context.VideoProcessorBlt(
                &self.video_processor,
                &self.nv12_output_view,
                0,
                std::slice::from_ref(&stream),
            )
        }
        .map_err(|error| format!("D3D11 BGRA to NV12 conversion failed: {error}"));
        unsafe { std::mem::ManuallyDrop::drop(&mut stream.pInputSurface) };
        result
    }

    fn lock_output(&self) -> Result<Vec<u8>, String> {
        let mut lock = NV_ENC_LOCK_BITSTREAM {
            version: NV_ENC_LOCK_BITSTREAM_VER,
            outputBitstream: self.output_bitstream,
            ..Default::default()
        };
        let lock_bitstream = required(self.api.nvEncLockBitstream, "nvEncLockBitstream")?;
        check_status(
            unsafe { lock_bitstream(self.encoder, &mut lock) },
            self.encoder,
            self.api.nvEncGetLastErrorString,
        )?;
        let data = if lock.bitstreamBufferPtr.is_null() || lock.bitstreamSizeInBytes == 0 {
            Vec::new()
        } else {
            unsafe {
                std::slice::from_raw_parts(
                    lock.bitstreamBufferPtr.cast::<u8>(),
                    lock.bitstreamSizeInBytes as usize,
                )
                .to_vec()
            }
        };
        let unlock = required(self.api.nvEncUnlockBitstream, "nvEncUnlockBitstream")?;
        check_status(
            unsafe { unlock(self.encoder, self.output_bitstream) },
            self.encoder,
            self.api.nvEncGetLastErrorString,
        )?;
        Ok(data)
    }
}

impl EncoderBackend for NvencEncoder {
    fn kind(&self) -> EncoderBackendKind {
        EncoderBackendKind::Nvenc
    }

    fn codec(&self) -> VideoCodec {
        VideoCodec::H264
    }

    fn input_format(&self) -> EncoderPixelFormat {
        EncoderPixelFormat::Bgra8
    }

    fn encode(&mut self, frame: EncoderFrame, frame_index: u64) -> Result<EncodedPacket, String> {
        Ok(EncodedPacket {
            data: self.encode_frame(frame, frame_index)?,
            frame_index,
        })
    }

    fn flush(&mut self) -> Result<Vec<EncodedPacket>, String> {
        let mut eos = NV_ENC_PIC_PARAMS {
            version: NV_ENC_PIC_PARAMS_VER,
            encodePicFlags: NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_EOS as u32,
            ..Default::default()
        };
        let encode = required(self.api.nvEncEncodePicture, "nvEncEncodePicture")?;
        check_status(
            unsafe { encode(self.encoder, &mut eos) },
            self.encoder,
            self.api.nvEncGetLastErrorString,
        )?;
        Ok(Vec::new())
    }

    fn headers(&self) -> Result<CodecHeaders, String> {
        Ok(CodecHeaders { data: Vec::new() })
    }
}

impl Drop for NvencEncoder {
    fn drop(&mut self) {
        if let Some(destroy_output) = self.api.nvEncDestroyBitstreamBuffer {
            let _ = unsafe { destroy_output(self.encoder, self.output_bitstream) };
        }
        if let Some(destroy) = self.api.nvEncDestroyEncoder {
            let _ = unsafe { destroy(self.encoder) };
        }
    }
}

fn initialize_encoder(
    api: &NV_ENCODE_API_FUNCTION_LIST,
    encoder: *mut c_void,
    config: EncoderConfig,
) -> Result<(), String> {
    let mut preset = NV_ENC_PRESET_CONFIG {
        version: NV_ENC_PRESET_CONFIG_VER,
        presetCfg: NV_ENC_CONFIG {
            version: NV_ENC_CONFIG_VER,
            ..Default::default()
        },
        ..Default::default()
    };
    let get_preset = required(
        api.nvEncGetEncodePresetConfigEx,
        "nvEncGetEncodePresetConfigEx",
    )?;
    check_status(
        unsafe {
            get_preset(
                encoder,
                NV_ENC_CODEC_H264_GUID,
                NV_ENC_PRESET_P4_GUID,
                NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_HIGH_QUALITY,
                &mut preset,
            )
        },
        encoder,
        api.nvEncGetLastErrorString,
    )?;
    preset.presetCfg.profileGUID = NV_ENC_H264_PROFILE_HIGH_GUID;
    preset.presetCfg.gopLength = (config.fps * 2.0).round().max(1.0) as u32;
    preset.presetCfg.frameIntervalP = 1;
    preset.presetCfg.frameFieldMode =
        NV_ENC_PARAMS_FRAME_FIELD_MODE::NV_ENC_PARAMS_FRAME_FIELD_MODE_FRAME;
    preset.presetCfg.mvPrecision = NV_ENC_MV_PRECISION::NV_ENC_MV_PRECISION_QUARTER_PEL;
    preset.presetCfg.rcParams.rateControlMode = NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_CBR;
    preset.presetCfg.rcParams.averageBitRate = config.bitrate.min(u32::MAX as u64) as u32;
    preset.presetCfg.rcParams.maxBitRate = config.bitrate.min(u32::MAX as u64) as u32;

    let fps_num = (config.fps * 1000.0).round().max(1.0) as u32;
    let mut init = NV_ENC_INITIALIZE_PARAMS {
        version: NV_ENC_INITIALIZE_PARAMS_VER,
        encodeGUID: NV_ENC_CODEC_H264_GUID,
        presetGUID: NV_ENC_PRESET_P4_GUID,
        encodeWidth: config.width,
        encodeHeight: config.height,
        darWidth: config.width,
        darHeight: config.height,
        frameRateNum: fps_num,
        frameRateDen: 1000,
        enablePTD: 1,
        encodeConfig: &mut preset.presetCfg,
        maxEncodeWidth: config.width,
        maxEncodeHeight: config.height,
        tuningInfo: NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_HIGH_QUALITY,
        bufferFormat: NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_NV12,
        ..Default::default()
    };
    let initialize = required(api.nvEncInitializeEncoder, "nvEncInitializeEncoder")?;
    check_status(
        unsafe { initialize(encoder, &mut init) },
        encoder,
        api.nvEncGetLastErrorString,
    )
}

fn register_resource(
    api: &NV_ENCODE_API_FUNCTION_LIST,
    encoder: *mut c_void,
    resource: &ID3D12Resource,
    width: u32,
    height: u32,
    format: NV_ENC_BUFFER_FORMAT,
    usage: NV_ENC_BUFFER_USAGE,
) -> Result<(NV_ENC_REGISTERED_PTR, NV_ENC_INPUT_PTR), String> {
    register_raw_resource(
        api,
        encoder,
        resource.as_raw(),
        width,
        height,
        format,
        usage,
    )
}

fn register_raw_resource(
    api: &NV_ENCODE_API_FUNCTION_LIST,
    encoder: *mut c_void,
    resource: *mut c_void,
    width: u32,
    height: u32,
    format: NV_ENC_BUFFER_FORMAT,
    usage: NV_ENC_BUFFER_USAGE,
) -> Result<(NV_ENC_REGISTERED_PTR, NV_ENC_INPUT_PTR), String> {
    let mut register = NV_ENC_REGISTER_RESOURCE {
        version: NV_ENC_REGISTER_RESOURCE_VER,
        resourceType: NV_ENC_INPUT_RESOURCE_TYPE::NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX,
        width,
        height,
        resourceToRegister: resource,
        bufferFormat: format,
        bufferUsage: usage,
        ..Default::default()
    };
    let register_fn = required(api.nvEncRegisterResource, "nvEncRegisterResource")?;
    check_status(
        unsafe { register_fn(encoder, &mut register) },
        encoder,
        api.nvEncGetLastErrorString,
    )?;
    let mut map = NV_ENC_MAP_INPUT_RESOURCE {
        version: NV_ENC_MAP_INPUT_RESOURCE_VER,
        registeredResource: register.registeredResource,
        ..Default::default()
    };
    let map_fn = required(api.nvEncMapInputResource, "nvEncMapInputResource")?;
    if let Err(error) = check_status(
        unsafe { map_fn(encoder, &mut map) },
        encoder,
        api.nvEncGetLastErrorString,
    ) {
        if let Some(unregister) = api.nvEncUnregisterResource {
            let _ = unsafe { unregister(encoder, register.registeredResource) };
        }
        return Err(error);
    }
    Ok((register.registeredResource, map.mappedResource))
}

fn create_d3d11_device(
    d3d12_device: &ID3D12Device,
) -> Result<(ID3D11Device1, ID3D11DeviceContext), String> {
    let luid = unsafe { d3d12_device.GetAdapterLuid() };
    let factory: IDXGIFactory4 = unsafe { CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0)) }
        .map_err(|error| format!("failed to create DXGI factory for NVENC: {error}"))?;
    let adapter: IDXGIAdapter = unsafe { factory.EnumAdapterByLuid(luid) }
        .map_err(|error| format!("failed to find NVENC adapter by LUID: {error}"))?;
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            &adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_FLAG(0),
            Some(&[D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
    }
    .map_err(|error| format!("failed to create D3D11 NVENC device: {error}"))?;
    let device: ID3D11Device =
        device.ok_or_else(|| "D3D11 did not return an NVENC device".to_string())?;
    let device = device
        .cast()
        .map_err(|error| format!("D3D11.1 is required for shared textures: {error}"))?;
    let context = context.ok_or_else(|| "D3D11 did not return a device context".to_string())?;
    Ok((device, context))
}

#[allow(clippy::type_complexity)]
fn create_video_pipeline(
    device: &ID3D11Device1,
    context: &ID3D11DeviceContext,
    config: EncoderConfig,
) -> Result<
    (
        ID3D11VideoDevice,
        ID3D11VideoContext,
        ID3D11VideoProcessorEnumerator,
        ID3D11VideoProcessor,
        ID3D11Texture2D,
        ID3D11VideoProcessorOutputView,
    ),
    String,
> {
    let video_device: ID3D11VideoDevice = device
        .cast()
        .map_err(|error| format!("D3D11 video processing is unavailable: {error}"))?;
    let video_context: ID3D11VideoContext = context
        .cast()
        .map_err(|error| format!("D3D11 video context is unavailable: {error}"))?;
    let frame_rate = DXGI_RATIONAL {
        Numerator: (config.fps * 1000.0).round().max(1.0) as u32,
        Denominator: 1000,
    };
    let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
        InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
        InputFrameRate: frame_rate,
        InputWidth: config.width,
        InputHeight: config.height,
        OutputFrameRate: frame_rate,
        OutputWidth: config.width,
        OutputHeight: config.height,
        Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    };
    let enumerator = unsafe { video_device.CreateVideoProcessorEnumerator(&content) }
        .map_err(|error| format!("failed to create D3D11 video processor enumerator: {error}"))?;
    let processor = unsafe { video_device.CreateVideoProcessor(&enumerator, 0) }
        .map_err(|error| format!("failed to create D3D11 video processor: {error}"))?;
    let texture_desc = D3D11_TEXTURE2D_DESC {
        Width: config.width,
        Height: config.height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_NV12,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_VIDEO_ENCODER.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut nv12_texture = None;
    unsafe { device.CreateTexture2D(&texture_desc, None, Some(&mut nv12_texture)) }
        .map_err(|error| format!("failed to create D3D11 NV12 encoder texture: {error}"))?;
    let nv12_texture =
        nv12_texture.ok_or_else(|| "D3D11 did not return an NV12 texture".to_string())?;
    let output_resource: ID3D11Resource = nv12_texture
        .cast()
        .map_err(|error| format!("failed to query D3D11 NV12 resource: {error}"))?;
    let output_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
        ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
        Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
            Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
        },
    };
    let mut output_view = None;
    unsafe {
        video_device.CreateVideoProcessorOutputView(
            &output_resource,
            &enumerator,
            &output_desc,
            Some(&mut output_view),
        )
    }
    .map_err(|error| format!("failed to create D3D11 NV12 output view: {error}"))?;
    let output_view = output_view
        .ok_or_else(|| "D3D11 video processor did not return an NV12 output view".to_string())?;
    Ok((
        video_device,
        video_context,
        enumerator,
        processor,
        nv12_texture,
        output_view,
    ))
}

fn unregister_resource(
    api: &NV_ENCODE_API_FUNCTION_LIST,
    encoder: *mut c_void,
    registered: NV_ENC_REGISTERED_PTR,
    mapped: NV_ENC_INPUT_PTR,
) -> Result<(), String> {
    if registered.is_null() {
        return Ok(());
    }
    if !mapped.is_null() {
        let unmap = required(api.nvEncUnmapInputResource, "nvEncUnmapInputResource")?;
        check_status(
            unsafe { unmap(encoder, mapped) },
            encoder,
            api.nvEncGetLastErrorString,
        )?;
    }
    let unregister = required(api.nvEncUnregisterResource, "nvEncUnregisterResource")?;
    check_status(
        unsafe { unregister(encoder, registered) },
        encoder,
        api.nvEncGetLastErrorString,
    )
}

fn required<T: Copy>(function: Option<T>, name: &str) -> Result<T, String> {
    function.ok_or_else(|| format!("NVENC function {name} is unavailable"))
}

fn check_status(
    status: NVENCSTATUS,
    encoder: *mut c_void,
    get_last_error: PNVENCGETLASTERROR,
) -> Result<(), String> {
    if status == NVENCSTATUS::NV_ENC_SUCCESS {
        return Ok(());
    }
    let detail = get_last_error
        .filter(|_| !encoder.is_null())
        .and_then(|function| unsafe {
            let value = function(encoder);
            (!value.is_null()).then(|| CStr::from_ptr(value).to_string_lossy().into_owned())
        })
        .unwrap_or_default();
    Err(if detail.is_empty() {
        format!("NVENC call failed with status {}", status as i32)
    } else {
        format!("NVENC call failed with status {}: {detail}", status as i32)
    })
}

// The raw bindings declare these two SDK entry points as import-library
// symbols. Providing local forwarding symbols keeps the build independent of
// the NVIDIA SDK while the actual implementation still comes from the driver.
#[export_name = "NvEncodeAPIGetMaxSupportedVersion"]
pub unsafe extern "C" fn nvenc_get_max_supported_version_proxy(version: *mut u32) -> NVENCSTATUS {
    let Ok(library) = Library::new("nvEncodeAPI64.dll") else {
        return NVENCSTATUS::NV_ENC_ERR_NO_ENCODE_DEVICE;
    };
    let Ok(function) = library.get::<unsafe extern "C" fn(*mut u32) -> NVENCSTATUS>(
        b"NvEncodeAPIGetMaxSupportedVersion\0",
    ) else {
        return NVENCSTATUS::NV_ENC_ERR_INVALID_CALL;
    };
    function(version)
}

#[export_name = "NvEncodeAPICreateInstance"]
pub unsafe extern "C" fn nvenc_create_instance_proxy(
    functions: *mut NV_ENCODE_API_FUNCTION_LIST,
) -> NVENCSTATUS {
    let Ok(library) = Library::new("nvEncodeAPI64.dll") else {
        return NVENCSTATUS::NV_ENC_ERR_NO_ENCODE_DEVICE;
    };
    let Ok(function) = library
        .get::<unsafe extern "C" fn(*mut NV_ENCODE_API_FUNCTION_LIST) -> NVENCSTATUS>(
            b"NvEncodeAPICreateInstance\0",
        )
    else {
        return NVENCSTATUS::NV_ENC_ERR_INVALID_CALL;
    };
    function(functions)
}
