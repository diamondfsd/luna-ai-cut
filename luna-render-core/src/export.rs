//! 导出任务状态管理 & 质量预设 — 供 composition.rs 使用

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

// ── 多任务导出状态 ──

struct TaskProcs {
    decode: Option<std::process::Child>,
    encode: Option<std::process::Child>,
}

pub struct TaskState {
    cancel: AtomicBool,
    pub current_frame: AtomicU64,
    pub total_frames: AtomicU64,
    procs: Mutex<TaskProcs>,
}

impl TaskState {
    fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            current_frame: AtomicU64::new(0),
            total_frames: AtomicU64::new(0),
            procs: Mutex::new(TaskProcs {
                decode: None,
                encode: None,
            }),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn store_procs(&self, decode: std::process::Child, encode: std::process::Child) {
        if let Ok(mut procs) = self.procs.lock() {
            procs.decode = Some(decode);
            procs.encode = Some(encode);
        }
    }

    pub fn take_procs(&self) -> (Option<std::process::Child>, Option<std::process::Child>) {
        if let Ok(mut procs) = self.procs.lock() {
            (procs.decode.take(), procs.encode.take())
        } else {
            (None, None)
        }
    }
}

static EXPORT_TASKS: LazyLock<Mutex<HashMap<String, Arc<TaskState>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 注册导出任务，返回 TaskState 供内部读写
pub fn register_task(task_id: &str) -> Arc<TaskState> {
    let state = Arc::new(TaskState::new());
    if let Ok(mut map) = EXPORT_TASKS.lock() {
        map.insert(task_id.to_string(), state.clone());
    }
    state
}

/// 取消指定任务
pub fn cancel_task(task_id: &str) {
    if let Ok(map) = EXPORT_TASKS.lock() {
        if let Some(state) = map.get(task_id) {
            state.cancel.store(true, Ordering::SeqCst);
            if let Ok(mut procs) = state.procs.lock() {
                if let Some(ref mut p) = procs.decode {
                    let _ = p.kill();
                }
                if let Some(ref mut p) = procs.encode {
                    let _ = p.kill();
                }
            }
        }
    }
}

/// 查询任务进度
pub fn task_progress(task_id: &str) -> Option<(u64, u64)> {
    EXPORT_TASKS.lock().ok().and_then(|map| {
        map.get(task_id).map(|s| {
            (
                s.current_frame.load(Ordering::Relaxed),
                s.total_frames.load(Ordering::Relaxed),
            )
        })
    })
}

/// 清理已完成的任务状态
pub fn cleanup_task(task_id: &str) {
    if let Ok(mut map) = EXPORT_TASKS.lock() {
        map.remove(task_id);
    }
}

// ── 质量预设 ──

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum QualityPreset {
    Small,
    Standard,
    High,
    OriginalLike,
}

impl QualityPreset {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "small" => QualityPreset::Small,
            "high" => QualityPreset::High,
            "original-like" | "originallike" => QualityPreset::OriginalLike,
            _ => QualityPreset::Standard,
        }
    }
}

// (编码器探测和旧的导出函数已移除，由 composition.rs 中的 export_composition_video_async / export_composition_image_async 替代)
