mod fixtures;
use crate::onnx_session::{ModelKind, Options, Outputs, Policy, Session};
use serde::Deserialize;
use std::{collections::BTreeMap, env, error::Error, fs, path::PathBuf, time::Instant};

pub type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Deserialize)]
pub struct Model {
    id: String,
    path: String,
    kind: String,
    width: usize,
    height: usize,
}

fn compare(reference: &Outputs, actual: &Outputs, exact: bool) -> Result<f32> {
    if reference.len() != actual.len() {
        return Err("output count mismatch".into());
    }
    let mut max_error = 0.0f32;
    for ((name, expected), (actual_name, value)) in reference.iter().zip(actual.iter()) {
        if name != actual_name || expected.dtype() != value.dtype() {
            return Err(format!("output contract mismatch: {name}").into());
        }
        if let Ok((_, a)) = expected.try_extract_tensor::<f32>() {
            let (_, b) = value.try_extract_tensor::<f32>()?;
            for (a, b) in a.iter().zip(b) {
                let error = (a - b).abs();
                max_error = max_error.max(error);
                let tolerance = if exact { 1e-6 } else { 1e-3 + a.abs() * 1e-2 };
                if error > tolerance {
                    return Err(format!(
                        "output {name} differs: {a} vs {b}, tolerance={tolerance}"
                    )
                    .into());
                }
            }
        } else if let Ok((_, a)) = expected.try_extract_tensor::<i64>() {
            if a != value.try_extract_tensor::<i64>()?.1 {
                return Err(format!("integer output differs: {name}").into());
            }
        } else if let Ok((_, a)) = expected.try_extract_tensor::<i32>() {
            if a != value.try_extract_tensor::<i32>()?.1 {
                return Err(format!("integer output differs: {name}").into());
            }
        } else {
            return Err(format!("unvalidated output dtype: {name}").into());
        }
    }
    Ok(max_error)
}

fn test_model(
    model: &Model,
    provider: &str,
    directory: &std::path::Path,
) -> Result<serde_json::Value> {
    let mut cpu_options = Options::new(4);
    cpu_options.policy = Policy::Cpu;
    let mut cpu = Session::load_with_options(&model.path, cpu_options)?;
    let inputs = fixtures::inputs(&cpu, model)?;
    let run_inputs = || {
        inputs
            .iter()
            .map(|(name, value)| (name.as_str(), value))
            .collect::<Vec<_>>()
    };
    let baseline = cpu.run(run_inputs())?;
    drop(cpu);
    let mut options = Options::new(4);
    options.model_kind = match model.id.as_str() {
        "yolo26s-seg" => ModelKind::Yolo26Seg,
        "slimsam-77-uniform-promptDecoder" => ModelKind::SlimSamQuantizedDecoder,
        _ => ModelKind::General,
    };
    options.profile = Some(directory.join(&model.id));
    let started = Instant::now();
    let mut automatic = Session::load_with_options(&model.path, options)?;
    let actual = automatic.run(run_inputs())?;
    let first_ms = started.elapsed().as_secs_f64() * 1000.0;
    let error = compare(&baseline, &actual, false)?;
    drop(actual);
    let started = Instant::now();
    let repeated = automatic.run(run_inputs())?;
    compare(&baseline, &repeated, false)?;
    let warm_ms = started.elapsed().as_secs_f64() * 1000.0;
    drop(repeated);
    let profile = automatic.end_profiling()?;
    let events: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(&profile)?)?;
    let mut counts = BTreeMap::<String, usize>::new();
    for event in events {
        if let Some(name) = event["args"]["provider"].as_str() {
            *counts.entry(name.into()).or_default() += 1;
        }
    }
    let accelerated_execution = counts.get(provider).is_some_and(|n| *n > 0);
    let fallback = automatic.fallback_reason().map(str::to_owned);
    drop(automatic);

    // Fault switches exist only in test builds, never in the application.
    let mut load_fault = Options::new(4);
    load_fault.fail_accelerated_load = true;
    let mut recovered = Session::load_with_options(&model.path, load_fault)?;
    assert!(!recovered.accelerated());
    assert!(recovered.fallback_reason().is_some());
    compare(&baseline, &recovered.run(run_inputs())?, true)?;
    drop(recovered);

    // Start with a real CPU session marked as the accelerated attempt so every
    // model exercises run-failure recovery, even when its real EP cannot load.
    let mut run_fault = Options::new(4);
    run_fault.policy = Policy::Cpu;
    let mut recovered = Session::load_with_options(&model.path, run_fault)?;
    recovered.inject_run_failure();
    compare(&baseline, &recovered.run(run_inputs())?, true)?;
    assert!(!recovered.accelerated());
    assert!(recovered.fallback_reason().is_some());
    compare(&baseline, &recovered.run(run_inputs())?, true)?;

    // A broken input must still fail after the CPU retry. A subsequent valid
    // request succeeds on CPU rather than trying the failing accelerator again.
    recovered.inject_run_failure();
    let invalid: Vec<_> = inputs
        .iter()
        .map(|(name, _)| {
            Ok((
                name.as_str(),
                ort::value::Tensor::from_array(([1usize], vec![0f32]))?,
            ))
        })
        .collect::<ort::Result<_>>()?;
    assert!(recovered.run(invalid).is_err());
    assert!(!recovered.accelerated());
    compare(&baseline, &recovered.run(run_inputs())?, true)?;
    Ok(
        serde_json::json!({"id":model.id,"acceleratedExecution":accelerated_execution,
        "fallbackReason":fallback,"executionEvents":counts,"firstMs":first_ms,"warmMs":warm_ms,
        "maxAbsError":error,"loadFallbackPassed":true,"runFallbackPassed":true,"stickyCpuPassed":true}),
    )
}

pub fn run(provider: &str) {
    #[cfg(feature = "dynamic-runtime")]
    let runtime = env::var("LUNA_ONNX_TEST_RUNTIME")
        .expect("Run via scripts/test-onnx-platform.mjs --runtime <library>");
    let catalog = env::var("LUNA_ONNX_TEST_CATALOG").expect("missing test catalog");
    let directory =
        PathBuf::from(env::var("LUNA_ONNX_TEST_OUTPUT").expect("missing test output directory"));
    fs::create_dir_all(&directory).unwrap();
    #[cfg(feature = "dynamic-runtime")]
    ort::init_from(runtime)
        .unwrap()
        .with_name("luna-all-models-test")
        .commit();
    #[cfg(not(feature = "dynamic-runtime"))]
    ort::init().with_name("luna-all-models-test").commit();
    let models: Vec<Model> = serde_json::from_slice(&fs::read(catalog).unwrap()).unwrap();
    assert!(!models.is_empty());
    let mut reports = Vec::new();
    let mut failures = Vec::new();
    for model in models {
        eprintln!("Testing {}", model.id);
        match test_model(&model, provider, &directory) {
            Ok(report) => {
                eprintln!("{report}");
                reports.push(report);
            }
            Err(error) => {
                failures.push(format!("{}: {error}", model.id));
                reports.push(serde_json::json!({"id":model.id,"error":error.to_string()}));
            }
        }
    }
    fs::write(
        directory.join("report.json"),
        serde_json::to_vec_pretty(&reports).unwrap(),
    )
    .unwrap();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    if env::var("LUNA_ONNX_TEST_ALLOW_CPU_ONLY").as_deref() != Ok("1") {
        assert!(
            reports.iter().any(|r| r["acceleratedExecution"] == true),
            "No model executed on the platform EP; CPU-only compatibility is insufficient"
        );
    }
}
