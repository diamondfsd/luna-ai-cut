use std::process::Command;

/// 简易 URL 百分比解码（仅处理 `%XX`，ffprobe/ffmpeg 不支持 URL 编码的路径）
fn normalize_path(path: &str) -> String {
    let raw = if let Some(rest) = path.strip_prefix("file://") {
        rest
    } else {
        return path.to_string();
    };
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let hi = chars.next().and_then(|c| hex_val(c));
            let lo = chars.next().and_then(|c| hex_val(c));
            match (hi, lo) {
                (Some(h), Some(l)) => out.push((h << 4 | l) as char),
                _ => out.push('%'),
            }
        } else {
            out.push(b as char);
        }
    }
    out
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[allow(dead_code)]
pub struct AudioInfo {
    pub has_audio: bool,
    pub codec: String,
}

#[allow(dead_code)]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration_secs: f64,
    pub frame_count: Option<u64>,
    pub src_bitrate: u32,
    pub audio: AudioInfo,
}

pub fn probe_video_dimensions(ffprobe: &str, input: &str) -> Result<(u32, u32), String> {
    let local = normalize_path(input);
    let output = Command::new(ffprobe)
        .args(["-v", "quiet", "-print_format", "json", "-show_streams", &local])
        .output()
        .map_err(|e| format!("ffprobe {}: {}", input, e))?;
    if !output.status.success() {
        return Err(format!("ffprobe exit: {}", output.status));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("ffprobe json: {}", e))?;
    let streams = parsed["streams"]
        .as_array()
        .ok_or_else(|| "no streams".to_string())?;
    let video = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or_else(|| "no video stream".to_string())?;
    video_display_dimensions(video, input)
}

pub fn probe_video_info(ffprobe: &str, input: &str) -> Result<VideoInfo, String> {
    let local = normalize_path(input);
    let output = Command::new(ffprobe)
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", &local])
        .output()
        .map_err(|e| format!("ffprobe: {}", e))?;
    if !output.status.success() {
        return Err(format!("ffprobe exit: {}", output.status));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("json: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;

    let video = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or("no video stream")?;
    let (width, height) = video_display_dimensions(video, input)?;
    let fps = parse_fps(video["r_frame_rate"].as_str().unwrap_or("30/1"));
    let duration_secs = video["duration"]
        .as_str()
        .or_else(|| parsed["format"]["duration"].as_str())
        .and_then(|duration| duration.parse::<f64>().ok())
        .unwrap_or(0.0);
    let frame_count = video["nb_frames"]
        .as_str()
        .and_then(|count| count.parse::<u64>().ok());
    let src_bitrate = parsed["format"]["bit_rate"]
        .as_str()
        .and_then(|bitrate| bitrate.parse::<u32>().ok())
        .unwrap_or(0);

    let audio_stream = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("audio"));
    let audio = AudioInfo {
        has_audio: audio_stream.is_some(),
        codec: audio_stream
            .and_then(|s| s["codec_name"].as_str().map(|codec| codec.to_string()))
            .unwrap_or_default(),
    };

    Ok(VideoInfo {
        width,
        height,
        fps,
        duration_secs,
        frame_count,
        src_bitrate,
        audio,
    })
}

fn video_display_dimensions(stream: &serde_json::Value, input: &str) -> Result<(u32, u32), String> {
    let encoded_w = stream["width"].as_u64().unwrap_or(0) as u32;
    let encoded_h = stream["height"].as_u64().unwrap_or(0) as u32;
    if encoded_w == 0 || encoded_h == 0 {
        return Err(format!("invalid video dimensions in {}", input));
    }
    let rotation = video_rotation_degrees(stream);
    if rotation == 90 || rotation == 270 {
        crate::log!(
            "probe_video rotation={} swap {}x{} -> {}x{} input={}",
            rotation,
            encoded_w,
            encoded_h,
            encoded_h,
            encoded_w,
            input
        );
        Ok((encoded_h, encoded_w))
    } else {
        Ok((encoded_w, encoded_h))
    }
}

fn video_rotation_degrees(stream: &serde_json::Value) -> i32 {
    stream["side_data_list"]
        .as_array()
        .and_then(|list| {
            list.iter()
                .filter_map(|side_data| side_data["rotation"].as_f64())
                .map(|rotation| ((rotation.round() as i32 % 360) + 360) % 360)
                .find(|rotation| *rotation == 90 || *rotation == 270)
        })
        .unwrap_or(0)
}

fn parse_fps(value: &str) -> f64 {
    let parts: Vec<&str> = value.split('/').collect();
    if parts.len() == 2 {
        let numerator: f64 = parts[0].parse().unwrap_or(30.0);
        let denominator: f64 = parts[1].parse().unwrap_or(1.0);
        if denominator > 0.0 {
            numerator / denominator
        } else {
            30.0
        }
    } else {
        value.parse().unwrap_or(30.0)
    }
}
