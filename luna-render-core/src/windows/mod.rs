mod capabilities;
mod converter;
mod decoder;
mod device;
mod encoder;
mod export;
mod preview;
mod preview_surface;

pub(crate) use preview::NativePreviewRuntime;
pub(crate) use preview_surface::PreviewBounds;

use crate::composition::{is_video_source, CompositionInput};
use crate::compositor::Compositor;
use crate::export::TaskState;
use std::sync::Arc;
use windows::Win32::Media::MediaFoundation::{MFShutdown, MFStartup, MFSTARTUP_FULL, MF_VERSION};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

pub(crate) struct ComGuard;

impl ComGuard {
    pub(crate) fn start() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| format!("无法初始化视频工作线程: {error}"))?;
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub(crate) struct MediaFoundationGuard;

impl MediaFoundationGuard {
    pub(crate) fn start() -> Result<Self, String> {
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }
            .map_err(|error| format!("无法启动系统视频服务: {error}"))?;
        Ok(Self)
    }
}

impl Drop for MediaFoundationGuard {
    fn drop(&mut self) {
        let _ = unsafe { MFShutdown() };
    }
}

/// Windows 零回读导出入口。
///
/// Media Foundation 解码、D3D11 视频处理、wgpu 合成与硬件编码均使用同一
/// D3D12 队列，成功路径不会读取或复制 CPU 像素。
#[allow(clippy::too_many_arguments)]
pub(crate) fn export_video(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    output_path: &str,
    composition: &CompositionInput,
    fps: f64,
    total_frames: u64,
    bitrate: u64,
    include_audio: bool,
    task: Option<&Arc<TaskState>>,
) -> Result<(), String> {
    let _com = ComGuard::start()?;
    let _mf = MediaFoundationGuard::start()?;
    let (d3d12_device, d3d12_queue) = compositor.dx12_device_and_queue()?;
    let interop = device::InteropDevice::new(&d3d12_device, &d3d12_queue)?;
    let encoders = capabilities::probe_hardware_encoders()?;

    crate::logging::write(&format!(
        "[Export:WinGPU] capabilities d3d11on12=true h264={} hevc={}",
        encoders.h264, encoders.hevc,
    ));
    if let Some(layer) = composition
        .layers
        .iter()
        .find(|layer| is_video_source(&layer.source))
    {
        let mut decoder = decoder::VideoDecoder::open(&layer.source.path, &interop.device_manager)?;
        let frame = decoder
            .read_frame_at(0)?
            .ok_or_else(|| "视频中没有可解码的画面".to_string())?;
        decoder::validate_d3d12_interop(&frame, &interop.d3d11on12_device, &d3d12_queue)?;
        crate::logging::write(&format!(
            "[Export:WinGPU] decoder=media-foundation output={} size={}x{} rotation={} subresource={} sharing=d3d11on12-unwrap",
            frame.format.label(),
            frame.width,
            frame.height,
            decoder.info().rotation_degrees,
            frame.subresource_index,
        ));
    }

    if !encoders.any() {
        return Err("未找到可用的系统硬件视频编码器".to_string());
    }
    let hevc = !encoders.h264 && encoders.hevc;

    crate::logging::write(&format!(
        "[Export:WinGPU] pipeline=mf-decode,d3d11-video-process,wgpu-compose,mf-{} sync=d3d12-fence readback=false",
        if hevc { "hevc" } else { "h264" },
    ));
    export::run(
        compositor,
        ffmpeg_path,
        ffprobe_path,
        output_path,
        composition,
        fps,
        total_frames,
        bitrate,
        include_audio,
        hevc,
        task,
        &interop,
        &d3d12_device,
        &d3d12_queue,
    )
}
