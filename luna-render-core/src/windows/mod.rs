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

use crate::composition::CompositionInput;
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
            .map_err(|error| format!("failed to initialize the video worker thread: {error}"))?;
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
            .map_err(|error| format!("failed to start the system video service: {error}"))?;
        Ok(Self)
    }
}

impl Drop for MediaFoundationGuard {
    fn drop(&mut self) {
        let _ = unsafe { MFShutdown() };
    }
}

/// Windows zero-copy export entry point.
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
    legacy_input_mode: bool,
) -> Result<(), String> {
    let _com = ComGuard::start()?;
    let _mf = MediaFoundationGuard::start()?;
    let (d3d12_device, d3d12_queue) = compositor.dx12_device_and_queue()?;
    let interop = device::InteropDevice::new(&d3d12_device)?;
    let encoders = capabilities::probe_hardware_encoders()?;

    crate::logging::write(&format!(
        "[Export:WinGPU] backend=d3d12-video pixel_transport=GPU bitstream_readback=CPU h264={} hevc={}",
        encoders.h264, encoders.hevc,
    ));
    if !encoders.any() {
        return Err("no usable hardware video encoder was found".to_string());
    }
    let hevc = !encoders.h264 && encoders.hevc;
    crate::logging::write(&format!(
        "[Export:WinGPU] pipeline=mf-d3d12-decode,d3d12-video-process,wgpu-compose,d3d12-video-encode codec={} sync=d3d12-fence",
        if hevc { "hevc" } else { "h264" },
    ));

    let result = export::run(
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
        legacy_input_mode,
    );
    if result.is_err() {
        interop.log_device_status("d3d12 export failure");
    }
    result
}
