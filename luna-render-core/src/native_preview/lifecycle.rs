use std::sync::atomic::Ordering;
use std::sync::mpsc;

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;

use super::{
    run_native_preview_session, CreateNativePreviewSessionInput, PreviewCommand,
    PreviewSessionHandle, PreviewSessionStatsState, NEXT_SESSION_ID, PREVIEW_SESSIONS,
};

fn native_window_pointer(handle: &[u8]) -> Result<usize, String> {
    if handle.len() < std::mem::size_of::<usize>() {
        return Err("窗口句柄无效".to_string());
    }
    let mut bytes = [0u8; std::mem::size_of::<usize>()];
    bytes.copy_from_slice(&handle[..std::mem::size_of::<usize>()]);
    Ok(usize::from_ne_bytes(bytes))
}

pub struct CreateNativePreviewSessionTask {
    input: Option<CreateNativePreviewSessionInput>,
}

impl Task for CreateNativePreviewSessionTask {
    type Output = u32;
    type JsValue = u32;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            return Err(napi::Error::from_reason("当前平台尚未接入原生 GPU 预览"));
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let input = self
                .input
                .take()
                .ok_or_else(|| napi::Error::from_reason("预览参数已经使用"))?;
            let parent_view =
                native_window_pointer(&input.window_handle).map_err(napi::Error::from_reason)?;
            let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
            let (command_sender, command_receiver) = mpsc::channel();
            let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
            let stats = std::sync::Arc::new(PreviewSessionStatsState::default());
            let thread_stats = stats.clone();
            let worker = std::thread::Builder::new()
                .name(format!("luna-native-preview-{session_id}"))
                .spawn(move || {
                    run_native_preview_session(
                        session_id,
                        input,
                        parent_view,
                        command_receiver,
                        ready_sender,
                        thread_stats,
                    )
                })
                .map_err(|error| {
                    napi::Error::from_reason(format!("无法启动原生预览线程: {error}"))
                })?;

            let ready = match ready_receiver.recv() {
                Ok(ready) => ready,
                Err(_) => {
                    let _ = worker.join();
                    return Err(napi::Error::from_reason("原生预览线程启动中断"));
                }
            };
            if let Err(error) = ready {
                let _ = worker.join();
                return Err(napi::Error::from_reason(error));
            }
            let mut sessions = match PREVIEW_SESSIONS.lock() {
                Ok(sessions) => sessions,
                Err(error) => {
                    let _ = command_sender.send(PreviewCommand::Shutdown);
                    let _ = worker.join();
                    return Err(napi::Error::from_reason(format!(
                        "预览会话锁定失败: {error}"
                    )));
                }
            };
            sessions.insert(
                session_id,
                PreviewSessionHandle {
                    sender: command_sender,
                    stats,
                    worker,
                },
            );
            Ok(session_id)
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct DestroyNativePreviewSessionTask {
    session_id: u32,
}

impl Task for DestroyNativePreviewSessionTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let session = PREVIEW_SESSIONS
            .lock()
            .map_err(|error| napi::Error::from_reason(format!("预览会话锁定失败: {error}")))?
            .remove(&self.session_id);
        if let Some(session) = session {
            crate::logging::write(&format!(
                "[NativePreview] session={} shutdown requested",
                self.session_id
            ));
            let _ = session.sender.send(PreviewCommand::Shutdown);
            session.worker.join().map_err(|_| {
                napi::Error::from_reason(format!("预览会话 {} 退出异常", self.session_id))
            })?;
        }
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

#[napi]
pub fn create_native_preview_session(
    input: CreateNativePreviewSessionInput,
) -> AsyncTask<CreateNativePreviewSessionTask> {
    AsyncTask::new(CreateNativePreviewSessionTask { input: Some(input) })
}

#[napi]
pub fn destroy_native_preview_session(
    session_id: u32,
) -> AsyncTask<DestroyNativePreviewSessionTask> {
    AsyncTask::new(DestroyNativePreviewSessionTask { session_id })
}
