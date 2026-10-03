#[path = "../../../luna-render-core/src/onnx_session.rs"]
mod onnx_session;
mod support;
#[test]
fn all_models_cpu() {
    support::run();
}
