//! Standalone probe for the project's neural-preset-v1-256 model.
use ort::{ep, session::Session, value::Tensor};
use std::{collections::BTreeMap, env, error::Error, fs, path::Path, time::Instant};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

struct Measurement {
    output: Vec<f32>,
    load_ms: f64,
    first_ms: f64,
    median_ms: f64,
    provider_events: BTreeMap<String, usize>,
}

fn provider(name: &str) -> Result<ep::ExecutionProviderDispatch> {
    match name {
        "cpu" => Ok(ep::CPU::default().build().error_on_failure()),
        #[cfg(target_os = "macos")]
        "coreml" | "coreml-gpu" => Ok(ep::CoreML::default()
            .with_model_format(ep::coreml::ModelFormat::MLProgram)
            .with_compute_units(if name == "coreml-gpu" {
                ep::coreml::ComputeUnits::CPUAndGPU
            } else {
                ep::coreml::ComputeUnits::All
            })
            .build()
            .error_on_failure()),
        #[cfg(target_os = "windows")]
        "directml" => Ok(ep::DirectML::default()
            .with_device_id(0)
            .build()
            .error_on_failure()),
        _ => Err(format!("Provider {name} is not supported on this platform").into()),
    }
}

fn infer(session: &mut Session) -> Result<Vec<f32>> {
    let len = 3 * 256 * 256;
    // Identical deterministic, non-constant inputs for both providers.
    let content: Vec<f32> = (0..len).map(|i| (i % 251) as f32 / 250.0).collect();
    let style: Vec<f32> = (0..len)
        .map(|i| ((i * 7 + 13) % 241) as f32 / 240.0)
        .collect();
    let outputs = session.run(ort::inputs![
        "content" => Tensor::from_array(([1usize, 3, 256, 256], content))?,
        "style" => Tensor::from_array(([1usize, 3, 256, 256], style))?,
    ])?;
    let output = outputs
        .iter()
        .find(|(name, _)| *name == "colored_content")
        .or_else(|| outputs.iter().nth(1))
        .ok_or("Missing colored_content output")?
        .1;
    let (shape, data) = output.try_extract_tensor::<f32>()?;
    if **shape != [1, 3, 256, 256] || data.iter().any(|v| !v.is_finite()) {
        return Err("Invalid output shape or non-finite values".into());
    }
    Ok(data.to_vec())
}

fn measure(model: &str, name: &str, runs: usize, directory: &Path) -> Result<Measurement> {
    let started = Instant::now();
    let mut session = Session::builder()?
        .with_intra_threads(4)?
        .with_parallel_execution(false)?
        .with_memory_pattern(false)?
        .with_profiling(directory.join(name))?
        .with_execution_providers([provider(name)?])?
        .commit_from_file(model)?;
    let load_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let output = infer(&mut session)?;
    let first_ms = started.elapsed().as_secs_f64() * 1000.0;
    for _ in 0..2 {
        infer(&mut session)?;
    }
    let mut times = Vec::new();
    for _ in 0..runs {
        let started = Instant::now();
        infer(&mut session)?;
        times.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    let profile = session.end_profiling()?;
    let events: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(&profile)?)?;
    let mut provider_events = BTreeMap::new();
    for event in events {
        if let Some(provider) = event["args"]["provider"].as_str() {
            *provider_events.entry(provider.to_string()).or_insert(0) += 1;
        }
    }
    println!("{name}: load={load_ms:.2}ms first={first_ms:.2}ms median={:.2}ms\n  execution_events={provider_events:?}\n  profile={profile}", times[times.len()/2]);
    Ok(Measurement {
        output,
        load_ms,
        first_ms,
        median_ms: times[times.len() / 2],
        provider_events,
    })
}

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 6 {
        return Err("Usage: luna-onnx-provider-probe <runtime-library> <neural-preset-model> <cpu|coreml|coreml-gpu|directml> <runs> <profile-directory>".into());
    }
    let runs: usize = args[4].parse()?;
    if !(1..=1000).contains(&runs) {
        return Err("runs must be 1..1000".into());
    }
    provider(&args[3])?;
    fs::create_dir_all(&args[5])?;
    ort::init_from(&args[1])?
        .with_name("luna-provider-probe")
        .commit();
    let cpu = measure(&args[2], "cpu", runs, Path::new(&args[5]))?;
    if args[3] == "cpu" {
        return Ok(());
    }
    let accelerated = measure(&args[2], &args[3], runs, Path::new(&args[5]))?;
    let expected = if args[3].starts_with("coreml") {
        "CoreMLExecutionProvider"
    } else {
        "DmlExecutionProvider"
    };
    if !accelerated.provider_events.contains_key(expected) {
        return Err(
            format!("No execution events for {expected}; acceleration not verified").into(),
        );
    }
    if cpu.output.len() != accelerated.output.len() {
        return Err("Output sizes differ".into());
    }
    let errors: Vec<f64> = cpu
        .output
        .iter()
        .zip(&accelerated.output)
        .map(|(a, b)| f64::from((a - b).abs()))
        .collect();
    let max_error = errors.iter().copied().fold(0.0, f64::max);
    let mean_error = errors.iter().sum::<f64>() / errors.len() as f64;
    println!(
        "warm_speedup={:.2}x max_abs_error={max_error:.6} mean_abs_error={mean_error:.6}",
        cpu.median_ms / accelerated.median_ms
    );
    println!(
        "cold_total: cpu={:.2}ms accelerated={:.2}ms",
        cpu.load_ms + cpu.first_ms,
        accelerated.load_ms + accelerated.first_ms
    );
    // CoreML may use lower-precision arithmetic. Report differences rather than
    // assert a universal tolerance for all future models and devices.
    println!("EP execution verified; hardware placement inside CoreML and visual quality require separate validation.");
    Ok(())
}
