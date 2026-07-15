use super::frame::render_composition_frame_with;
use super::*;
use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
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
        if let Ok(json) = serde_json::to_string_pretty(&self.input.composition) {
            log_write(&format!("[Export:Rust:Image] composition=\n{}", json));
        }
        // 使用全局 compositor（含有已加载的 LUT，不用 .map_err 因为 lock 已返回 napi::Result）
        let (rgba, width, height) = crate::lock_export(|c| {
            c.clear_video_decoders();
            render_composition_frame_with(
                c,
                &self.input.ffmpeg_path,
                &self.input.ffprobe_path,
                &self.input.composition,
                0.0,
                None,
                None, // image export: no fps override
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

        // 确保输出目录存在
        if let Some(parent) = Path::new(&self.input.output_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| napi::Error::from_reason(format!("create output dir: {}", e)))?;
        }

        let mut proc = Command::new(&self.input.ffmpeg_path)
            .args(&args)
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| napi::Error::from_reason(format!("encode spawn: {}", e)))?;
        if let Err(e) = proc.stdin.take().unwrap().write_all(&rgba) {
            let _ = proc.stdin.as_mut().map(|s| s.flush());
            drop(proc.stdin.take());
            let stderr = proc
                .wait_with_output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stderr).to_string())
                .unwrap_or_default();
            let detail = if stderr.is_empty() {
                format!("encode write: {}", e)
            } else {
                format!("encode write: {} — ffmpeg stderr: {}", e, stderr.trim())
            };
            return Err(napi::Error::from_reason(detail));
        }
        drop(proc.stdin.take());
        let output = proc
            .wait_with_output()
            .map_err(|e| napi::Error::from_reason(format!("encode wait: {}", e)))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(napi::Error::from_reason(format!(
                "ffmpeg encode image failed — stderr: {}",
                stderr.trim()
            )));
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
