use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use crate::compositor::log_write;
use crate::compositor::{Compositor, PreviewLayerInput};
use crate::export::{cleanup_task, register_task, QualityPreset};
use crate::media::probe_video_info;
use crate::{LayerPositioning, RenderColorAdjustments, RenderLayerTransform, RenderPreviewOutput};

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionCanvas {
    pub width: u32,
    pub height: u32,
    pub fps: Option<f64>,
    pub duration: Option<f64>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionSourceTime {
    pub offset: Option<f64>,
    pub start: Option<f64>,
    pub duration: Option<f64>,
    pub loop_enabled: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionSource {
    pub path: String,
    pub source_type: Option<String>,
    pub time: Option<CompositionSourceTime>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionReveal {
    pub direction: String,
    pub start: f64,
    pub duration: f64,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionLayer {
    pub id: Option<String>,
    pub layer_type: Option<String>,
    pub source: CompositionSource,
    pub rect: CompositionRect,
    pub fit: Option<String>,
    pub opacity: Option<f64>,
    pub z_index: Option<i32>,
    pub reveal: Option<CompositionReveal>,
    pub color: Option<RenderColorAdjustments>,
    pub transform: Option<RenderLayerTransform>,
    pub positioning: Option<LayerPositioning>,
    pub lut_id: Option<String>,
    pub lut_intensity: Option<f64>,
    pub shape: Option<String>,
    pub fill_color: Option<String>,
    pub corner_radius: Option<f64>,
    pub stroke_color: Option<String>,
    pub stroke_width: Option<f64>,
    pub content: Option<String>,
    pub font_size: Option<f64>,
    pub font_family: Option<String>,
    pub font_file: Option<String>,
    pub font_weight: Option<f64>,
    pub text_color: Option<String>,
    pub text_align: Option<String>,
    pub vertical_align: Option<String>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct CompositionInput {
    pub version: Option<u32>,
    pub canvas: CompositionCanvas,
    pub layers: Vec<CompositionLayer>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct RenderCompositionFrameInput {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub composition: CompositionInput,
    pub time: f64,
    pub max_side: Option<u32>,
}

#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
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

pub(crate) fn is_video_source(source: &CompositionSource) -> bool {
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

fn infer_composition_fps(ffprobe_path: &str, input: &CompositionInput) -> Option<f64> {
    input.layers.iter().find_map(|layer| {
        if !is_video_source(&layer.source) {
            return None;
        }
        probe_video_info(ffprobe_path, &layer.source.path)
            .ok()
            .map(|info| info.fps)
            .filter(|fps| fps.is_finite() && *fps > 0.0)
    })
}

/// FFmpeg fallback 临时文件路径
fn ffmpeg_fallback_temp_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export.mp4");
    path.with_file_name(format!(".{file_name}.ffmpeg-fallback-partial.mp4"))
}

/// 公共的音频合并函数 — 将第一条视频层的音频合入无声视频。
/// 如果源无音频或合并失败，返回原始无声视频路径。
pub(crate) fn mux_primary_audio(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    silent_video: &Path,
    output_path: &str,
    composition: &CompositionInput,
    duration: f64,
) -> Result<PathBuf, String> {
    let Some(layer) = composition
        .layers
        .iter()
        .find(|layer| is_video_source(&layer.source))
    else {
        log_write(&format!(
            "[Export:Audio] 无视频层，跳过音频合并 output={}",
            output_path
        ));
        return Ok(silent_video.to_path_buf());
    };
    let info = match probe_video_info(ffprobe_path, &layer.source.path) {
        Ok(info) => info,
        Err(error) => {
            log_write(&format!(
                "[Export:Audio] probe 失败，跳过音频合并: {}",
                error
            ));
            return Ok(silent_video.to_path_buf());
        }
    };
    if !info.audio.has_audio {
        log_write(&format!(
            "[Export:Audio] 源无音频轨，跳过 source={}",
            layer.source.path
        ));
        return Ok(silent_video.to_path_buf());
    }

    let timing = layer.source.time.as_ref();
    let offset = timing.and_then(|time| time.offset).unwrap_or(0.0).max(0.0);
    if offset >= duration {
        log_write(&format!(
            "[Export:Audio] offset({:.2}) >= duration({:.2})，跳过",
            offset, duration
        ));
        return Ok(silent_video.to_path_buf());
    }
    let start = timing.and_then(|time| time.start).unwrap_or(0.0).max(0.0);
    let active_duration = timing
        .and_then(|time| time.duration)
        .unwrap_or(duration - offset)
        .min(duration - offset)
        .max(0.001);
    let mux_output = Path::new(output_path).with_file_name(format!(
        ".{}.audio-mux-partial.mp4",
        Path::new(output_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("export.mp4")
    ));
    let _ = std::fs::remove_file(&mux_output);
    let filter = format!("[1:a:0]asetpts=PTS-STARTPTS+{:.6}/TB[aout]", offset);
    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-i".to_string(),
        silent_video.to_string_lossy().into_owned(),
    ];
    if timing.and_then(|time| time.loop_enabled).unwrap_or(false) {
        args.extend(["-stream_loop".to_string(), "-1".to_string()]);
    }
    args.extend([
        "-ss".to_string(),
        format!("{start:.6}"),
        "-t".to_string(),
        format!("{active_duration:.6}"),
        "-i".to_string(),
        layer.source.path.clone(),
        "-filter_complex".to_string(),
        filter,
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "[aout]".to_string(),
        "-c:v".to_string(),
        "copy".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-t".to_string(),
        format!("{duration:.6}"),
        "-movflags".to_string(),
        "+faststart".to_string(),
        mux_output.to_string_lossy().into_owned(),
    ]);
    log_write(&format!(
        "[Export:Audio] 开始音频合并 source={} offset={:.3} start={:.3} duration={:.3}",
        layer.source.path, offset, start, active_duration
    ));
    let result = Command::new(ffmpeg_path)
        .args(&args)
        .output()
        .map_err(|error| format!("启动音频合成失败: {error}"))?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        log_write(&format!("[Export:Audio] 音频合并失败: {}", stderr.trim()));
        return Err(format!("音频合成失败: {}", stderr.trim()));
    }
    log_write(&format!(
        "[Export:Audio] 音频合并成功 output={}",
        mux_output.display()
    ));
    std::fs::remove_file(silent_video).map_err(|error| format!("清理临时视频失败: {error}"))?;
    Ok(mux_output)
}

pub(crate) fn composition_layers(input: &CompositionInput, time: f64) -> Vec<PreviewLayerInput> {
    input
        .layers
        .iter()
        .map(|layer| {
            let reveal_progress = layer
                .reveal
                .as_ref()
                .map(|reveal| {
                    if reveal.duration <= 0.0 {
                        1.0
                    } else {
                        ((time - reveal.start) / reveal.duration).clamp(0.0, 1.0)
                    }
                })
                .unwrap_or(1.0);
            let reveal_width = if layer
                .reveal
                .as_ref()
                .is_some_and(|reveal| reveal.direction == "left-to-right")
            {
                reveal_progress
            } else {
                1.0
            };
            PreviewLayerInput {
                layer_type: layer.layer_type.clone(),
                file_path: layer.source.path.clone(),
                is_video: is_video_source(&layer.source),
                video_time: layer_time(&layer.source, time),
                fit: layer.fit.clone().unwrap_or_else(|| "cover".to_string()),
                dst_x: layer.rect.x,
                dst_y: layer.rect.y,
                dst_w: layer.rect.w * reveal_width,
                dst_h: layer.rect.h,
                src_x: 0.0,
                src_y: 0.0,
                src_w: reveal_width,
                src_h: 1.0,
                opacity: if reveal_width <= 0.0 {
                    0.0
                } else {
                    layer.opacity.unwrap_or(1.0)
                },
                z_index: layer.z_index.unwrap_or(0),
                color: layer.color.clone().unwrap_or_default(),
                transform: layer.transform.clone().unwrap_or_default(),
                positioning: layer.positioning.clone(),
                lut_id: layer.lut_id.clone(),
                lut_intensity: layer.lut_intensity,
                shape: layer.shape.clone(),
                fill_color: layer.fill_color.clone(),
                corner_radius: layer.corner_radius,
                stroke_color: layer.stroke_color.clone(),
                stroke_width: layer.stroke_width,
                content: layer.content.clone(),
                font_size: layer.font_size,
                font_family: layer.font_family.clone(),
                font_file: layer.font_file.clone(),
                font_weight: layer.font_weight,
                text_color: layer.text_color.clone(),
                text_align: layer.text_align.clone(),
                vertical_align: layer.vertical_align.clone(),
            }
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
    fps: Option<f64>,
) -> Result<(Vec<u8>, u32, u32), String> {
    let layers = composition_layers(input, time);
    let raw_max_side = max_side.unwrap_or_else(|| input.canvas.width.max(input.canvas.height));
    let effective_max_side = Some(raw_max_side.min(compositor.max_texture_size));
    compositor.render_preview(
        ffmpeg_path,
        ffprobe_path,
        Some(input.canvas.width),
        Some(input.canvas.height),
        effective_max_side,
        &layers,
        fps,
    )
}

#[napi]
pub fn render_composition_frame(
    input: RenderCompositionFrameInput,
) -> napi::Result<RenderPreviewOutput> {
    crate::lock_preview(|c| {
        let (data, width, height) = render_composition_frame_with(
            c,
            &input.ffmpeg_path,
            &input.ffprobe_path,
            &input.composition,
            input.time,
            input.max_side,
            None, // preview: no fps override
        )?;
        Ok(RenderPreviewOutput {
            width,
            height,
            data: data.into(),
        })
    })
}

/// 异步版本的 render_composition_frame，在后台线程池执行，不阻塞主线程
pub struct RenderCompositionFrameTask {
    input: RenderCompositionFrameInput,
}

impl Task for RenderCompositionFrameTask {
    type Output = RenderPreviewOutput;
    type JsValue = RenderPreviewOutput;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        crate::lock_preview(|c| {
            let (data, width, height) = render_composition_frame_with(
                c,
                &self.input.ffmpeg_path,
                &self.input.ffprobe_path,
                &self.input.composition,
                self.input.time,
                self.input.max_side,
                None, // preview: no fps override
            )?;
            Ok(RenderPreviewOutput {
                width,
                height,
                data: data.into(),
            })
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn render_composition_frame_async(
    input: RenderCompositionFrameInput,
) -> napi::Result<AsyncTask<RenderCompositionFrameTask>> {
    Ok(AsyncTask::new(RenderCompositionFrameTask { input }))
}

/// ffmpeg 路径 → 最佳可用硬件 H.264 编码器缓存
/// None 表示已检测过，无可用硬件编码器（使用 libx264）
static HW_ENCODER_CACHE: LazyLock<Mutex<HashMap<String, Option<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 用一个 1x1 纯色帧实际测试编码器是否能正常初始化并输出
/// 这能捕获编译支持但运行时不可用的情况（如 nvcuda.dll 缺失）
fn test_encoder_works(ffmpeg_path: &str, encoder: &str) -> bool {
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
        "1x1".to_string(),
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

    let result = Command::new(ffmpeg_path)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            // 写入 4 字节 RGBA（1x1 像素）
            if let Some(ref mut stdin) = child.stdin {
                use std::io::Write;
                let _ = stdin.write_all(&[0u8; 4]);
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
    let list_output = Command::new(ffmpeg_path)
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

// ── exportCompositionImage ──

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
