use super::frame::render_composition_frame_with;
use super::timeline::{
    ffmpeg_fallback_temp_path, infer_composition_duration, infer_composition_fps,
};
use super::*;
use crate::media::command;
use napi_derive::napi;

/// ffmpeg 路径 -> 最佳可用硬件 H.264 编码器缓存。
/// None 表示已检测过，无可用硬件编码器（使用 libx264）。
static HW_ENCODER_CACHE: LazyLock<Mutex<HashMap<String, Option<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 用一个 1x1 纯色帧实际测试编码器是否能正常初始化并输出
/// 这能捕获编译支持但运行时不可用的情况（如 nvcuda.dll 缺失）
fn test_encoder_works(ffmpeg_path: &str, encoder: &str) -> bool {
    // H.264 hardware encoders commonly reject 1x1 input. Use a small,
    // standards-compliant frame so supported encoders are not rejected.
    const TEST_WIDTH: usize = 64;
    const TEST_HEIGHT: usize = 64;
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
        format!("{}x{}", TEST_WIDTH, TEST_HEIGHT),
        "-r".to_string(),
        "1".to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
        "-c:v".to_string(),
        encoder.to_string(),
        "-frames:v".to_string(),
        "1".to_string(),
        "-f".to_string(),
        "null".to_string(),
    ];
    if encoder == "libx264" {
        args.push("-preset".to_string());
        args.push("ultrafast".to_string());
    }
    args.push("-".to_string()); // 输出到 stdout（null mux 会丢弃）

    let result = command(ffmpeg_path)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            // 写入 4 字节 RGBA（1x1 像素）
            if let Some(ref mut stdin) = child.stdin {
                use std::io::Write;
                let frame = vec![0u8; TEST_WIDTH * TEST_HEIGHT * 4];
                let _ = stdin.write_all(&frame);
            }
            child.wait_with_output()
        });

    match result {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log_write(&format!(
                    "[Export] 编码器 {} 测试失败: {}",
                    encoder,
                    stderr.trim()
                ));
            }
            output.status.success()
        }
        Err(e) => {
            log_write(&format!("[Export] 编码器 {} 无法启动: {}", encoder, e));
            false
        }
    }
}

/// 检测当前 ffmpeg 实际可用的最佳 H.264 编码器（自动缓存，只实际运行一次）
///
/// 与仅检查 `-encoders` 列表不同，本函数通过实际编码 1 帧来验证编码器是否能
/// 正常初始化，从而避免编译支持但运行时驱动缺失（如 nvcuda.dll）导致的失败。
///
/// 优先级: videotoolbox > nvenc > qsv > amf → fallback libx264
fn best_hardware_encoder(ffmpeg_path: &str) -> Option<String> {
    let mut cache = HW_ENCODER_CACHE.lock().unwrap();
    if let Some(result) = cache.get(ffmpeg_path) {
        return result.clone();
    }

    // 先用 -encoders 列表快速过滤出"编译支持"的编码器
    let list_output = command(ffmpeg_path)
        .args(["-hide_banner", "-encoders"])
        .output()
        .ok();
    let stdout = list_output
        .as_ref()
        .map(|o| String::from_utf8_lossy(&o.stdout))
        .unwrap_or_default();

    let compiled_in: Vec<&str> = ["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf"]
        .iter()
        .filter(|name| stdout.contains(**name))
        .copied()
        .collect();

    // 逐个实际测试，找到第一个能正常工作的
    let found = compiled_in
        .iter()
        .find(|name| test_encoder_works(ffmpeg_path, name))
        .map(|name| name.to_string());

    log_write(&format!(
        "[Export] 编码器检测完成 (ffmpeg={}): compiled={:?}, working={:?}",
        ffmpeg_path, compiled_in, found
    ));

    cache.insert(ffmpeg_path.to_string(), found.clone());
    found
}

pub struct ExportCompositionVideoTask {
    input: ExportCompositionVideoInput,
}

impl Task for ExportCompositionVideoTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        if let Ok(json) = serde_json::to_string_pretty(&self.input.composition) {
            log_write(&format!("[Export:Rust:Video] composition=\n{}", json));
        }
        let fps = self
            .input
            .fps
            .or(self.input.composition.canvas.fps)
            .or_else(|| infer_composition_fps(&self.input.ffprobe_path, &self.input.composition))
            .unwrap_or(30.0)
            .max(1.0);
        let duration = self
            .input
            .duration
            .or(self.input.composition.canvas.duration)
            .or_else(|| {
                infer_composition_duration(&self.input.ffprobe_path, &self.input.composition)
            })
            .unwrap_or(5.0)
            .max(0.1);
        let total_frames = (duration * fps).round().max(1.0) as u64;
        let task = self.input.task_id.as_deref().map(register_task);
        if let Some(ref state) = task {
            state
                .total_frames
                .store(total_frames, std::sync::atomic::Ordering::SeqCst);
        }

        let encoder = if self.input.hardware.unwrap_or(true) {
            best_hardware_encoder(&self.input.ffmpeg_path).unwrap_or_else(|| "libx264".to_string())
        } else {
            "libx264".to_string()
        };
        let preset = self
            .input
            .quality_preset
            .as_deref()
            .map(QualityPreset::from_str)
            .unwrap_or(QualityPreset::High);
        let bitrate: String = match preset {
            QualityPreset::Small => "12000k".to_string(),
            QualityPreset::Standard => "24000k".to_string(),
            QualityPreset::High => "50000k".to_string(),
            QualityPreset::OriginalLike => "80000k".to_string(),
            QualityPreset::Custom(val) => val,
        };

        // macOS 优先走 CoreVideo + Metal + AVFoundation：VideoToolbox 解码得到的
        // CVPixelBuffer 直接包装成 wgpu Texture，现有 WGSL 合成后再直接提交给
        // VideoToolbox 编码。任何能力或素材兼容问题都会回退到原 FFmpeg 管线。
        // ── macOS GPU Export ──
        #[cfg(target_os = "macos")]
        if self.input.hardware.unwrap_or(true) {
            let bitrate_bps = bitrate
                .trim_end_matches(['k', 'K'])
                .parse::<u64>()
                .unwrap_or(50_000)
                .saturating_mul(1_000);
            log_write(&format!(
                "[Export:MacGPU] start output={} frames={} fps={} bitrate={}",
                self.input.output_path, total_frames, fps, bitrate_bps,
            ));
            let mac_result = crate::lock_export(|compositor| {
                compositor.clear_video_decoders();
                crate::macos::export_video(
                    compositor,
                    &self.input.ffmpeg_path,
                    &self.input.ffprobe_path,
                    &self.input.output_path,
                    &self.input.composition,
                    fps,
                    total_frames,
                    bitrate_bps,
                    task.as_ref(),
                )
            });
            match mac_result {
                Ok(()) => {
                    log_write("[Export:MacGPU] completed");
                    if let Some(ref id) = self.input.task_id {
                        cleanup_task(id);
                    }
                    return Ok(());
                }
                Err(error) if task.as_ref().is_some_and(|state| state.is_cancelled()) => {
                    return Err(error);
                }
                Err(error) => {
                    log_write(&format!(
                        "[Export:MacGPU] unavailable, falling back to FFmpeg: {}",
                        error
                    ));
                    if let Some(ref state) = task {
                        state
                            .current_frame
                            .store(0, std::sync::atomic::Ordering::SeqCst);
                    }
                }
            }
        }

        #[cfg(target_os = "windows")]
        if self.input.hardware.unwrap_or(true)
            && std::env::var_os("LUNA_WINDOWS_ZERO_COPY_EXPORT").is_some()
        {
            let bitrate_bps = bitrate
                .trim_end_matches(['k', 'K'])
                .parse::<u64>()
                .unwrap_or(50_000)
                .saturating_mul(1_000);
            log_write(&format!(
                "[Export:WinGPU] start output={} frames={} fps={} bitrate={}",
                self.input.output_path, total_frames, fps, bitrate_bps,
            ));
            let windows_result = crate::lock_export(|compositor| {
                compositor.clear_video_decoders();
                crate::windows::export_video(
                    compositor,
                    &self.input.ffmpeg_path,
                    &self.input.ffprobe_path,
                    &self.input.output_path,
                    &self.input.composition,
                    fps,
                    total_frames,
                    bitrate_bps,
                    task.as_ref(),
                )
            });
            match windows_result {
                Ok(()) => {
                    log_write("[Export:WinGPU] completed");
                    if let Some(ref id) = self.input.task_id {
                        cleanup_task(id);
                    }
                    return Ok(());
                }
                Err(error) if task.as_ref().is_some_and(|state| state.is_cancelled()) => {
                    return Err(error)
                }
                Err(error) => {
                    log_write(&format!(
                        "[Export:WinGPU] unavailable, falling back to FFmpeg: {}",
                        error
                    ));
                    // D3D11On12 / Media Foundation failures can leave wgpu's shared D3D12
                    // device unusable. Recreate only the export compositor before the CPU
                    // encoding fallback starts; the preview compositor remains untouched.
                    crate::reset_export_compositor().map_err(|reset_error| {
                        napi::Error::from_reason(format!(
                            "Windows GPU export failed ({error}); export renderer recovery failed: {reset_error}"
                        ))
                    })?;
                    if let Some(ref state) = task {
                        state
                            .current_frame
                            .store(0, std::sync::atomic::Ordering::SeqCst);
                    }
                }
            }
        }

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
        // 输出到临时文件，后续再合并音频
        let fallback_temp = ffmpeg_fallback_temp_path(&self.input.output_path);
        args.extend([
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-movflags".to_string(),
            "faststart".to_string(),
            fallback_temp.to_string_lossy().into_owned(),
        ]);

        log_write(&format!(
            "[Export:FFmpeg] fallback 编码开始 output={} encoder={} temp={}",
            self.input.output_path,
            encoder,
            fallback_temp.display()
        ));

        // 确保输出目录存在
        if let Some(parent) = fallback_temp.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| napi::Error::from_reason(format!("create output dir: {}", e)))?;
        }

        let mut child = command(&self.input.ffmpeg_path)
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
        // 设置 export 模式：禁止重启 decoder，EOF 标记层结束，使用 -r {fps} 匹配解码帧率
        crate::lock_export(|c| {
            c.clear_video_decoders();
            c.no_video_decoder_restart = true;
            Ok(())
        })?;
        for frame in 0..total_frames {
            if task.as_ref().map_or(false, |state| state.is_cancelled()) {
                return Err(napi::Error::from_reason("导出已取消"));
            }
            let time = frame as f64 / fps;
            let (rgba, _, _) = crate::lock_export(|c| {
                render_composition_frame_with(
                    c,
                    &self.input.ffmpeg_path,
                    &self.input.ffprobe_path,
                    &self.input.composition,
                    time,
                    None,
                    Some(fps),
                )
            })?;
            if let Err(e) = stdin.write_all(&rgba) {
                // 写入 pipe 失败（通常是 Broken pipe），说明 ffmpeg 编码器已提前退出。
                // 关闭 stdin 并等待子进程获取 stderr 中的真实错误原因。
                let _ = stdin.flush();
                drop(stdin);
                let stderr = child
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
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(napi::Error::from_reason(format!(
                "ffmpeg exited with {} — stderr: {}",
                output.status,
                stderr.trim()
            )));
        }
        log_write(&format!(
            "[Export:FFmpeg] fallback 编码完成，开始音频合并 temp={}",
            fallback_temp.display()
        ));
        // 合并音频
        let duration = total_frames as f64 / fps;
        let completed_output = mux_primary_audio(
            &self.input.ffmpeg_path,
            &self.input.ffprobe_path,
            &fallback_temp,
            &self.input.output_path,
            &self.input.composition,
            duration,
        )
        .map_err(|e| napi::Error::from_reason(format!("音频合并失败: {}", e)))?;

        // 重命名为最终文件
        if Path::new(&self.input.output_path).exists() {
            std::fs::remove_file(&self.input.output_path)
                .map_err(|e| napi::Error::from_reason(format!("替换旧导出文件失败: {}", e)))?;
        }
        std::fs::rename(&completed_output, &self.input.output_path)
            .map_err(|e| napi::Error::from_reason(format!("保存导出文件失败: {}", e)))?;

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
