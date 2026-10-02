//! Shared CPU-only ONNX session initialization for inference workers.
use ort::{ep, session::Session};
use std::path::Path;

pub fn load(path: impl AsRef<Path>, threads: usize) -> ort::Result<Session> {
    Session::builder()?
        .with_intra_threads(threads)?
        .with_execution_providers([ep::CPU::default().build().error_on_failure()])?
        .commit_from_file(path)
}
