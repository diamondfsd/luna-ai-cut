//! Shared ONNX session policy for every inference worker.
// Each worker uses only part of this shared API.
#![allow(dead_code)]
use ort::{
    ep,
    session::{Session as OrtSession, SessionInputs},
    value::DynValue,
};
use std::{
    borrow::Cow,
    ops::Index,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Policy {
    Auto,
    Cpu,
    RequireAccelerated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelKind {
    General,
    Yolo26Seg,
    SlimSamQuantizedDecoder,
}

#[derive(Clone, Debug)]
pub struct Options {
    pub threads: usize,
    pub policy: Policy,
    pub model_kind: ModelKind,
    pub profile: Option<PathBuf>,
    #[cfg(test)]
    pub fail_accelerated_load: bool,
    #[cfg(test)]
    pub fail_accelerated_run: bool,
}

impl Options {
    pub fn new(threads: usize) -> Self {
        Self {
            threads,
            policy: Policy::Auto,
            model_kind: ModelKind::General,
            profile: None,
            #[cfg(test)]
            fail_accelerated_load: false,
            #[cfg(test)]
            fail_accelerated_run: false,
        }
    }
}

pub struct Session {
    inner: OrtSession,
    path: PathBuf,
    options: Options,
    accelerated: bool,
    fallback_reason: Option<String>,
}

// Own the output names and retain ORT values (reference counted, no tensor copy).
// This removes a borrow of the failed session before replacing it with CPU.
pub struct Outputs(Vec<(String, DynValue)>);
impl Outputs {
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn iter(&self) -> impl Iterator<Item = (&str, &DynValue)> {
        self.0.iter().map(|(name, value)| (name.as_str(), value))
    }
}
impl Index<usize> for Outputs {
    type Output = DynValue;
    fn index(&self, index: usize) -> &Self::Output {
        &self.0[index].1
    }
}
impl Index<&str> for Outputs {
    type Output = DynValue;
    fn index(&self, name: &str) -> &Self::Output {
        &self
            .0
            .iter()
            .find(|(key, _)| key == name)
            .expect("missing ONNX output")
            .1
    }
}

fn accelerator() -> Option<ep::ExecutionProviderDispatch> {
    #[cfg(target_os = "macos")]
    {
        Some(
            ep::CoreML::default()
                .with_model_format(ep::coreml::ModelFormat::MLProgram)
                .with_compute_units(ep::coreml::ComputeUnits::All)
                // CoreML's native compiler can abort the process for unbounded
                // intermediate shapes; a Rust Result cannot catch that abort.
                // Keep those nodes on ORT CPU, including variable-length audio.
                .with_static_input_shapes(true)
                .build()
                .error_on_failure(),
        )
    }
    #[cfg(target_os = "windows")]
    {
        Some(ep::DirectML::default().build().error_on_failure())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

fn create(path: &Path, options: &Options, accelerated: bool) -> ort::Result<OrtSession> {
    #[cfg(test)]
    if accelerated && options.fail_accelerated_load {
        return Err(ort::Error::new("injected accelerated load failure"));
    }
    let mut builder = OrtSession::builder()?.with_intra_threads(options.threads)?;
    if accelerated {
        builder = builder
            .with_parallel_execution(false)?
            .with_memory_pattern(false)?
            .with_execution_providers([
                accelerator().ok_or_else(|| ort::Error::new("no platform accelerator"))?
            ])?;
    } else {
        builder =
            builder.with_execution_providers([ep::CPU::default().build().error_on_failure()])?;
    }
    if let Some(prefix) = &options.profile {
        builder = builder.with_profiling(prefix.with_extension(if accelerated {
            "accelerated"
        } else {
            "cpu"
        }))?;
    }
    builder.commit_from_file(path)
}

impl Session {
    pub fn load(path: impl AsRef<Path>, threads: usize) -> ort::Result<Self> {
        Self::load_with_options(path, Options::new(threads))
    }

    pub fn load_for_model(
        path: impl AsRef<Path>,
        threads: usize,
        model_kind: ModelKind,
    ) -> ort::Result<Self> {
        let mut options = Options::new(threads);
        options.model_kind = model_kind;
        Self::load_with_options(path, options)
    }

    pub fn load_with_options(path: impl AsRef<Path>, options: Options) -> ort::Result<Self> {
        let path = path.as_ref().to_path_buf();
        let mut fallback_reason = None;
        // macOS 2026-10-02 regression: CoreML changed YOLO outputs and
        // SlimSAM decoder IoU scores beyond the CPU consistency tolerance.
        // CPUAndGPU did not resolve it. DirectML is unaffected by this guard.
        let compatibility_cpu = cfg!(target_os = "macos")
            && options.policy == Policy::Auto
            && matches!(
                options.model_kind,
                ModelKind::Yolo26Seg | ModelKind::SlimSamQuantizedDecoder
            );
        if compatibility_cpu {
            fallback_reason = Some(format!(
                "CoreML output consistency guard: {:?}",
                options.model_kind
            ));
            eprintln!(
                "[ONNX] using CPU for validated model compatibility: {:?}: {}",
                options.model_kind,
                path.display()
            );
        }
        let (inner, accelerated) =
            if !compatibility_cpu && options.policy != Policy::Cpu && accelerator().is_some() {
                match create(&path, &options, true) {
                    Ok(session) => (session, true),
                    Err(error) if options.policy == Policy::Auto => {
                        eprintln!(
                            "[ONNX] accelerated load failed; retrying CPU: {}: {error}",
                            path.display()
                        );
                        fallback_reason = Some(error.to_string());
                        (create(&path, &options, false)?, false)
                    }
                    Err(error) => return Err(error),
                }
            } else {
                if options.policy == Policy::RequireAccelerated {
                    return Err(ort::Error::new("no platform accelerator"));
                }
                (create(&path, &options, false)?, false)
            };
        eprintln!(
            "[ONNX] session={} model={}",
            if accelerated { "platform" } else { "cpu" },
            path.display()
        );
        Ok(Self {
            inner,
            path,
            options,
            accelerated,
            fallback_reason,
        })
    }

    #[cfg(test)]
    pub fn input_specs(&self) -> Vec<(String, ort::value::ValueType)> {
        self.inner
            .inputs()
            .iter()
            .map(|i| (i.name().to_owned(), i.dtype().clone()))
            .collect()
    }

    #[cfg(test)]
    pub fn inject_run_failure(&mut self) {
        self.options.policy = Policy::Auto;
        self.options.fail_accelerated_run = true;
        self.accelerated = true;
    }

    pub fn metadata(&self) -> ort::Result<ort::session::ModelMetadata<'_>> {
        self.inner.metadata()
    }
    pub fn accelerated(&self) -> bool {
        self.accelerated
    }
    pub fn fallback_reason(&self) -> Option<&str> {
        self.fallback_reason.as_deref()
    }
    pub fn end_profiling(&mut self) -> ort::Result<String> {
        self.inner.end_profiling()
    }

    pub fn run<'i, 'v: 'i, const N: usize>(
        &mut self,
        inputs: impl Into<SessionInputs<'i, 'v, N>>,
    ) -> ort::Result<Outputs> {
        let inputs = inputs.into();
        let positional_names: Vec<String> = self
            .inner
            .inputs()
            .iter()
            .map(|input| input.name().to_owned())
            .collect();
        let named = match inputs {
            SessionInputs::ValueMap(values) => values,
            SessionInputs::ValueArray(values) => {
                if values.len() != positional_names.len() {
                    return Err(ort::Error::new("incorrect input count"));
                }
                positional_names
                    .into_iter()
                    .zip(values)
                    .map(|(n, v)| (Cow::Owned(n), v))
                    .collect()
            }
            SessionInputs::ValueSlice(values) => {
                if values.len() != positional_names.len() {
                    return Err(ort::Error::new("incorrect input count"));
                }
                positional_names
                    .into_iter()
                    .zip(values.iter())
                    .map(|(n, v)| (Cow::Owned(n), (&**v).into()))
                    .collect()
            }
        };
        let run = |session: &mut OrtSession| -> ort::Result<Outputs> {
            let inputs: Vec<_> = named
                .iter()
                .map(|(name, value)| (name.as_ref(), &**value))
                .collect();
            let expected_outputs: Vec<_> = session
                .outputs()
                .iter()
                .map(|o| (o.name().to_owned(), o.dtype().clone()))
                .collect();
            let outputs = session.run(inputs)?;
            if outputs.len() == 0 {
                return Err(ort::Error::new("empty ONNX outputs"));
            }
            for (name, output) in outputs.iter() {
                if let Some((_, expected)) = expected_outputs.iter().find(|(key, _)| key == name) {
                    if let (
                        ort::value::ValueType::Tensor {
                            ty: expected_type,
                            shape: expected_shape,
                            ..
                        },
                        ort::value::ValueType::Tensor { ty, shape, .. },
                    ) = (expected, output.dtype())
                    {
                        if ty != expected_type
                            || shape.len() != expected_shape.len()
                            || expected_shape
                                .iter()
                                .zip(shape.iter())
                                .any(|(expected, actual)| *expected >= 0 && expected != actual)
                        {
                            return Err(ort::Error::new("invalid ONNX output contract"));
                        }
                    }
                }
                if let Ok((_, values)) = output.try_extract_tensor::<f32>() {
                    if values.iter().any(|v| !v.is_finite()) {
                        return Err(ort::Error::new("non-finite ONNX output"));
                    }
                }
            }
            Ok(Outputs(
                outputs
                    .into_iter()
                    .map(|(name, value)| (name.to_owned(), value))
                    .collect(),
            ))
        };
        #[cfg(test)]
        let forced_failure = self.accelerated && self.options.fail_accelerated_run;
        #[cfg(not(test))]
        let forced_failure = false;
        let first = if forced_failure {
            Err(ort::Error::new("injected accelerated inference failure"))
        } else {
            run(&mut self.inner)
        };
        match first {
            Err(error) if self.accelerated && self.options.policy == Policy::Auto => {
                eprintln!(
                    "[ONNX] accelerated inference failed; retrying CPU: {}: {error}",
                    self.path.display()
                );
                // Replace the accelerated session with a CPU-only session.
                // If CPU cannot load/run, propagate that error; never retry indefinitely.
                self.fallback_reason = Some(error.to_string());
                self.inner = create(&self.path, &self.options, false)?;
                self.accelerated = false;
                run(&mut self.inner)
            }
            result => result,
        }
    }
}
