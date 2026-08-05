use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::composition::CompositionInput;

mod lifecycle;
pub use lifecycle::{create_native_preview_session, destroy_native_preview_session};

const MAX_COMMANDS_PER_FRAME: usize = 64;

static NEXT_SESSION_ID: AtomicU32 = AtomicU32::new(1);
static PREVIEW_SESSIONS: LazyLock<Mutex<HashMap<u32, PreviewSessionHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PREVIEW_RUNTIME: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Default)]
struct PreviewSessionStatsState {
    rendered_frames: AtomicU32,
    render_errors: AtomicU32,
    last_render_error: Mutex<Option<String>>,
    current_time_bits: std::sync::atomic::AtomicU64,
    cache_hits: AtomicU32,
    cache_misses: AtomicU32,
}

struct PreviewSessionHandle {
    sender: Sender<PreviewCommand>,
    stats: std::sync::Arc<PreviewSessionStatsState>,
    worker: std::thread::JoinHandle<()>,
}

#[napi(object)]
#[derive(Clone, Copy)]
pub struct NativePreviewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

#[napi(object)]
#[derive(Clone)]
pub struct CreateNativePreviewSessionInput {
    pub window_handle: Buffer,
    pub bounds: NativePreviewBounds,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub composition: CompositionInput,
    pub log_path: Option<String>,
}

enum PreviewCommand {
    UpdateComposition(CompositionInput),
    SetBounds(NativePreviewBounds),
    SetVisible(bool),
    Play(f64),
    Pause(f64),
    Seek(f64),
    Shutdown,
}

/// 原生实时预览所需的平台能力。
///
/// 目前 macOS 和 Windows 已在导出路径中具备系统硬解码与外部 GPU 纹理导入，
/// 但工作台尚未创建可直接呈现的原生 Surface，因此不能宣称完整零回读。
#[napi(object)]
pub struct NativePreviewCapabilities {
    pub platform: String,
    pub decoder: String,
    pub system_hardware_decode: bool,
    pub external_gpu_texture: bool,
    pub direct_gpu_presentation: bool,
}

#[napi(object)]
pub struct NativePreviewSessionStats {
    pub rendered_frames: u32,
    pub render_errors: u32,
    pub last_render_error: Option<String>,
    pub current_time: f64,
    pub cache_hits: u32,
    pub cache_misses: u32,
}

#[napi]
pub fn get_native_preview_capabilities() -> NativePreviewCapabilities {
    #[cfg(target_os = "macos")]
    let (platform, decoder, system_hardware_decode, external_gpu_texture) =
        ("macos", "AVFoundation / VideoToolbox", true, true);

    #[cfg(target_os = "windows")]
    let (platform, decoder, system_hardware_decode, external_gpu_texture, direct_gpu_presentation) =
        if crate::current_preview_backend() == Some(wgpu::Backend::Dx12) {
            ("windows", "Media Foundation", true, true, true)
        } else {
            ("windows", "FFmpeg compatibility", false, false, false)
        };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (platform, decoder, system_hardware_decode, external_gpu_texture, direct_gpu_presentation) =
        (std::env::consts::OS, "FFmpeg fallback", false, false, false);

    #[cfg(target_os = "macos")]
    let direct_gpu_presentation = true;

    NativePreviewCapabilities {
        platform: platform.to_string(),
        decoder: decoder.to_string(),
        system_hardware_decode,
        external_gpu_texture,
        direct_gpu_presentation,
    }
}

fn send_command(session_id: u32, command: PreviewCommand) -> napi::Result<()> {
    let sender = PREVIEW_SESSIONS
        .lock()
        .map_err(|error| napi::Error::from_reason(format!("预览会话锁定失败: {error}")))?
        .get(&session_id)
        .map(|session| session.sender.clone())
        .ok_or_else(|| napi::Error::from_reason("预览会话不存在"))?;
    if sender.send(command).is_err() {
        if let Ok(mut sessions) = PREVIEW_SESSIONS.lock() {
            if let Some(session) = sessions.remove(&session_id) {
                let _ = session.worker.join();
            }
        }
        return Err(napi::Error::from_reason("预览会话已经结束"));
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn run_native_preview_session(
    session_id: u32,
    input: CreateNativePreviewSessionInput,
    parent_view: usize,
    receiver: Receiver<PreviewCommand>,
    ready: mpsc::SyncSender<Result<(), String>>,
    stats: std::sync::Arc<PreviewSessionStatsState>,
) {
    #[cfg(target_os = "macos")]
    use crate::macos::{NativePreviewRuntime, PreviewBounds};
    #[cfg(target_os = "windows")]
    use crate::windows::{NativePreviewRuntime, PreviewBounds};

    crate::logging::write(&format!(
        "[NativePreview] session={session_id} waiting for runtime"
    ));
    let _runtime_guard = PREVIEW_RUNTIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    crate::logging::write(&format!("[NativePreview] session={session_id} starting"));
    let bounds = PreviewBounds {
        x: input.bounds.x,
        y: input.bounds.y,
        width: input.bounds.width,
        height: input.bounds.height,
        scale_factor: input.bounds.scale_factor,
    };
    let mut runtime = match NativePreviewRuntime::new(
        {
            #[cfg(target_os = "macos")]
            {
                parent_view as *mut std::ffi::c_void
            }
            #[cfg(target_os = "windows")]
            {
                parent_view
            }
        },
        bounds,
        input.ffmpeg_path,
        input.ffprobe_path,
        input.composition,
        input.log_path.as_deref(),
    ) {
        Ok(runtime) => {
            let _ = ready.send(Ok(()));
            runtime
        }
        Err(error) => {
            let _ = ready.send(Err(error));
            crate::logging::error(&format!(
                "[NativePreview] session={session_id} failed to start"
            ));
            return;
        }
    };

    let frame_interval = Duration::from_secs_f64(1.0 / 30.0);
    let mut current_time = 0.0f64;
    let mut playing = false;
    let mut play_started_at = Instant::now();
    let mut play_started_time = 0.0f64;
    let mut next_frame_at = Instant::now();
    let mut render_requested = true;
    let mut last_error_log = Instant::now() - Duration::from_secs(10);

    loop {
        let timeout = if playing {
            next_frame_at.saturating_duration_since(Instant::now())
        } else if render_requested {
            Duration::ZERO
        } else {
            Duration::from_millis(100)
        };
        match receiver.recv_timeout(timeout) {
            Ok(command) => {
                if !apply_command(
                    command,
                    &mut runtime,
                    &mut current_time,
                    &mut playing,
                    &mut play_started_at,
                    &mut play_started_time,
                    &mut render_requested,
                ) {
                    break;
                }
                // Keep a continuous stream of UI updates from starving rendering forever.
                // Remaining commands stay queued for the next loop iteration.
                for _ in 1..MAX_COMMANDS_PER_FRAME {
                    let Ok(command) = receiver.try_recv() else {
                        break;
                    };
                    if !apply_command(
                        command,
                        &mut runtime,
                        &mut current_time,
                        &mut playing,
                        &mut play_started_at,
                        &mut play_started_time,
                        &mut render_requested,
                    ) {
                        return;
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        #[cfg(target_os = "windows")]
        runtime.pump_events();

        let now = Instant::now();
        if playing && now >= next_frame_at {
            current_time = play_started_time + now.duration_since(play_started_at).as_secs_f64();
            render_requested = true;
            next_frame_at = now + frame_interval;
        }
        if render_requested {
            stats
                .current_time_bits
                .store(current_time.to_bits(), Ordering::Relaxed);
            match runtime.render(current_time) {
                Ok(result) => {
                    if result.presented {
                        stats.rendered_frames.fetch_add(1, Ordering::Relaxed);
                    }
                    stats
                        .cache_hits
                        .fetch_add(result.cache_hits, Ordering::Relaxed);
                    stats
                        .cache_misses
                        .fetch_add(result.cache_misses, Ordering::Relaxed);
                }
                Err(error) => {
                    stats.render_errors.fetch_add(1, Ordering::Relaxed);
                    if let Ok(mut last_render_error) = stats.last_render_error.lock() {
                        *last_render_error = Some(error.clone());
                    }
                    playing = false;
                    if last_error_log.elapsed() >= Duration::from_secs(1) {
                        crate::logging::error(&format!(
                            "[NativePreview] render time={current_time:.3}: {error}"
                        ));
                        last_error_log = Instant::now();
                    }
                }
            }
            render_requested = false;
        }
    }
    drop(runtime);
    crate::logging::write(&format!("[NativePreview] session={session_id} stopped"));
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[allow(clippy::too_many_arguments)]
fn apply_command(
    command: PreviewCommand,
    runtime: &mut PlatformNativePreviewRuntime,
    current_time: &mut f64,
    playing: &mut bool,
    play_started_at: &mut Instant,
    play_started_time: &mut f64,
    render_requested: &mut bool,
) -> bool {
    #[cfg(target_os = "macos")]
    use crate::macos::PreviewBounds;
    #[cfg(target_os = "windows")]
    use crate::windows::PreviewBounds;

    match command {
        PreviewCommand::UpdateComposition(composition) => {
            runtime.update_composition(composition);
            *render_requested = true;
        }
        PreviewCommand::SetBounds(bounds) => {
            #[cfg(target_os = "macos")]
            runtime.set_bounds(PreviewBounds {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                scale_factor: bounds.scale_factor,
            });
            #[cfg(target_os = "windows")]
            if let Err(error) = runtime.set_bounds(PreviewBounds {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                scale_factor: bounds.scale_factor,
            }) {
                crate::logging::error(&format!("[NativePreview] resize: {error}"));
            }
            *render_requested = true;
        }
        PreviewCommand::SetVisible(visible) => runtime.set_visible(visible),
        PreviewCommand::Play(time) => {
            *current_time = time.max(0.0);
            *play_started_time = *current_time;
            *play_started_at = Instant::now();
            *playing = true;
            *render_requested = true;
        }
        PreviewCommand::Pause(time) => {
            *current_time = time.max(0.0);
            *playing = false;
            // The swap chain already contains the last presented frame. Re-rendering here
            // forces an unnecessary D3D11On12 synchronization and can stall on Windows.
            // An initial pending render remains pending; explicit seeks still request a frame.
        }
        PreviewCommand::Seek(time) => {
            *current_time = time.max(0.0);
            *play_started_time = *current_time;
            *play_started_at = Instant::now();
            *render_requested = true;
        }
        PreviewCommand::Shutdown => return false,
    }
    true
}

#[cfg(target_os = "macos")]
type PlatformNativePreviewRuntime = crate::macos::NativePreviewRuntime;
#[cfg(target_os = "windows")]
type PlatformNativePreviewRuntime = crate::windows::NativePreviewRuntime;

#[napi]
pub fn update_native_preview_composition(
    session_id: u32,
    composition: CompositionInput,
) -> napi::Result<()> {
    send_command(session_id, PreviewCommand::UpdateComposition(composition))
}

#[napi]
pub fn set_native_preview_bounds(session_id: u32, bounds: NativePreviewBounds) -> napi::Result<()> {
    send_command(session_id, PreviewCommand::SetBounds(bounds))
}

#[napi]
pub fn set_native_preview_visible(session_id: u32, visible: bool) -> napi::Result<()> {
    send_command(session_id, PreviewCommand::SetVisible(visible))
}

#[napi]
pub fn play_native_preview(session_id: u32, time: f64) -> napi::Result<()> {
    send_command(session_id, PreviewCommand::Play(time))
}

#[napi]
pub fn pause_native_preview(session_id: u32, time: f64) -> napi::Result<()> {
    send_command(session_id, PreviewCommand::Pause(time))
}

#[napi]
pub fn seek_native_preview(session_id: u32, time: f64) -> napi::Result<()> {
    send_command(session_id, PreviewCommand::Seek(time))
}

#[napi]
pub fn get_native_preview_session_stats(
    session_id: u32,
) -> napi::Result<NativePreviewSessionStats> {
    let stats = PREVIEW_SESSIONS
        .lock()
        .map_err(|error| napi::Error::from_reason(format!("预览会话锁定失败: {error}")))?
        .get(&session_id)
        .map(|session| session.stats.clone())
        .ok_or_else(|| napi::Error::from_reason("预览会话不存在"))?;
    let last_render_error = stats
        .last_render_error
        .lock()
        .map_err(|error| napi::Error::from_reason(format!("预览错误信息读取失败: {error}")))?
        .clone();
    Ok(NativePreviewSessionStats {
        rendered_frames: stats.rendered_frames.load(Ordering::Relaxed),
        render_errors: stats.render_errors.load(Ordering::Relaxed),
        last_render_error,
        current_time: f64::from_bits(stats.current_time_bits.load(Ordering::Relaxed)),
        cache_hits: stats.cache_hits.load(Ordering::Relaxed),
        cache_misses: stats.cache_misses.load(Ordering::Relaxed),
    })
}

#[cfg(test)]
mod tests {
    use super::get_native_preview_capabilities;

    #[test]
    fn native_preview_capabilities_are_consistent() {
        let capabilities = get_native_preview_capabilities();
        if capabilities.direct_gpu_presentation {
            assert!(capabilities.system_hardware_decode);
            assert!(capabilities.external_gpu_texture);
        }
        #[cfg(target_os = "macos")]
        assert!(capabilities.direct_gpu_presentation);
        assert!(!capabilities.platform.is_empty());
        assert!(!capabilities.decoder.is_empty());
    }
}
