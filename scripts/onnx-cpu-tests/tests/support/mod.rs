mod fixtures;
use crate::onnx_session::load;
use ort::session::SessionOutputs;
use serde::Deserialize;
use std::{env, error::Error, fs, path::PathBuf, time::Instant};

pub type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Deserialize)]
pub struct Model {
    id: String,
    path: String,
    kind: String,
    width: usize,
    height: usize,
}

fn test_model(model: &Model) -> Result<serde_json::Value> {
    let mut session = load(&model.path, 4)?;
    let inputs = fixtures::inputs(&session, model)?;
    let mut counts = Vec::new();
    for _ in 0..2 {
        let started = Instant::now();
        let outputs: SessionOutputs<'_> = session.run(
            inputs
                .iter()
                .map(|(name, value)| (name.as_str(), value))
                .collect::<Vec<_>>(),
        )?;
        if outputs.len() == 0 {
            return Err("empty outputs".into());
        }
        for (name, value) in outputs.iter() {
            if let Ok((_, values)) = value.try_extract_tensor::<f32>() {
                if values.iter().any(|v| !v.is_finite()) {
                    return Err(format!("non-finite output: {name}").into());
                }
            }
        }
        counts.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    Ok(serde_json::json!({"id": model.id, "cpu": true, "runMs": counts}))
}

pub fn run() {
    #[cfg(feature = "dynamic-runtime")]
    let runtime = env::var("LUNA_ONNX_TEST_RUNTIME")
        .expect("Run via scripts/test-onnx-cpu.mjs --runtime <library>");
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
        match test_model(&model) {
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
}
