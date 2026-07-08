use std::io::Write;
use std::process::{Command, Stdio};

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;

use crate::compositor::{Compositor, PreviewLayerInput};
use crate::export::{cleanup_task, register_task, QualityPreset};
use crate::media::probe_video_info;
use crate::{
    LayerPositioning, RenderColorAdjustments, RenderLayerTransform,
    RenderPreviewOutput,
};

#[napi(object)]
#[derive(Clone)]
pub struct CompositionCanvas {
    pub width: u32,
    pub height: u32,
    pub fps: Option<f64>,
    pub duration: Option<f64>,
}

#[napi(object)]
#[derive(Clone)]
pub struct CompositionSourceTime {
    pub offset: Option<f64>,
    pub start: Option<f64>,
    pub duration: Option<f64>,
    pub loop_enabled: Option<bool>,
}

#[napi(object)]
#[derive(Clone)]
pub struct CompositionSource {
    pub path: String,
    pub source_type: Option<String>,
    pub time: Option<CompositionSourceTime>,
}

#[napi(object)]
#[derive(Clone)]
pub struct CompositionRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[napi(object)]
#[derive(Clone)]
pub struct CompositionLayer {
    pub id: Option<String>,
    pub source: CompositionSource,
    pub rect: CompositionRect,
    pub fit: Option<String>,
    pub opacity: Option<f64>,
    pub z_index: Option<i32>,
    pub color: Option<RenderColorAdjustments>,
    pub transform: Option<RenderLayerTransform>,
    pub positioning: Option<LayerPositioning>,
    pub lut_id: Option<String>,
    pub lut_intensity: Option<f64>,
}

#[napi(object)]
#[derive(Clone)]
pub struct CompositionInput {
    pub version: Option<u32>,
    pub canvas: CompositionCanvas,
    pub layers: Vec<CompositionLayer>,
}

#[napi(object)]
#[derive(Clone)]
pub struct RenderCompositionFrameInput {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub composition: CompositionInput,
    pub time: f64,
    pub max_side: Option<u32>,
}

#[napi(object)]
#[derive(Clone)]
pub struct ExportCompositionVideoInput {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub output_path: String,
    pub composition: CompositionInput,
    pub fps: Option<f64>,
    pub duration: Option<f64>,
    pub hardware: Option<bool>,
    pub task_id: Option<String>,
    pub quality_preset: Option<String>,
}

fn is_video_source(source: &CompositionSource) -> bool {
    match source.source_type.as_deref().unwrap_or("auto") {
        "video" => true,
        "image" => false,
        _ => {
            let lower = source.path.to_lowercase();
            [
                ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".insv", ".lrv",
            ]
            .iter()
            .any(|ext| lower.ends_with(ext))
        }
    }
}

fn layer_time(source: &CompositionSource, composition_time: f64) -> f64 {
    let source_time = source.time.as_ref();
    let offset = source_time.and_then(|time| time.offset).unwrap_or(0.0);
    let start = source_time.and_then(|time| time.start).unwrap_or(0.0);
    let mut t = start + composition_time - offset;
    if let Some(duration) = source_time.and_then(|time| time.duration) {
        if source_time
            .and_then(|time| time.loop_enabled)
            .unwrap_or(false)
            && duration > 0.0
        {
            t = start + (t - start).rem_euclid(duration);
        }
    }
    t.max(0.0)
}

fn infer_composition_duration(ffprobe_path: &str, input: &CompositionInput) -> Option<f64> {
    input.layers.iter().find_map(|layer| {
        if !is_video_source(&layer.source) {
            return None;
        }
        let source_time = layer.source.time.as_ref();
        if let Some(duration) = source_time.and_then(|time| time.duration) {
            return (duration > 0.0).then_some(duration);
        }
        let start = source_time.and_then(|time| time.start).unwrap_or(0.0);
        probe_video_info(ffprobe_path, &layer.source.path)
            .ok()
            .and_then(|info| {
                let remaining = info.duration_secs - start.max(0.0);
                (remaining > 0.0).then_some(remaining)
            })
    })
}

fn composition_layers(input: &CompositionInput, time: f64) -> Vec<PreviewLayerInput> {
    input
        .layers
        .iter()
        .map(|layer| PreviewLayerInput {
            file_path: layer.source.path.clone(),
            is_video: is_video_source(&layer.source),
            video_time: layer_time(&layer.source, time),
            fit: layer.fit.clone().unwrap_or_else(|| "cover".to_string()),
            dst_x: layer.rect.x,
            dst_y: layer.rect.y,
            dst_w: layer.rect.w,
            dst_h: layer.rect.h,
            src_x: 0.0,
            src_y: 0.0,
            src_w: 1.0,
            src_h: 1.0,
            opacity: layer.opacity.unwrap_or(1.0),
            z_index: layer.z_index.unwrap_or(0),
            color: layer.color.clone().unwrap_or_default(),
            transform: layer.transform.clone().unwrap_or_default(),
            positioning: layer.positioning.clone(),
            lut_id: layer.lut_id.clone(),
            lut_intensity: layer.lut_intensity,
        })
        .collect()
}

fn render_composition_frame_with(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    input: &CompositionInput,
    time: f64,
    max_side: Option<u32>,
) -> Result<(Vec<u8>, u32, u32), String> {
    let layers = composition_layers(input, time);
    let effective_max_side = max_side.or_else(|| Some(input.canvas.width.max(input.canvas.height)));
    compositor.render_preview(
        ffmpeg_path,
        ffprobe_path,
        Some(input.canvas.width),
        Some(input.canvas.height),
        effective_max_side,
        &layers,
    )
}

#[napi]
pub fn render_composition_frame(
    input: RenderCompositionFrameInput,
) -> napi::Result<RenderPreviewOutput> {
    crate::lock(|c| {
        let (data, width, height) = render_composition_frame_with(
            c,
            &input.ffmpeg_path,
            &input.ffprobe_path,
            &input.composition,
            input.time,
            input.max_side,
        )?;
        Ok(RenderPreviewOutput {
            width,
            height,
            data: data.into(),
        })
    })
}

pub struct ExportCompositionVideoTask {
    input: ExportCompositionVideoInput,
}

impl Task for ExportCompositionVideoTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let fps = self
            .input
            .fps
            .or(self.input.composition.canvas.fps)
            .unwrap_or(30.0)
            .max(1.0);
        let duration = self
            .input
            .duration
            .or(self.input.composition.canvas.duration)
            .or_else(|| infer_composition_duration(&self.input.ffprobe_path, &self.input.composition))
            .unwrap_or(5.0)
            .max(0.1);
        let total_frames = (duration * fps).round().max(1.0) as u64;
        let task = self.input.task_id.as_deref().map(register_task);
        if let Some(ref state) = task {
            state
                .total_frames
                .store(total_frames, std::sync::atomic::Ordering::SeqCst);
        }

        let encoder = if cfg!(target_os = "macos") && self.input.hardware.unwrap_or(true) {
            "h264_videotoolbox"
        } else {
            "libx264"
        };
        let preset = self
            .input
            .quality_preset
            .as_deref()
            .map(QualityPreset::from_str)
            .unwrap_or(QualityPreset::High);
        let bitrate = match preset {
            QualityPreset::Small => "12000k",
            QualityPreset::Standard => "24000k",
            QualityPreset::High => "50000k",
            QualityPreset::OriginalLike => "80000k",
        };

        let mut args = vec![
            "-y".to_string(),
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-f".to_string(),
            "rawvideo".to_string(),
            "-pix_fmt".to_string(),
            "rgba".to_string(),
            "-s".to_string(),
            format!(
                "{}x{}",
                self.input.composition.canvas.width, self.input.composition.canvas.height
            ),
            "-r".to_string(),
            fps.to_string(),
            "-i".to_string(),
            "pipe:0".to_string(),
            "-c:v".to_string(),
            encoder.to_string(),
            "-b:v".to_string(),
            bitrate.to_string(),
        ];
        if encoder == "libx264" {
            args.extend(["-preset".to_string(), "veryfast".to_string()]);
        }
        args.extend([
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-movflags".to_string(),
            "faststart".to_string(),
            self.input.output_path.clone(),
        ]);

        let mut child = Command::new(&self.input.ffmpeg_path)
            .args(args)
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| napi::Error::from_reason(format!("encode spawn: {}", e)))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| napi::Error::from_reason("encode stdin unavailable"))?;

        // 使用全局 compositor（含有已加载的 LUT）
        crate::lock(|c| { c.clear_video_decoders(); Ok(()) })?;
        for frame in 0..total_frames {
            if task.as_ref().map_or(false, |state| state.is_cancelled()) {
                return Err(napi::Error::from_reason("导出已取消"));
            }
            let time = frame as f64 / fps;
            let (rgba, _, _) = crate::lock(|c| {
                render_composition_frame_with(
                    c,
                    &self.input.ffmpeg_path,
                    &self.input.ffprobe_path,
                    &self.input.composition,
                    time,
                    None,
                )
            })?;
            stdin
                .write_all(&rgba)
                .map_err(|e| napi::Error::from_reason(format!("encode write: {}", e)))?;
            if let Some(ref state) = task {
                state
                    .current_frame
                    .store(frame + 1, std::sync::atomic::Ordering::SeqCst);
            }
        }
        drop(stdin);
        let output = child
            .wait_with_output()
            .map_err(|e| napi::Error::from_reason(format!("encode wait: {}", e)))?;
        if !output.status.success() {
            return Err(napi::Error::from_reason(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }
        if let Some(ref id) = self.input.task_id {
            cleanup_task(id);
        }
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

#[napi]
pub fn export_composition_video_async(
    input: ExportCompositionVideoInput,
) -> AsyncTask<ExportCompositionVideoTask> {
    AsyncTask::new(ExportCompositionVideoTask { input })
}

// ── exportCompositionImage ──

#[napi(object)]
#[derive(Clone)]
pub struct ExportCompositionImageInput {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub output_path: String,
    pub composition: CompositionInput,
    pub format: String,
    pub quality: f64,
}

pub struct ExportCompositionImageTask {
    input: ExportCompositionImageInput,
}

impl Task for ExportCompositionImageTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        // 使用全局 compositor（含有已加载的 LUT，不用 .map_err 因为 lock 已返回 napi::Result）
        let (rgba, width, height) = crate::lock(|c| {
            c.clear_video_decoders();
            render_composition_frame_with(
                c,
                &self.input.ffmpeg_path,
                &self.input.ffprobe_path,
                &self.input.composition,
                0.0,
                None,
            )
        })?;

        let format = self.input.format.to_lowercase();
        let quality = self.input.quality.clamp(1.0, 100.0);
        let q_str = format!("{:.0}", quality);
        let mut args: Vec<String> = vec![
            "-y".to_string(),
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-f".to_string(),
            "rawvideo".to_string(),
            "-pix_fmt".to_string(),
            "rgba".to_string(),
            "-s".to_string(),
            format!("{}x{}", width, height),
            "-i".to_string(),
            "pipe:0".to_string(),
            "-frames:v".to_string(),
            "1".to_string(),
        ];
        match format.as_str() {
            "jpeg" | "jpg" => {
                let ffmpeg_q = ((100.0 - quality) * 24.0 / 99.0 + 1.0) as u32;
                args.extend_from_slice(&[
                    "-c:v".to_string(),
                    "mjpeg".to_string(),
                    "-pix_fmt".to_string(),
                    "yuvj420p".to_string(),
                    "-q:v".to_string(),
                    ffmpeg_q.to_string(),
                ]);
            }
            "png" => {
                args.extend_from_slice(&["-c:v".to_string(), "png".to_string()]);
            }
            "webp" => {
                args.extend_from_slice(&[
                    "-c:v".to_string(),
                    "libwebp".to_string(),
                    "-quality".to_string(),
                    q_str,
                ]);
            }
            _ => {
                return Err(napi::Error::from_reason(format!(
                    "unsupported image format: {}",
                    format
                )))
            }
        }
        args.push(self.input.output_path.clone());

        let mut proc =
            Command::new(&self.input.ffmpeg_path)
                .args(&args)
                .stdin(Stdio::piped())
                .spawn()
                .map_err(|e| napi::Error::from_reason(format!("encode spawn: {}", e)))?;
        proc.stdin
            .take()
            .unwrap()
            .write_all(&rgba)
            .map_err(|e| napi::Error::from_reason(format!("encode write: {}", e)))?;
        let status = proc
            .wait()
            .map_err(|e| napi::Error::from_reason(format!("encode wait: {}", e)))?;
        if !status.success() {
            return Err(napi::Error::from_reason("ffmpeg encode image failed"));
        }
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

#[napi]
pub fn export_composition_image_async(
    input: ExportCompositionImageInput,
) -> AsyncTask<ExportCompositionImageTask> {
    AsyncTask::new(ExportCompositionImageTask { input })
}
