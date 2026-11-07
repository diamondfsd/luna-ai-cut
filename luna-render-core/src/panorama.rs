use std::fs::{self, File};
use std::io::BufReader;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use jpeg_decoder::{Decoder, PixelFormat};
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Task};
use napi_derive::napi;
use panoloom_core::export::Exporter;
use panoloom_core::pipeline::{
    align_grid_neighbors, align_grid_neighbors_with_zenith, align_pose_neighbors, SourceImage,
};
use panoloom_core::warp::PixelImage;

const REGISTRATION_WIDTH: usize = 1200;

pub struct PanoramaTask {
    paths: Vec<String>,
    poses: Vec<Vec<f64>>,
    rows: usize,
    columns: usize,
    target_width: usize,
    output_path: String,
}

impl Task for PanoramaTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        stitch_panorama(
            &self.paths,
            &self.poses,
            self.rows,
            self.columns,
            self.target_width,
            &self.output_path,
        )
        .map_err(Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn stitch_panorama_async(
    paths: Vec<String>,
    poses: Vec<Vec<f64>>,
    rows: u32,
    columns: u32,
    target_width: u32,
    output_path: String,
) -> AsyncTask<PanoramaTask> {
    AsyncTask::new(PanoramaTask {
        paths,
        poses,
        rows: rows as usize,
        columns: columns as usize,
        target_width: target_width as usize,
        output_path,
    })
}

fn stitch_panorama(
    paths: &[String],
    poses: &[Vec<f64>],
    rows: usize,
    columns: usize,
    target_width: usize,
    output_path: &str,
) -> std::result::Result<String, String> {
    let has_zenith = rows == 3 && matches!(columns, 6 | 7 | 8);
    if !has_zenith && (rows != 4 || !matches!(columns, 6 | 8)) {
        return Err(
            "panorama layout must be 19/22/24-photo ring+zenith or legacy 24/32 rectangular".into(),
        );
    }
    let expected = if has_zenith {
        match columns {
            6 => 19,
            7 => 22,
            8 => 24,
            _ => unreachable!("validated zenith column count"),
        }
    } else {
        rows * columns
    };
    if paths.len() != expected || poses.len() != expected {
        return Err(format!("expected {expected} ordered photos and poses"));
    }
    if !matches!(target_width, 16_000 | 24_000 | 32_000) {
        return Err("target width must be 16000, 24000 or 32000".into());
    }

    let mut sources = Vec::with_capacity(expected);
    let mut full_sizes = Vec::with_capacity(expected);
    for (id, (path, pose)) in paths.iter().zip(poses).enumerate() {
        if pose.len() != 3 || pose.iter().any(|v| !v.is_finite()) {
            return Err(format!("invalid pose for image {id}"));
        }
        let (width, height, rgb) = decode_jpeg(path)?;
        let ratio = width as f64 / height as f64;
        if (ratio - 4.0 / 3.0).abs() > 0.025 {
            return Err(format!("image {id} is not 4:3 ({width}x{height})"));
        }
        let (reg_width, reg_height, registration) =
            resize_rgb(&rgb, width, height, REGISTRATION_WIDTH);
        sources.push(SourceImage {
            id: id as u32,
            rgb: PixelImage::new(reg_width, reg_height, 3, registration),
            pose_prior: Some([pose[0], pose[1], pose[2]]),
        });
        full_sizes.push((id as u32, width as u32, height as u32));
    }

    let regular_nineteen = has_zenith
        && columns == 6
        && poses.iter().take(18).enumerate().all(|(i, pose)| {
            let yaw = -57.0 + 292.0 * (i % 6) as f64 / 5.0;
            let pitch = 45.0 - 45.0 * (i / 6) as f64;
            (pose[0] - yaw).abs() < 0.001 && (pose[1] - pitch).abs() < 0.001
        });
    let alignment = if regular_nineteen {
        align_grid_neighbors_with_zenith(&sources, rows, columns)?
    } else if has_zenith {
        align_pose_neighbors(&sources)?
    } else {
        align_grid_neighbors(&sources, rows, columns)?
    };
    if alignment.images.len() != expected || !alignment.dropped.is_empty() {
        return Err(format!(
            "feature matching connected {} of {expected} photos",
            alignment.images.len()
        ));
    }
    let rescued: Vec<_> = alignment
        .images
        .iter()
        .filter(|image| image.rescued)
        .map(|image| image.id + 1)
        .collect();
    if !rescued.is_empty() {
        return Err(format!(
            "photos {rescued:?} have no reliable feature connection"
        ));
    }

    let empty_masks = vec![None; alignment.images.len()];
    let mut exporter = Exporter::new(
        &sources,
        &alignment,
        &empty_masks,
        &full_sizes,
        target_width,
        None,
    )?;

    for band_index in 0..exporter.bands().len() {
        let required = exporter.bands()[band_index].needed.clone();
        for id in &required {
            let path = paths
                .get(*id as usize)
                .ok_or_else(|| format!("missing source path for image {id}"))?;
            let (width, height, rgb) = decode_jpeg(path)?;
            exporter.set_full_image(*id, PixelImage::new(width, height, 3, rgb))?;
        }
        exporter.composite_band(band_index)?;
        for id in required {
            exporter.drop_full_image(id);
        }
    }

    let (jpeg, width, height, full_width, full_height, crop_left, crop_top) =
        exporter.finish(95)?;
    let jpeg = inject_gpano_xmp(
        jpeg,
        width,
        height,
        full_width,
        full_height,
        crop_left,
        crop_top,
    )?;
    let target = PathBuf::from(output_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "invalid panorama output filename".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temporary = target.with_file_name(format!(".{file_name}.{nonce}.partial"));
    if let Err(error) = fs::write(&temporary, jpeg) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    serde_json::to_string(&serde_json::json!({
        "path": target.to_string_lossy(),
        "width": width,
        "height": height,
        "fullWidth": full_width,
        "fullHeight": full_height,
        "cropLeft": crop_left,
        "cropTop": crop_top,
    }))
    .map_err(|error| error.to_string())
}

fn inject_gpano_xmp(
    mut jpeg: Vec<u8>,
    width: usize,
    height: usize,
    full_width: usize,
    full_height: usize,
    crop_left: usize,
    crop_top: usize,
) -> std::result::Result<Vec<u8>, String> {
    if jpeg.len() < 2 || jpeg[0..2] != [0xff, 0xd8] {
        return Err("panorama encoder returned invalid JPEG data".into());
    }
    let xml = format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\
<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description rdf:about=\"\" xmlns:GPano=\"http://ns.google.com/photos/1.0/panorama/\" GPano:ProjectionType=\"equirectangular\" GPano:UsePanoramaViewer=\"True\" GPano:CroppedAreaImageWidthPixels=\"{width}\" GPano:CroppedAreaImageHeightPixels=\"{height}\" GPano:FullPanoWidthPixels=\"{full_width}\" GPano:FullPanoHeightPixels=\"{full_height}\" GPano:CroppedAreaLeftPixels=\"{crop_left}\" GPano:CroppedAreaTopPixels=\"{crop_top}\"/></rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>"
    );
    let namespace = b"http://ns.adobe.com/xap/1.0/\0";
    let payload_length = namespace.len() + xml.len();
    let segment_length = payload_length + 2;
    if segment_length > u16::MAX as usize {
        return Err("panorama XMP metadata exceeds JPEG segment limit".into());
    }
    let mut segment = Vec::with_capacity(payload_length + 4);
    segment.extend_from_slice(&[0xff, 0xe1]);
    segment.extend_from_slice(&(segment_length as u16).to_be_bytes());
    segment.extend_from_slice(namespace);
    segment.extend_from_slice(xml.as_bytes());
    jpeg.splice(2..2, segment);
    Ok(jpeg)
}

fn decode_jpeg(path: &str) -> std::result::Result<(usize, usize, Vec<u8>), String> {
    let file = File::open(path).map_err(|error| format!("open {path}: {error}"))?;
    let mut decoder = Decoder::new(BufReader::new(file));
    let decoded = decoder
        .decode()
        .map_err(|error| format!("decode {path}: {error}"))?;
    let info = decoder
        .info()
        .ok_or_else(|| format!("missing JPEG dimensions for {path}"))?;
    let width = info.width as usize;
    let height = info.height as usize;
    let rgb = match info.pixel_format {
        PixelFormat::RGB24 => decoded,
        PixelFormat::L8 => {
            let mut rgb = Vec::with_capacity(width * height * 3);
            for value in decoded {
                rgb.extend_from_slice(&[value, value, value]);
            }
            rgb
        }
        PixelFormat::L16 => {
            let mut rgb = Vec::with_capacity(width * height * 3);
            for pixel in decoded.chunks_exact(2) {
                let value = u16::from_ne_bytes([pixel[0], pixel[1]]) >> 8;
                let value = value as u8;
                rgb.extend_from_slice(&[value, value, value]);
            }
            rgb
        }
        PixelFormat::CMYK32 => {
            let mut rgb = Vec::with_capacity(width * height * 3);
            for pixel in decoded.chunks_exact(4) {
                let k = pixel[3] as u16;
                rgb.extend_from_slice(&[
                    (255 - ((pixel[0] as u16 + k).min(255))) as u8,
                    (255 - ((pixel[1] as u16 + k).min(255))) as u8,
                    (255 - ((pixel[2] as u16 + k).min(255))) as u8,
                ]);
            }
            rgb
        }
    };
    if rgb.len() != width * height * 3 {
        return Err(format!("unexpected JPEG pixel buffer for {path}"));
    }
    Ok((width, height, rgb))
}

fn resize_rgb(
    rgb: &[u8],
    width: usize,
    height: usize,
    max_width: usize,
) -> (usize, usize, Vec<u8>) {
    let out_width = width.min(max_width);
    let out_height = ((height as f64 * out_width as f64 / width as f64).round() as usize).max(1);
    if out_width == width && out_height == height {
        return (out_width, out_height, rgb.to_vec());
    }
    let mut output = vec![0u8; out_width * out_height * 3];
    for y in 0..out_height {
        let sy = ((y as f64 + 0.5) * height as f64 / out_height as f64) as usize;
        for x in 0..out_width {
            let sx = ((x as f64 + 0.5) * width as f64 / out_width as f64) as usize;
            let from = (sy.min(height - 1) * width + sx.min(width - 1)) * 3;
            let to = (y * out_width + x) * 3;
            output[to..to + 3].copy_from_slice(&rgb[from..from + 3]);
        }
    }
    (out_width, out_height, output)
}
