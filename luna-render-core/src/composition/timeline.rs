use super::*;
use crate::media::command;

pub(crate) fn is_video_source(source: &CompositionSource) -> bool {
    if source.source_type.as_deref() == Some("video") {
        return true;
    }

    // `source_type` is supplied by the renderer and is not an instruction to
    // freeze a video on one frame. Keep known video containers dynamic even
    // when an older snapshot or bridge incorrectly labels them as an image.
    let lower = source.path.to_lowercase();
    [
        ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".insv", ".lrv",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
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
    t.max(start.max(0.0))
}

fn mask_track_transform(track: Option<&MaskTrack>, time: f64) -> crate::RenderMaskTransform {
    let Some(track) = track.filter(|track| track.version == 1 && !track.keyframes.is_empty())
    else {
        return crate::RenderMaskTransform {
            scale: 1.0,
            ..Default::default()
        };
    };
    let next_index = track
        .keyframes
        .iter()
        .position(|keyframe| keyframe.time >= time);
    let (previous, next, amount) = match next_index {
        Some(0) => (&track.keyframes[0], &track.keyframes[0], 0.0),
        Some(index) => {
            let previous = &track.keyframes[index - 1];
            let next = &track.keyframes[index];
            let amount = ((time - previous.time) / (next.time - previous.time).max(0.000_001))
                .clamp(0.0, 1.0);
            (previous, next, amount)
        }
        None => {
            let last = &track.keyframes[track.keyframes.len() - 1];
            (last, last, 0.0)
        }
    };
    crate::RenderMaskTransform {
        translate_x: previous.translate_x + (next.translate_x - previous.translate_x) * amount,
        translate_y: previous.translate_y + (next.translate_y - previous.translate_y) * amount,
        scale: (previous.scale + (next.scale - previous.scale) * amount).clamp(0.1, 10.0),
        rotation: previous.rotation + (next.rotation - previous.rotation) * amount,
    }
}

fn mask_timeline_transform(transform: &MaskTimelineTransform) -> crate::RenderMaskTransform {
    crate::RenderMaskTransform {
        translate_x: transform.translate_x,
        translate_y: transform.translate_y,
        scale: transform.scale.clamp(0.1, 10.0),
        rotation: transform.rotation,
    }
}

fn mask_timeline_frame(timeline: &MaskTimeline, time: f64) -> Option<&MaskTimelineFrame> {
    if timeline.version != 1
        || timeline.frames.is_empty()
        || time < timeline.start_time
        || time > timeline.end_time
    {
        return None;
    }
    timeline.frames.iter().min_by(|left, right| {
        (left.time - time)
            .abs()
            .total_cmp(&(right.time - time).abs())
    })
}

fn ease_in_out_cubic(value: f64) -> f64 {
    let progress = value.clamp(0.0, 1.0);
    if progress < 0.5 {
        4.0 * progress * progress * progress
    } else {
        1.0 - (-2.0 * progress + 2.0).powi(3) / 2.0
    }
}

fn reveal_progress(reveal: &CompositionReveal, time: f64) -> f64 {
    let duration = reveal.duration.max(0.001);
    let elapsed = time - reveal.start;
    if elapsed <= 0.0 {
        return 0.0;
    }
    let apply_easing = |value: f64| match reveal.easing.as_deref() {
        Some("ease-in-out") => ease_in_out_cubic(value),
        _ => value.clamp(0.0, 1.0),
    };
    let midpoint_hold = reveal.midpoint_hold.unwrap_or(0.0).max(0.0);
    let bounce = reveal.midpoint_bounce.unwrap_or(0.0).clamp(0.0, 0.49);
    let midpoint_duration = if bounce > 0.0 {
        midpoint_hold.min(0.8)
    } else {
        midpoint_hold
    };
    if midpoint_duration <= 0.0 {
        return apply_easing(elapsed / duration);
    }

    let half_duration = duration / 2.0;
    if elapsed < half_duration {
        return apply_easing(elapsed / half_duration) * 0.5;
    }
    if elapsed < half_duration + midpoint_duration {
        if bounce <= 0.0 {
            return 0.5;
        }
        let bounce_progress = (elapsed - half_duration) / midpoint_duration;
        let damping_ratio: f64 = 0.32;
        let damped_frequency = std::f64::consts::PI;
        let natural_frequency = damped_frequency / (1.0 - damping_ratio.powi(2)).sqrt();
        let decay = damping_ratio * natural_frequency;
        let peak_time = (damped_frequency / decay).atan() / damped_frequency;
        let peak = (-decay * peak_time).exp() * (damped_frequency * peak_time).sin();
        let spring_recoil =
            (-decay * bounce_progress).exp() * (damped_frequency * bounce_progress).sin() / peak;
        return 0.5 - spring_recoil * bounce;
    }
    if elapsed < duration + midpoint_duration {
        let second_half = (elapsed - half_duration - midpoint_duration) / half_duration;
        let second_half_progress = if reveal.midpoint_bounce.unwrap_or(0.0) > 0.0 {
            let compressed = (second_half / 0.28).clamp(0.0, 1.0);
            let initial_velocity = 0.16;
            initial_velocity * compressed + (1.0 - initial_velocity) * compressed * compressed
        } else {
            apply_easing(second_half)
        };
        return 0.5 + second_half_progress * 0.5;
    }
    1.0
}

pub(crate) fn infer_composition_duration(
    ffprobe_path: &str,
    input: &CompositionInput,
) -> Option<f64> {
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

pub(crate) fn infer_composition_fps(ffprobe_path: &str, input: &CompositionInput) -> Option<f64> {
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
pub(crate) fn ffmpeg_fallback_temp_path(output: &str) -> PathBuf {
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
    let result = command(ffmpeg_path)
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
        .filter(|layer| {
            let starts = layer.active_start.is_none_or(|start| time >= start);
            let ends = layer.active_end.is_none_or(|end| time < end);
            starts && ends
        })
        .filter_map(|layer| {
            let source_rect = layer.source_rect.as_ref();
            let reveal_progress = layer
                .reveal
                .as_ref()
                .map(|reveal| reveal_progress(reveal, time))
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
            let video_time = layer_time(&layer.source, time);
            let timeline_frame = layer
                .mask_timeline
                .as_ref()
                .and_then(|timeline| mask_timeline_frame(timeline, video_time));
            let mask_path = match layer.mask_timeline.as_ref() {
                Some(_) => timeline_frame?.path.clone()?,
                None => layer.mask_path.clone().unwrap_or_default(),
            };
            let mask_transform = timeline_frame
                .and_then(|frame| frame.transform.as_ref())
                .map(mask_timeline_transform)
                .unwrap_or_else(|| mask_track_transform(layer.mask_track.as_ref(), video_time));
            Some(PreviewLayerInput {
                layer_type: layer.layer_type.clone(),
                precompose_group: layer.precompose_group.clone(),
                precompose_role: layer.precompose_role.clone(),
                file_path: layer.source.path.clone(),
                is_video: is_video_source(&layer.source),
                video_time,
                fit: layer.fit.clone().unwrap_or_else(|| "cover".to_string()),
                dst_x: layer.rect.x,
                dst_y: layer.rect.y,
                dst_w: layer.rect.w,
                dst_h: layer.rect.h,
                src_x: source_rect.map(|rect| rect.x).unwrap_or(0.0),
                src_y: source_rect.map(|rect| rect.y).unwrap_or(0.0),
                src_w: source_rect.map(|rect| rect.w).unwrap_or(1.0),
                src_h: source_rect.map(|rect| rect.h).unwrap_or(1.0),
                opacity: layer.opacity.unwrap_or(1.0),
                blend_mode: layer.blend_mode.clone(),
                reveal_progress: reveal_width,
                z_index: layer.z_index.unwrap_or(0),
                color: layer.color.clone().unwrap_or_default(),
                mask_path: (!mask_path.is_empty()).then_some(mask_path),
                mask_texture_id: None,
                mask_opacity: layer.mask_opacity.unwrap_or(1.0).clamp(0.0, 1.0),
                mask_inverted: layer.mask_inverted.unwrap_or(false),
                mask_feather: layer.mask_feather.unwrap_or(0.0).clamp(0.0, 100.0),
                mask_transform,
                pixel_stretch: layer.pixel_stretch.clone(),
                pixel_flow: layer.pixel_flow.clone().map(|mut effect| {
                    effect.progress = Some((video_time / effect.duration.max(0.1)).clamp(0.0, 1.0));
                    effect
                }),
                transform: layer.transform.clone().unwrap_or_default(),
                positioning: layer.positioning.clone(),
                restore_lut_id: layer.restore_lut_id.clone(),
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
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        composition_layers, is_video_source, layer_time, mask_timeline_frame, mask_track_transform,
        reveal_progress, CompositionInput, CompositionReveal, CompositionSource,
        CompositionSourceTime, MaskTimeline, MaskTimelineFrame, MaskTimelineTransform, MaskTrack,
        MaskTrackKeyframe,
    };

    fn sample_mask_track() -> MaskTrack {
        MaskTrack {
            version: 1,
            anchor_time: 2.0,
            start_time: 2.0,
            end_time: 4.0,
            keyframes: vec![
                MaskTrackKeyframe {
                    time: 2.0,
                    translate_x: 0.1,
                    translate_y: -0.2,
                    scale: 1.0,
                    rotation: 0.0,
                    confidence: 1.0,
                    corrected: None,
                },
                MaskTrackKeyframe {
                    time: 4.0,
                    translate_x: 0.3,
                    translate_y: 0.2,
                    scale: 1.4,
                    rotation: 0.4,
                    confidence: 0.8,
                    corrected: None,
                },
            ],
        }
    }

    #[test]
    fn mask_track_uses_identity_for_legacy_layers() {
        let transform = mask_track_transform(None, 3.0);
        assert_eq!(transform.translate_x, 0.0);
        assert_eq!(transform.translate_y, 0.0);
        assert_eq!(transform.scale, 1.0);
        assert_eq!(transform.rotation, 0.0);
    }

    #[test]
    fn mask_track_clamps_outside_and_interpolates_inside_range() {
        let track = sample_mask_track();
        let before = mask_track_transform(Some(&track), 1.0);
        assert_eq!(before.translate_x, 0.1);
        assert_eq!(before.scale, 1.0);

        let middle = mask_track_transform(Some(&track), 3.0);
        assert!((middle.translate_x - 0.2).abs() < 0.000_001);
        assert!((middle.translate_y - 0.0).abs() < 0.000_001);
        assert!((middle.scale - 1.2).abs() < 0.000_001);
        assert!((middle.rotation - 0.2).abs() < 0.000_001);

        let after = mask_track_transform(Some(&track), 5.0);
        assert_eq!(after.translate_x, 0.3);
        assert_eq!(after.scale, 1.4);
    }

    #[test]
    fn mask_timeline_keeps_missing_samples_empty() {
        let timeline = MaskTimeline {
            version: 1,
            start_time: 0.0,
            end_time: 2.0,
            sample_interval: 1.0,
            frames: vec![
                MaskTimelineFrame {
                    time: 0.0,
                    path: Some("face-0.pgm".to_string()),
                    transform: None,
                },
                MaskTimelineFrame {
                    time: 1.0,
                    path: None,
                    transform: None,
                },
                MaskTimelineFrame {
                    time: 2.0,
                    path: Some("face-2.pgm".to_string()),
                    transform: Some(MaskTimelineTransform {
                        translate_x: 0.2,
                        translate_y: 0.1,
                        scale: 1.1,
                        rotation: 0.05,
                        confidence: 0.9,
                    }),
                },
            ],
        };
        assert_eq!(
            mask_timeline_frame(&timeline, 0.2).and_then(|frame| frame.path.as_deref()),
            Some("face-0.pgm")
        );
        assert_eq!(
            mask_timeline_frame(&timeline, 1.0).and_then(|frame| frame.path.as_deref()),
            None
        );
        assert_eq!(
            mask_timeline_frame(&timeline, 1.8).and_then(|frame| frame.path.as_deref()),
            Some("face-2.pgm")
        );
        assert!(mask_timeline_frame(&timeline, 2.1).is_none());
        let transform = timeline.frames[2]
            .transform
            .as_ref()
            .expect("tracked frame");
        assert_eq!(transform.translate_x, 0.2);
    }

    fn staged_reveal() -> CompositionReveal {
        CompositionReveal {
            direction: "left-to-right".to_string(),
            start: 1.0,
            duration: 2.0,
            midpoint_hold: Some(0.5),
            midpoint_bounce: None,
            easing: Some("ease-in-out".to_string()),
        }
    }

    #[test]
    fn staged_reveal_holds_at_midpoint() {
        let reveal = staged_reveal();
        assert_eq!(reveal_progress(&reveal, 1.0), 0.0);
        assert_eq!(reveal_progress(&reveal, 2.0), 0.5);
        assert_eq!(reveal_progress(&reveal, 2.4), 0.5);
        assert_eq!(reveal_progress(&reveal, 3.5), 1.0);
    }

    #[test]
    fn staged_reveal_uses_curved_half_transitions() {
        let reveal = staged_reveal();
        assert!(reveal_progress(&reveal, 1.25) < 0.125);
        assert!(reveal_progress(&reveal, 2.75) < 0.625);
    }

    #[test]
    fn staged_reveal_can_bounce_after_midpoint() {
        let mut reveal = staged_reveal();
        reveal.midpoint_bounce = Some(0.04);
        assert!(reveal_progress(&reveal, 2.2) < 0.461);
        assert!((reveal_progress(&reveal, 2.5) - 0.5).abs() < 0.0001);
        assert!(reveal_progress(&reveal, 2.55) > 0.5);
        assert!(reveal_progress(&reveal, 2.78) > 0.99);
    }

    #[test]
    fn source_offset_holds_the_trimmed_first_frame() {
        let source = CompositionSource {
            path: "clip.mp4".to_string(),
            source_type: Some("video".to_string()),
            time: Some(CompositionSourceTime {
                offset: Some(1.0),
                start: Some(5.0),
                duration: Some(10.0),
                loop_enabled: Some(false),
            }),
        };
        assert_eq!(layer_time(&source, 0.0), 5.0);
        assert_eq!(layer_time(&source, 0.8), 5.0);
        assert_eq!(layer_time(&source, 1.5), 5.5);
    }

    #[test]
    fn video_container_cannot_be_forced_to_static_image() {
        let source = CompositionSource {
            path: "clip.MP4".to_string(),
            source_type: Some("image".to_string()),
            time: None,
        };

        assert!(is_video_source(&source));
    }

    #[test]
    fn composition_preserves_source_sampling_rect_and_defaults_to_full_source() {
        let input: CompositionInput = serde_json::from_str(
            r#"{
                "canvas":{"width":100,"height":100},
                "layers":[
                    {
                        "source":{"path":"sample.png"},
                        "rect":{"x":0,"y":0,"w":1,"h":1},
                        "sourceRect":{"x":0.42,"y":0.2,"w":0.001,"h":0.6}
                    },
                    {
                        "source":{"path":"legacy.png"},
                        "rect":{"x":0,"y":0,"w":1,"h":1}
                    }
                ]
            }"#,
        )
        .expect("composition JSON should deserialize");
        let layers = composition_layers(&input, 0.0);
        assert_eq!((layers[0].src_x, layers[0].src_y), (0.42, 0.2));
        assert_eq!((layers[0].src_w, layers[0].src_h), (0.001, 0.6));
        assert_eq!((layers[1].src_x, layers[1].src_y), (0.0, 0.0));
        assert_eq!((layers[1].src_w, layers[1].src_h), (1.0, 1.0));
    }

    #[test]
    fn composition_filters_layers_by_active_time_range() {
        let input: CompositionInput = serde_json::from_str(
            r#"{
                "canvas":{"width":100,"height":100},
                "layers":[
                    {"id":"base","source":{"path":"base.png"},"rect":{"x":0,"y":0,"w":1,"h":1}},
                    {"id":"subtitle","activeStart":1.0,"activeEnd":2.0,"source":{"path":""},"rect":{"x":0,"y":0,"w":1,"h":1}}
                ]
            }"#,
        ).expect("composition JSON should deserialize");
        assert_eq!(composition_layers(&input, 0.999).len(), 1);
        assert_eq!(composition_layers(&input, 1.0).len(), 2);
        assert_eq!(composition_layers(&input, 1.999).len(), 2);
        assert_eq!(composition_layers(&input, 2.0).len(), 1);
    }
}
