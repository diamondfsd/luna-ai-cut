use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};

use base64::Engine;
use napi::{Env, Task};
use napi_derive::napi;
use tract_onnx::prelude::*;

use crate::{RenderBeautyFace, media::probe_video_dimensions};
use crate::beauty_person::{detect_people, person_head_crop};

const ANALYSIS_VERSION: u32 = 9;
const DETECTOR_SIDE: usize = 640;
const LANDMARK_SIDE: usize = 192;
const PARSING_SIDE: usize = 512;
const MASK_SIDE: usize = 128;
const MAX_IMAGE_SIDE: u32 = 2560;
const MAX_FACES: usize = 3;

pub(crate) type ModelPlan = TypedRunnableModel<TypedModel>;

struct BeautyModels {
    root: PathBuf,
    person: ModelPlan,
    detector: ModelPlan,
    landmarks: ModelPlan,
    parsing: ModelPlan,
}

#[derive(Clone)]
pub(crate) struct RgbImage {
    pub(crate) width: usize,
    pub(crate) height: usize,
    pub(crate) pixels: Vec<u8>,
}

#[derive(Clone, Copy)]
pub(crate) struct FaceBox {
    pub(crate) x1: f32,
    pub(crate) y1: f32,
    pub(crate) x2: f32,
    pub(crate) y2: f32,
    pub(crate) score: f32,
}

#[derive(Clone, Copy)]
pub(crate) struct Crop {
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) size: f32,
}

#[napi(object)]
pub struct NativeBeautyAnalysis {
    pub faces: Vec<RenderBeautyFace>,
    pub skin_mask: String,
    pub skin_mask_width: u32,
    pub skin_mask_height: u32,
    pub analysis_version: u32,
}

static MODELS: LazyLock<Mutex<Option<BeautyModels>>> = LazyLock::new(|| Mutex::new(None));

fn load_model(path: &Path, shape: &[usize]) -> Result<ModelPlan, String> {
    let mut model = tract_onnx::onnx().model_for_path(path)
        .map_err(|error| format!("加载模型失败 {}: {error}", path.display()))?;
    model.set_input_fact(0, InferenceFact::dt_shape(f32::datum_type(), shape))
        .map_err(|error| format!("设置模型输入失败 {}: {error}", path.display()))?;
    model.into_optimized()
        .and_then(|model| model.into_runnable())
        .map_err(|error| format!("准备模型失败 {}: {error}", path.display()))
}

fn with_models<T>(root: &Path, run: impl FnOnce(&BeautyModels) -> Result<T, String>) -> Result<T, String> {
    let mut guard = MODELS.lock().map_err(|error| format!("锁定美颜模型失败: {error}"))?;
    let needs_reload = guard.as_ref().is_none_or(|models| models.root != root);
    if needs_reload {
        *guard = Some(BeautyModels {
            root: root.to_path_buf(),
            person: load_model(&root.join("person-yolox-nano.onnx"), &[1, 3, 416, 416])?,
            detector: load_model(&root.join("scrfd-500m-kps.onnx"), &[1, 3, DETECTOR_SIDE, DETECTOR_SIDE])?,
            landmarks: load_model(&root.join("face-landmarks-106.onnx"), &[1, 3, LANDMARK_SIDE, LANDMARK_SIDE])?,
            parsing: load_model(&root.join("face-parsing-resnet18.onnx"), &[1, 3, PARSING_SIDE, PARSING_SIDE])?,
        });
    }
    run(guard.as_ref().expect("models initialized"))
}

fn decode_image(ffmpeg: &str, ffprobe: &str, path: &str) -> Result<RgbImage, String> {
    let (source_width, source_height) = probe_video_dimensions(ffprobe, path)?;
    let scale = (MAX_IMAGE_SIDE as f64 / source_width.max(source_height) as f64).min(1.0);
    let width = (source_width as f64 * scale).round().max(1.0) as usize;
    let height = (source_height as f64 * scale).round().max(1.0) as usize;
    let filter = format!("scale={width}:{height}");
    let output = Command::new(ffmpeg)
        .args(["-v", "error", "-i", path, "-vf", &filter, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])
        .output()
        .map_err(|error| format!("读取图片失败: {error}"))?;
    if !output.status.success() {
        return Err(format!("读取图片失败: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let expected = width * height * 3;
    if output.stdout.len() != expected {
        return Err(format!("图片数据不完整: 需要 {expected} 字节，实际 {} 字节", output.stdout.len()));
    }
    Ok(RgbImage { width, height, pixels: output.stdout })
}

pub(crate) fn sample(image: &RgbImage, x: f32, y: f32) -> [f32; 3] {
    if x < 0.0 || y < 0.0 || x > image.width as f32 - 1.0 || y > image.height as f32 - 1.0 {
        return [0.0; 3];
    }
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(image.width - 1);
    let y1 = (y0 + 1).min(image.height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let pixel = |px: usize, py: usize, channel: usize| image.pixels[(py * image.width + px) * 3 + channel] as f32;
    let mut rgb = [0.0; 3];
    for (channel, value) in rgb.iter_mut().enumerate() {
        let top = pixel(x0, y0, channel) * (1.0 - tx) + pixel(x1, y0, channel) * tx;
        let bottom = pixel(x0, y1, channel) * (1.0 - tx) + pixel(x1, y1, channel) * tx;
        *value = top * (1.0 - ty) + bottom * ty;
    }
    rgb
}

fn image_tensor(image: &RgbImage, side: usize, crop: Crop, normalize: bool, bgr: bool, centered: bool) -> Tensor {
    let mut data = vec![0.0f32; 3 * side * side];
    for y in 0..side {
        for x in 0..side {
            let source_x = crop.x + (x as f32 + 0.5) * crop.size / side as f32 - 0.5;
            let source_y = crop.y + (y as f32 + 0.5) * crop.size / side as f32 - 0.5;
            let rgb = sample(image, source_x, source_y);
            for channel in 0..3 {
                let source_channel = if bgr { 2 - channel } else { channel };
                let mut value = rgb[source_channel];
                if normalize {
                    const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
                    const STD: [f32; 3] = [0.229, 0.224, 0.225];
                    value = (value / 255.0 - MEAN[channel]) / STD[channel];
                } else if centered {
                    value = (value - 127.5) / 127.5;
                }
                data[channel * side * side + y * side + x] = value;
            }
        }
    }
    tract_ndarray::Array4::from_shape_vec((1, 3, side, side), data).expect("tensor shape").into_tensor()
}

fn detect_faces_in_crop(models: &BeautyModels, image: &RgbImage, crop: Crop) -> Result<Vec<FaceBox>, String> {
    let input = image_tensor(image, DETECTOR_SIDE, crop, false, true, true);
    let outputs = models.detector.run(tvec!(input.into()))
        .map_err(|error| format!("人脸检测失败: {error}"))?;
    let mut faces = Vec::new();
    let mut max_score = 0.0f32;
    for (level, stride) in [8usize, 16, 32].iter().enumerate() {
        let scores = outputs[level].to_array_view::<f32>().map_err(|error| error.to_string())?;
        let boxes = outputs[3 + level].to_array_view::<f32>().map_err(|error| error.to_string())?;
        let feature_width = DETECTOR_SIDE / stride;
        for index in 0..scores.len() {
            let score = scores[[index, 0]];
            max_score = max_score.max(score);
            if score < 0.5 { continue; }
            let cell = index / 2;
            let anchor_x = (cell % feature_width) as f32 * *stride as f32;
            let anchor_y = (cell / feature_width) as f32 * *stride as f32;
            let scale = crop.size / DETECTOR_SIDE as f32;
            let x1 = crop.x + (anchor_x - boxes[[index, 0]] * *stride as f32) * scale;
            let y1 = crop.y + (anchor_y - boxes[[index, 1]] * *stride as f32) * scale;
            let x2 = crop.x + (anchor_x + boxes[[index, 2]] * *stride as f32) * scale;
            let y2 = crop.y + (anchor_y + boxes[[index, 3]] * *stride as f32) * scale;
            if x1 < image.width as f32 && y1 < image.height as f32 {
                faces.push(FaceBox { x1: x1.max(0.0), y1: y1.max(0.0), x2: x2.min(image.width as f32), y2: y2.min(image.height as f32), score });
            }
        }
    }
    if std::env::var_os("LUNA_BEAUTY_DEBUG").is_some() {
        eprintln!("[beauty-analysis] detector max_score={max_score:.4} candidates={}", faces.len());
    }
    faces.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected = Vec::new();
    for face in faces {
        if selected.iter().any(|candidate| intersection_over_union(face, *candidate) > 0.4) { continue; }
        selected.push(face);
        if selected.len() == MAX_FACES { break; }
    }
    Ok(selected)
}

fn detect_faces(models: &BeautyModels, image: &RgbImage) -> Result<Vec<FaceBox>, String> {
    let full_size = image.width.max(image.height) as f32;
    let mut faces = detect_faces_in_crop(models, image, Crop { x: 0.0, y: 0.0, size: full_size })?;
    for person in detect_people(&models.person, image)? {
        faces.extend(detect_faces_in_crop(models, image, person_head_crop(person))?);
    }
    faces.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected = Vec::new();
    for face in faces {
        if selected.iter().any(|candidate| intersection_over_union(face, *candidate) > 0.4) { continue; }
        selected.push(face);
        if selected.len() == MAX_FACES { break; }
    }
    Ok(selected)
}

pub(crate) fn intersection_over_union(a: FaceBox, b: FaceBox) -> f32 {
    let intersection = (a.x2.min(b.x2) - a.x1.max(b.x1)).max(0.0)
        * (a.y2.min(b.y2) - a.y1.max(b.y1)).max(0.0);
    let area_a = (a.x2 - a.x1).max(0.0) * (a.y2 - a.y1).max(0.0);
    let area_b = (b.x2 - b.x1).max(0.0) * (b.y2 - b.y1).max(0.0);
    intersection / (area_a + area_b - intersection).max(0.0001)
}

fn face_crop(face: FaceBox, scale: f32) -> Crop {
    let width = face.x2 - face.x1;
    let height = face.y2 - face.y1;
    let size = width.max(height) * scale;
    Crop { x: (face.x1 + face.x2 - size) * 0.5, y: (face.y1 + face.y2 - size) * 0.5, size }
}

fn detect_landmarks(models: &BeautyModels, image: &RgbImage, face: FaceBox) -> Result<Vec<[f32; 2]>, String> {
    let crop = face_crop(face, 1.5);
    let input = image_tensor(image, LANDMARK_SIDE, crop, false, false, false);
    let outputs = models.landmarks.run(tvec!(input.into()))
        .map_err(|error| format!("面部结构识别失败: {error}"))?;
    let values = outputs[0].to_array_view::<f32>().map_err(|error| error.to_string())?;
    Ok((0..106).map(|index| {
        let x = (values[[0, index * 2]] + 1.0) * LANDMARK_SIDE as f32 * 0.5;
        let y = (values[[0, index * 2 + 1]] + 1.0) * LANDMARK_SIDE as f32 * 0.5;
        [crop.x + x * crop.size / LANDMARK_SIDE as f32, crop.y + y * crop.size / LANDMARK_SIDE as f32]
    }).collect())
}

fn bounds(points: &[[f32; 2]]) -> (f32, f32, f32, f32) {
    let min_x = points.iter().map(|point| point[0]).fold(f32::INFINITY, f32::min);
    let max_x = points.iter().map(|point| point[0]).fold(f32::NEG_INFINITY, f32::max);
    let min_y = points.iter().map(|point| point[1]).fold(f32::INFINITY, f32::min);
    let max_y = points.iter().map(|point| point[1]).fold(f32::NEG_INFINITY, f32::max);
    ((min_x + max_x) * 0.5, (min_y + max_y) * 0.5, (max_x - min_x) * 0.5, (max_y - min_y) * 0.5)
}

fn resample(points: &[[f32; 2]], count: usize) -> Vec<[f32; 2]> {
    if points.len() < 2 { return vec![[0.0, 0.0]; count]; }
    let lengths: Vec<f32> = (0..points.len()).map(|index| {
        let next = points[(index + 1) % points.len()];
        (next[0] - points[index][0]).hypot(next[1] - points[index][1])
    }).collect();
    let perimeter: f32 = lengths.iter().sum();
    let mut edge = 0usize;
    let mut start_distance = 0.0;
    (0..count).map(|index| {
        let target = perimeter * index as f32 / count as f32;
        while edge + 1 < lengths.len() && start_distance + lengths[edge] < target {
            start_distance += lengths[edge];
            edge += 1;
        }
        let ratio = (target - start_distance) / lengths[edge].max(0.0001);
        let next = points[(edge + 1) % points.len()];
        [points[edge][0] + (next[0] - points[edge][0]) * ratio, points[edge][1] + (next[1] - points[edge][1]) * ratio]
    }).collect()
}

fn convex_hull(points: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    let cross = |origin: [f32; 2], a: [f32; 2], b: [f32; 2]| {
        (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])
    };
    let mut lower = Vec::new();
    for point in &sorted {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], *point) <= 0.0 { lower.pop(); }
        lower.push(*point);
    }
    let mut upper = Vec::new();
    for point in sorted.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], *point) <= 0.0 { upper.pop(); }
        upper.push(*point);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

fn encode_points(points: &[[f32; 2]], width: f32, height: f32) -> String {
    let mut bytes = Vec::with_capacity(points.len() * 4);
    for point in points {
        let x = (point[0] / width).clamp(0.0, 1.0);
        let y = (point[1] / height).clamp(0.0, 1.0);
        bytes.extend_from_slice(&((x * 65535.0).round() as u16).to_le_bytes());
        bytes.extend_from_slice(&((y * 65535.0).round() as u16).to_le_bytes());
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn compact_face(points: &[[f32; 2]], image: &RgbImage, detection: FaceBox) -> RenderBeautyFace {
    let temple_y = points[0..33].iter().map(|point| point[1]).fold(f32::INFINITY, f32::min);
    let center_x = (detection.x1 + detection.x2) * 0.5;
    let radius_x = (detection.x2 - detection.x1) * 0.5;
    let radius_y = (temple_y - detection.y1).max((detection.y2 - detection.y1) * 0.22);
    let mut contour_candidates = points[0..33].to_vec();
    for index in 0..9 {
        let angle = std::f32::consts::PI + std::f32::consts::PI * index as f32 / 8.0;
        contour_candidates.push([center_x + radius_x * angle.cos(), temple_y + radius_y * angle.sin()]);
    }
    let contour = resample(&convex_hull(&contour_candidates), 24);
    // InsightFace's 2d106det topology is not grouped in the same order as
    // MediaPipe: eyes are 33..42 and 87..96, while lips are 52..71.
    let left_eye = resample(&convex_hull(&points[33..43]), 16);
    let right_eye = resample(&convex_hull(&points[87..97]), 16);
    let mouth = resample(&convex_hull(&points[52..72]), 20);
    let (mouth_x, mouth_y, mouth_rx, mouth_ry) = bounds(&mouth);
    let inner_mouth: Vec<[f32; 2]> = mouth.iter().map(|point| [mouth_x + (point[0] - mouth_x) * 0.56, mouth_y + (point[1] - mouth_y) * 0.48]).collect();
    let (left_x, left_y, left_rx, left_ry) = bounds(&left_eye);
    let (right_x, right_y, right_rx, right_ry) = bounds(&right_eye);
    let (face_x, face_y, face_rx, face_ry) = bounds(&contour);
    let forehead = [center_x, temple_y - radius_y];
    let chin = *points[0..33].iter().max_by(|a, b| a[1].total_cmp(&b[1])).unwrap();
    let left_jaw = *points[0..33].iter().min_by(|a, b| a[0].total_cmp(&b[0])).unwrap();
    let right_jaw = *points[0..33].iter().max_by(|a, b| a[0].total_cmp(&b[0])).unwrap();
    let nose = &points[72..87];
    let nose_top = *nose.iter().min_by(|a, b| a[1].total_cmp(&b[1])).unwrap();
    let nose_bottom = *nose.iter().max_by(|a, b| a[1].total_cmp(&b[1])).unwrap();
    let nose_left = *nose.iter().min_by(|a, b| a[0].total_cmp(&b[0])).unwrap();
    let nose_right = *nose.iter().max_by(|a, b| a[0].total_cmp(&b[0])).unwrap();
    let mut packed = vec![forehead, chin, left_jaw, right_jaw];
    packed.extend(left_eye);
    packed.extend(right_eye);
    packed.extend([nose_top, nose_bottom, nose_left, nose_right]);
    packed.extend(mouth);
    packed.extend(inner_mouth);
    let width = image.width as f32;
    let height = image.height as f32;
    RenderBeautyFace {
        center_x: (face_x / width) as f64, center_y: (face_y / height) as f64,
        width: (face_rx * 2.16 / width) as f64, height: (face_ry * 2.16 / height) as f64,
        left_eye_x: (left_x / width) as f64, left_eye_y: (left_y / height) as f64,
        left_eye_radius_x: (left_rx / width) as f64, left_eye_radius_y: (left_ry / height) as f64,
        right_eye_x: (right_x / width) as f64, right_eye_y: (right_y / height) as f64,
        right_eye_radius_x: (right_rx / width) as f64, right_eye_radius_y: (right_ry / height) as f64,
        mouth_x: (mouth_x / width) as f64, mouth_y: (mouth_y / height) as f64,
        mouth_radius_x: (mouth_rx / width) as f64, mouth_radius_y: (mouth_ry / height) as f64,
        contour: contour.into_iter().flat_map(|point| [(point[0] / width) as f64, (point[1] / height) as f64]).collect(),
        landmark_mesh: encode_points(&packed, width, height), landmark_count: packed.len() as u32,
    }
}

fn parse_skin(models: &BeautyModels, image: &RgbImage, faces: &[FaceBox]) -> Result<(Vec<u8>, Vec<FaceBox>), String> {
    let mut output = vec![0u8; MASK_SIDE * MASK_SIDE];
    let mut accepted = Vec::new();
    for face in faces {
        let crop = face_crop(*face, 1.75);
        let input = image_tensor(image, PARSING_SIDE, crop, true, false, false);
        let values = models.parsing.run(tvec!(input.into()))
            .map_err(|error| format!("皮肤区域识别失败: {error}"))?;
        let logits = values[0].to_array_view::<f32>().map_err(|error| error.to_string())?;
        let mut skin_samples = 0usize;
        let mut feature_samples = 0usize;
        let mut total_samples = 0usize;
        for y in (0..PARSING_SIDE).step_by(8) {
            for x in (0..PARSING_SIDE).step_by(8) {
                let mut label = 0usize;
                let mut confidence = f32::NEG_INFINITY;
                for class in 0..19 {
                    let value = logits[[0, class, y, x]];
                    if value > confidence { confidence = value; label = class; }
                }
                skin_samples += usize::from(matches!(label, 1 | 7 | 8 | 10 | 14));
                feature_samples += usize::from(matches!(label, 4 | 5 | 11 | 12 | 13));
                total_samples += 1;
            }
        }
        if skin_samples as f32 / (total_samples as f32) < 0.035 || feature_samples < 3 { continue; }
        accepted.push(*face);
        for mask_y in 0..MASK_SIDE {
            for mask_x in 0..MASK_SIDE {
                let source_x = (mask_x as f32 + 0.5) * image.width as f32 / MASK_SIDE as f32;
                let source_y = (mask_y as f32 + 0.5) * image.height as f32 / MASK_SIDE as f32;
                let local_x = ((source_x - crop.x) / crop.size * PARSING_SIDE as f32) as isize;
                let local_y = ((source_y - crop.y) / crop.size * PARSING_SIDE as f32) as isize;
                if !(0..PARSING_SIDE as isize).contains(&local_x) || !(0..PARSING_SIDE as isize).contains(&local_y) { continue; }
                let mut label = 0usize;
                let mut confidence = f32::NEG_INFINITY;
                for class in 0..19 {
                    let value = logits[[0, class, local_y as usize, local_x as usize]];
                    if value > confidence { confidence = value; label = class; }
                }
                if matches!(label, 1 | 7 | 8 | 10 | 14) {
                    output[mask_y * MASK_SIDE + mask_x] = 255;
                }
            }
        }
    }
    Ok((output, accepted))
}

fn analyze(ffmpeg: &str, ffprobe: &str, image_path: &str, model_dir: &str) -> Result<NativeBeautyAnalysis, String> {
    let image = decode_image(ffmpeg, ffprobe, image_path)?;
    with_models(Path::new(model_dir), |models| {
        let detections = detect_faces(models, &image)?;
        let (mask, accepted) = parse_skin(models, &image, &detections)?;
        let mut faces = Vec::new();
        for detection in &accepted {
            let landmarks = detect_landmarks(models, &image, *detection)?;
            faces.push(compact_face(&landmarks, &image, *detection));
        }
        let has_skin = mask.iter().any(|value| *value != 0);
        Ok(NativeBeautyAnalysis {
            faces,
            skin_mask: if has_skin { base64::engine::general_purpose::STANDARD.encode(mask) } else { String::new() },
            skin_mask_width: if has_skin { MASK_SIDE as u32 } else { 0 },
            skin_mask_height: if has_skin { MASK_SIDE as u32 } else { 0 },
            analysis_version: ANALYSIS_VERSION,
        })
    })
}

pub struct BeautyAnalysisTask {
    ffmpeg_path: String,
    ffprobe_path: String,
    image_path: String,
    model_dir: String,
}

impl BeautyAnalysisTask {
    pub fn new(ffmpeg_path: String, ffprobe_path: String, image_path: String, model_dir: String) -> Self {
        Self { ffmpeg_path, ffprobe_path, image_path, model_dir }
    }
}

impl Task for BeautyAnalysisTask {
    type Output = NativeBeautyAnalysis;
    type JsValue = NativeBeautyAnalysis;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        analyze(&self.ffmpeg_path, &self.ffprobe_path, &self.image_path, &self.model_dir)
            .map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> { Ok(output) }
}
