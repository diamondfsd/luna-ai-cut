#[path = "../../../luna-render-core/src/onnx_session.rs"]
mod onnx_session;
mod support;

#[test]
#[cfg(target_os = "macos")]
fn macos_coreml_all_models_and_cpu_fallback() {
    support::run("CoreMLExecutionProvider");
}

#[test]
#[cfg(target_os = "windows")]
fn windows_directml_all_models_and_cpu_fallback() {
    support::run("DmlExecutionProvider");
}
