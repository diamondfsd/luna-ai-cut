#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("windows-gpu-export-test is only available on Windows");
    std::process::exit(2);
}

#[cfg(target_os = "windows")]
fn main() {
    if let Err(error) = run() {
        eprintln!("[windows-gpu-export-test] FAILED: {error}");
        std::process::exit(1);
    }
    eprintln!("[windows-gpu-export-test] OK");
}

#[cfg(target_os = "windows")]
fn run() -> Result<(), String> {
    use std::env;
    use std::fs;
    use std::fs::read_to_string;
    use std::path::PathBuf;

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_dir = manifest_dir
        .parent()
        .ok_or_else(|| "luna-render-core has no project parent".to_string())?;
    let composition_path = argument_path("--composition")
        .unwrap_or_else(|| project_dir.join("test-data/windows-gpu-export-composition.json"));
    let output = argument_path("--output")
        .unwrap_or_else(|| project_dir.join("test-output/windows-gpu-export-rust.mp4"));
    let log_path = argument_path("--log")
        .unwrap_or_else(|| project_dir.join("test-output/windows-gpu-export-rust.log"));
    let ffmpeg = argument_path("--ffmpeg")
        .unwrap_or_else(|| project_dir.join("resources/ffmpeg/ffmpeg.exe"));
    let ffprobe = argument_path("--ffprobe")
        .unwrap_or_else(|| project_dir.join("resources/ffmpeg/ffprobe.exe"));
    let max_seconds = if has_flag("--full") {
        None
    } else {
        Some(
            argument_value("--seconds")?
                .unwrap_or_else(|| "2".to_string())
                .parse::<f64>()
                .map_err(|error| format!("invalid --seconds value: {error}"))?,
        )
    };
    let include_audio = has_flag("--audio");
    let require_gpu = has_flag("--require-gpu");

    let composition_text = read_to_string(&composition_path).map_err(|error| {
        format!(
            "failed to read composition JSON {}: {error}",
            composition_path.display()
        )
    })?;
    let composition: luna_render_core::CompositionInput = serde_json::from_str(&composition_text)
        .map_err(|error| {
        format!(
            "failed to parse composition JSON {}: {error}",
            composition_path.display()
        )
    })?;
    let input = composition
        .layers
        .iter()
        .find(|layer| {
            layer.source.source_type.as_deref() == Some("video")
                || layer.source.path.to_ascii_lowercase().ends_with(".mp4")
        })
        .map(|layer| PathBuf::from(&layer.source.path))
        .ok_or_else(|| "composition JSON has no video layer".to_string())?;

    for (label, path) in [
        ("composition", composition_path.as_path()),
        ("input", input.as_path()),
        ("ffmpeg", ffmpeg.as_path()),
        ("ffprobe", ffprobe.as_path()),
    ] {
        if !path.is_file() {
            return Err(format!("{label} file does not exist: {}", path.display()));
        }
    }
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create output directory: {error}"))?;
    }
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create log directory: {error}"))?;
    }
    if let Some(dxc_path) = [
        env::var_os("LUNA_DXC_PATH").map(PathBuf::from),
        Some(manifest_dir.join("dxcompiler.dll")),
        Some(project_dir.join("luna-render-core/dxcompiler.dll")),
    ]
    .into_iter()
    .flatten()
    .find(|path| path.is_file())
    {
        if env::var_os("LUNA_DXC_PATH").is_none() {
            unsafe { env::set_var("LUNA_DXC_PATH", &dxc_path) };
        }
    }

    eprintln!(
        "[windows-gpu-export-test] composition={} layers={}",
        composition_path.display(),
        composition.layers.len()
    );
    eprintln!("[windows-gpu-export-test] input={}", input.display());
    eprintln!("[windows-gpu-export-test] output={}", output.display());
    eprintln!("[windows-gpu-export-test] log={}", log_path.display());
    eprintln!("[windows-gpu-export-test] ffmpeg={}", ffmpeg.display());
    eprintln!("[windows-gpu-export-test] ffprobe={}", ffprobe.display());
    eprintln!(
        "[windows-gpu-export-test] duration={} audio={} require_gpu={}",
        max_seconds.map_or_else(|| "full".to_string(), |value| format!("{value:.3}s")),
        include_audio,
        require_gpu,
    );

    luna_render_core::run_windows_gpu_export_composition_diagnostic(
        composition,
        &ffmpeg.to_string_lossy(),
        &ffprobe.to_string_lossy(),
        &output.to_string_lossy(),
        &log_path.to_string_lossy(),
        max_seconds,
        include_audio,
        require_gpu,
    )
}

#[cfg(target_os = "windows")]
fn has_flag(flag: &str) -> bool {
    std::env::args().skip(1).any(|argument| argument == flag)
}

#[cfg(target_os = "windows")]
fn argument_value(name: &str) -> Result<Option<String>, String> {
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == name {
            return arguments
                .next()
                .map(Some)
                .ok_or_else(|| format!("missing value for {name}"));
        }
    }
    Ok(None)
}

#[cfg(target_os = "windows")]
fn argument_path(name: &str) -> Option<std::path::PathBuf> {
    argument_value(name)
        .ok()
        .flatten()
        .map(std::path::PathBuf::from)
}
