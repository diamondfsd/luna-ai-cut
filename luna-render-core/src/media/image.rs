use std::io::Read;
use std::process::{Command, Stdio};

pub(crate) fn decode_static_image_scaled(
    ffmpeg: &str,
    ffprobe: &str,
    path: &str,
    max_size: u32,
) -> Result<(Vec<u8>, u32, u32), String> {
    let parsed = probe_image_json(ffprobe, path)?;
    let (encoded_w, encoded_h, rotation) = image_metadata(&parsed, path)?;
    let (source_w, source_h) = display_dimensions(encoded_w, encoded_h, rotation);
    if rotation == 90 || rotation == 270 {
        crate::log!(
            "decode_static_image rotation={} swap {}x{} -> {}x{} path={}",
            rotation,
            encoded_w,
            encoded_h,
            source_w,
            source_h,
            path
        );
    }

    let max_edge = source_w.max(source_h);
    let (width, height) = if max_edge > max_size {
        let scale = max_size as f64 / max_edge as f64;
        (
            (source_w as f64 * scale).round().max(1.0) as u32,
            (source_h as f64 * scale).round().max(1.0) as u32,
        )
    } else {
        (source_w, source_h)
    };

    let local_path = normalize_local_path(path);
    let mut process = Command::new(ffmpeg)
        .args([
            "-i",
            &local_path,
            "-vf",
            &format!("scale={}:{}:flags=lanczos", width, height),
            "-pix_fmt",
            "rgba",
            "-f",
            "rawvideo",
            "-vframes",
            "1",
            "-loglevel",
            "error",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| format!("ffmpeg spawn {}: {}", path, error))?;

    let mut rgba = vec![0; (width * height * 4) as usize];
    process
        .stdout
        .take()
        .ok_or_else(|| "no stdout".to_string())?
        .read_exact(&mut rgba)
        .map_err(|error| format!("read {}: {}", path, error))?;
    let _ = process.wait();
    crate::log!(
        "decode_static_image {} encoded={}x{} display={}x{} output={}x{} rotation={} bytes={}",
        path,
        encoded_w,
        encoded_h,
        source_w,
        source_h,
        width,
        height,
        rotation,
        rgba.len()
    );
    Ok((rgba, width, height))
}

pub(crate) fn probe_static_image_dimensions(
    ffprobe: &str,
    path: &str,
) -> Result<(u32, u32), String> {
    let parsed = probe_image_json(ffprobe, path)?;
    let (width, height, rotation) = image_metadata(&parsed, path)?;
    Ok(display_dimensions(width, height, rotation))
}

pub(crate) fn normalize_local_path(path: &str) -> String {
    let Some(raw) = path.strip_prefix("file://") else {
        return path.to_string();
    };
    let mut output = String::with_capacity(raw.len());
    let mut bytes = raw.bytes();
    while let Some(byte) = bytes.next() {
        if byte != b'%' {
            output.push(byte as char);
            continue;
        }
        match (bytes.next(), bytes.next()) {
            (Some(high), Some(low)) => {
                match ((high as char).to_digit(16), (low as char).to_digit(16)) {
                    (Some(high), Some(low)) => output.push((high as u8 * 16 + low as u8) as char),
                    _ => output.push('%'),
                }
            }
            _ => output.push('%'),
        }
    }
    output
}

fn probe_image_json(ffprobe: &str, path: &str) -> Result<serde_json::Value, String> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_frames",
            "-read_intervals",
            "%+#1",
            path,
        ])
        .output()
        .map_err(|error| format!("ffprobe {}: {}", path, error))?;
    serde_json::from_slice(&output.stdout).map_err(|error| format!("ffprobe json: {}", error))
}

fn image_metadata(parsed: &serde_json::Value, path: &str) -> Result<(u32, u32, i32), String> {
    let frame = parsed["frames"].as_array().and_then(|frames| {
        frames
            .iter()
            .find(|frame| frame["media_type"].as_str() == Some("video"))
    });
    let stream = parsed["streams"].as_array().and_then(|streams| {
        streams
            .iter()
            .find(|stream| stream["codec_type"].as_str() == Some("video"))
    });
    let width = frame
        .and_then(|frame| frame["width"].as_u64())
        .or_else(|| stream.and_then(|stream| stream["width"].as_u64()))
        .unwrap_or(0) as u32;
    let height = frame
        .and_then(|frame| frame["height"].as_u64())
        .or_else(|| stream.and_then(|stream| stream["height"].as_u64()))
        .unwrap_or(0) as u32;
    if width == 0 || height == 0 {
        return Err(format!("invalid image size in {}", path));
    }
    Ok((width, height, image_rotation_degrees(frame, stream)))
}

fn display_dimensions(width: u32, height: u32, rotation: i32) -> (u32, u32) {
    if rotation == 90 || rotation == 270 {
        (height, width)
    } else {
        (width, height)
    }
}

fn image_rotation_degrees(
    frame: Option<&serde_json::Value>,
    stream: Option<&serde_json::Value>,
) -> i32 {
    let matrix_rotation = frame
        .and_then(rotation_from_side_data)
        .or_else(|| stream.and_then(rotation_from_side_data))
        .unwrap_or(0);
    if matrix_rotation != 0 {
        return matrix_rotation;
    }
    frame
        .and_then(rotation_from_orientation_tag)
        .or_else(|| stream.and_then(rotation_from_orientation_tag))
        .unwrap_or(0)
}

fn rotation_from_side_data(value: &serde_json::Value) -> Option<i32> {
    value["side_data_list"].as_array().and_then(|list| {
        list.iter()
            .filter_map(|side_data| side_data["rotation"].as_f64())
            .map(|rotation| ((rotation.round() as i32 % 360) + 360) % 360)
            .find(|rotation| *rotation == 90 || *rotation == 270)
    })
}

fn rotation_from_orientation_tag(value: &serde_json::Value) -> Option<i32> {
    match value["tags"]["Orientation"].as_str()?.trim() {
        "6" => Some(90),
        "8" => Some(270),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_local_path;

    #[test]
    fn decodes_file_url_path() {
        assert_eq!(
            normalize_local_path("file:///tmp/a%20b.jpg"),
            "/tmp/a b.jpg"
        );
    }
}
