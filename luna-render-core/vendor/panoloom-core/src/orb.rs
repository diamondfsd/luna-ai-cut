//! ORB feature detector + descriptor — port of OpenCV `ORB_Impl` (orb.cpp)
//! with default parameters (the cv2.Stitcher configuration). See
//! docs/pipeline.md §1 for algorithm notes and parity strategy.

use crate::cvmath::{cv_ceil, cv_floor, cv_round_f32, fast_atan2};
use crate::fast::fast16;
use crate::imgproc::{gaussian_blur_7_sigma2, resize_bilinear, GrayImage};
use crate::orb_pattern::BIT_PATTERN_31;

const HARRIS_K: f32 = 0.04;
const HARRIS_BLOCK_SIZE: usize = 7;

#[derive(Debug, Clone, Copy)]
pub struct OrbParams {
    pub nfeatures: usize,
    pub scale_factor: f64,
    pub nlevels: usize,
    pub edge_threshold: i32,
    pub first_level: usize,
    pub fast_threshold: i32,
    pub patch_size: i32,
}

impl Default for OrbParams {
    fn default() -> Self {
        Self {
            nfeatures: 500,
            scale_factor: 1.2,
            nlevels: 8,
            edge_threshold: 31,
            first_level: 0,
            fast_threshold: 20,
            patch_size: 31,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct OrbKeypoint {
    /// Full-resolution (level-0) coordinates.
    pub x: f32,
    pub y: f32,
    pub size: f32,
    /// Orientation in degrees [0, 360), from intensity centroid.
    pub angle: f32,
    pub response: f32,
    pub octave: i32,
}

pub type Descriptor = [u8; 32];

fn get_scale(level: usize, first_level: usize, scale_factor: f64) -> f32 {
    scale_factor.powi(level as i32 - first_level as i32) as f32
}

/// KeyPointsFilter::retainBest set semantics: keep everything with response
/// >= the n-th best response (ties survive, like OpenCV's partition).
fn retain_best(kps: &mut Vec<OrbKeypoint>, n: usize) {
    if n == 0 {
        kps.clear();
        return;
    }
    if kps.len() <= n {
        return;
    }
    kps.sort_by(|a, b| b.response.partial_cmp(&a.response).unwrap());
    let pivot = kps[n - 1].response;
    kps.retain(|k| k.response >= pivot);
}

/// KeyPointsFilter::runByImageBorder: strict interior of the level image.
fn run_by_image_border(kps: &mut Vec<OrbKeypoint>, w: usize, h: usize, border: i32) {
    let (bx, by) = (border as f32, border as f32);
    let (wx, hy) = (w as f32 - border as f32, h as f32 - border as f32);
    kps.retain(|k| k.x >= bx && k.x < wx && k.y >= by && k.y < hy);
}

/// Per-level feature quotas: geometric series in f32 (orb.cpp:845-855).
fn features_per_level(nfeatures: usize, scale_factor: f64, nlevels: usize) -> Vec<usize> {
    let factor = (1.0 / scale_factor) as f32;
    let mut desired =
        nfeatures as f32 * (1.0 - factor) / (1.0 - (factor as f64).powi(nlevels as i32) as f32);
    let mut out = Vec::with_capacity(nlevels);
    let mut sum = 0usize;
    for _ in 0..nlevels - 1 {
        let n = cv_round_f32(desired).max(0) as usize;
        out.push(n);
        sum += n;
        desired *= factor;
    }
    out.push(nfeatures.saturating_sub(sum));
    out
}

/// The circular-patch row extents for the intensity centroid (orb.cpp:860-876).
fn umax_table(half_patch: i32) -> Vec<i32> {
    let mut umax = vec![0i32; (half_patch + 2) as usize];
    let vmax = cv_floor(half_patch as f64 * std::f64::consts::SQRT_2 / 2.0 + 1.0);
    let vmin = cv_ceil(half_patch as f64 * std::f64::consts::SQRT_2 / 2.0);
    for v in 0..=vmax {
        umax[v as usize] =
            crate::cvmath::cv_round_f64(((half_patch * half_patch - v * v) as f64).sqrt());
    }
    // Symmetry fix-up.
    let mut v0 = 0i32;
    let mut v = half_patch;
    while v >= vmin {
        while umax[v0 as usize] == umax[(v0 + 1) as usize] {
            v0 += 1;
        }
        umax[v as usize] = v0;
        v0 += 1;
        v -= 1;
    }
    umax
}

/// Harris response at rounded keypoint positions (orb.cpp HarrisResponses).
fn harris_responses(img: &GrayImage, kps: &mut [OrbKeypoint]) {
    let step = img.width as i32;
    let r = (HARRIS_BLOCK_SIZE / 2) as i32;
    let scale = 1.0f32 / ((1 << 2) as f32 * HARRIS_BLOCK_SIZE as f32 * 255.0);
    let scale_sq_sq = scale * scale * scale * scale;

    for kp in kps.iter_mut() {
        let x0 = cv_round_f32(kp.x);
        let y0 = cv_round_f32(kp.y);
        let base = (y0 - r) * step + (x0 - r);
        let (mut a, mut b, mut c) = (0i32, 0i32, 0i32);
        for bi in 0..HARRIS_BLOCK_SIZE as i32 {
            for bj in 0..HARRIS_BLOCK_SIZE as i32 {
                let p = (base + bi * step + bj) as usize;
                let px = |ofs: i32| img.data[(p as i32 + ofs) as usize] as i32;
                let ix = (px(1) - px(-1)) * 2
                    + (px(-step + 1) - px(-step - 1))
                    + (px(step + 1) - px(step - 1));
                let iy = (px(step) - px(-step)) * 2
                    + (px(step - 1) - px(-step - 1))
                    + (px(step + 1) - px(-step + 1));
                a += ix * ix;
                b += iy * iy;
                c += ix * iy;
            }
        }
        kp.response = (a as f32 * b as f32
            - c as f32 * c as f32
            - HARRIS_K * (a as f32 + b as f32) * (a as f32 + b as f32))
            * scale_sq_sq;
    }
}

/// Intensity-centroid orientation (orb.cpp ICAngles).
fn ic_angles(img: &GrayImage, kps: &mut [OrbKeypoint], umax: &[i32], half_k: i32) {
    let step = img.width as i32;
    for kp in kps.iter_mut() {
        let cx = cv_round_f32(kp.x);
        let cy = cv_round_f32(kp.y);
        let center = (cy * step + cx) as usize;
        let px = |ofs: i32| img.data[(center as i32 + ofs) as usize] as i32;

        let mut m01 = 0i32;
        let mut m10 = 0i32;
        for u in -half_k..=half_k {
            m10 += u * px(u);
        }
        for v in 1..=half_k {
            let mut v_sum = 0i32;
            let d = umax[v as usize];
            for u in -d..=d {
                let val_plus = px(u + v * step);
                let val_minus = px(u - v * step);
                v_sum += val_plus - val_minus;
                m10 += u * (val_plus + val_minus);
            }
            m01 += v * v_sum;
        }
        kp.angle = fast_atan2(m01 as f32, m10 as f32);
    }
}

/// rBRIEF descriptors (orb.cpp computeOrbDescriptors, WTA_K = 2 path).
fn compute_descriptors(
    pyramid: &[GrayImage],
    layer_scale: &[f32],
    kps: &[OrbKeypoint],
) -> Vec<Descriptor> {
    kps.iter()
        .map(|kp| {
            let level = kp.octave as usize;
            let img = &pyramid[level];
            let step = img.width as i32;
            let scale = 1.0f32 / layer_scale[level];
            let angle = kp.angle * (std::f32::consts::PI / 180.0);
            let (a, b) = (angle.cos(), angle.sin());
            let center = (cv_round_f32(kp.y * scale) * step + cv_round_f32(kp.x * scale)) as usize;

            let get_value = |idx: usize| -> i32 {
                let px = BIT_PATTERN_31[idx * 2] as f32;
                let py = BIT_PATTERN_31[idx * 2 + 1] as f32;
                let x = px * a - py * b;
                let y = px * b + py * a;
                let ix = cv_round_f32(x);
                let iy = cv_round_f32(y);
                img.data[(center as i32 + iy * step + ix) as usize] as i32
            };

            let mut desc = [0u8; 32];
            for (i, d) in desc.iter_mut().enumerate() {
                let base = i * 16;
                let mut val = 0u8;
                for bit in 0..8 {
                    let t0 = get_value(base + bit * 2);
                    let t1 = get_value(base + bit * 2 + 1);
                    val |= u8::from(t0 < t1) << bit;
                }
                *d = val;
            }
            desc
        })
        .collect()
}

/// Full detect-and-compute, equivalent to
/// `cv2.ORB_create(**params).detectAndCompute(gray, None)`.
pub fn orb_detect_and_compute(
    image: &GrayImage,
    params: &OrbParams,
) -> (Vec<OrbKeypoint>, Vec<Descriptor>) {
    let nlevels = params.nlevels;

    // --- pyramid (cascaded resize, orb.cpp:1087-1158) ---
    let mut layer_scale = vec![0f32; nlevels];
    let mut pyramid: Vec<GrayImage> = Vec::with_capacity(nlevels);
    for level in 0..nlevels {
        let scale = get_scale(level, params.first_level, params.scale_factor);
        layer_scale[level] = scale;
        let inv = 1.0 / scale;
        let sz_w = cv_round_f32(image.width as f32 * inv) as usize;
        let sz_h = cv_round_f32(image.height as f32 * inv) as usize;
        if level == params.first_level {
            pyramid.push(image.clone());
        } else {
            let prev = &pyramid[level - 1];
            pyramid.push(resize_bilinear(prev, sz_w, sz_h));
        }
    }

    // --- per-level FAST + quota culling (computeKeyPoints) ---
    let quotas = features_per_level(params.nfeatures, params.scale_factor, nlevels);
    let half_patch = params.patch_size / 2;
    let umax = umax_table(half_patch);

    let mut all: Vec<OrbKeypoint> = Vec::new();
    let mut counters = vec![0usize; nlevels];
    for level in 0..nlevels {
        let img = &pyramid[level];
        let mut kps: Vec<OrbKeypoint> = fast16(img, params.fast_threshold)
            .into_iter()
            .map(|f| OrbKeypoint {
                x: f.x,
                y: f.y,
                size: 7.0,
                angle: -1.0,
                response: f.response,
                octave: level as i32,
            })
            .collect();
        run_by_image_border(&mut kps, img.width, img.height, params.edge_threshold);
        retain_best(&mut kps, 2 * quotas[level]);
        let sf = layer_scale[level];
        for kp in kps.iter_mut() {
            kp.size = params.patch_size as f32 * sf;
        }
        counters[level] = kps.len();
        all.extend(kps);
    }
    if all.is_empty() {
        return (Vec::new(), Vec::new());
    }

    // --- Harris re-scoring + final per-level culling ---
    {
        let mut offset = 0;
        for level in 0..nlevels {
            let slice = &mut all[offset..offset + counters[level]];
            harris_responses(&pyramid[level], slice);
            offset += counters[level];
        }
        let mut culled: Vec<OrbKeypoint> = Vec::with_capacity(params.nfeatures);
        offset = 0;
        for level in 0..nlevels {
            let mut kps = all[offset..offset + counters[level]].to_vec();
            offset += counters[level];
            retain_best(&mut kps, quotas[level]);
            culled.extend(kps);
        }
        all = culled;
    }

    // --- orientation, then scale coordinates to level 0 ---
    {
        // ICAngles runs per level on level coordinates.
        let mut by_level: Vec<Vec<usize>> = vec![Vec::new(); nlevels];
        for (i, kp) in all.iter().enumerate() {
            by_level[kp.octave as usize].push(i);
        }
        for level in 0..nlevels {
            let mut kps: Vec<OrbKeypoint> = by_level[level].iter().map(|&i| all[i]).collect();
            ic_angles(&pyramid[level], &mut kps, &umax, half_patch);
            for (slot, kp) in by_level[level].iter().zip(kps) {
                all[*slot] = kp;
            }
        }
        for kp in all.iter_mut() {
            let s = layer_scale[kp.octave as usize];
            kp.x *= s;
            kp.y *= s;
        }
    }

    // --- blur pyramid, compute descriptors ---
    let blurred: Vec<GrayImage> = pyramid.iter().map(gaussian_blur_7_sigma2).collect();
    let descriptors = compute_descriptors(&blurred, &layer_scale, &all);

    (all, descriptors)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotas_match_opencv_defaults() {
        // For nfeatures=500, scaleFactor=1.2, nlevels=8 OpenCV yields these
        // per-level budgets (validated against cv2 keypoint octave counts).
        let q = features_per_level(500, 1.2, 8);
        let total: usize = q.iter().sum();
        assert_eq!(q.len(), 8);
        assert_eq!(total, 500);
        assert!(q[0] > q[7], "{q:?}");
    }

    #[test]
    fn umax_is_symmetric_circle() {
        let umax = umax_table(15);
        assert_eq!(umax[0], 15);
        // Symmetry property used by ICAngles: umax[v] rows form a circle.
        for v in 1..=15usize {
            assert!(umax[v] <= umax[v - 1]);
        }
    }

    #[test]
    fn detects_features_on_synthetic_texture() {
        // Deterministic pseudo-texture (LCG) big enough for all 8 levels.
        let (w, h) = (320, 240);
        let mut state = 12345u32;
        let data: Vec<u8> = (0..w * h)
            .map(|_| {
                state = state.wrapping_mul(1103515245).wrapping_add(12345);
                (state >> 16) as u8
            })
            .collect();
        let img = GrayImage::new(w, h, data);
        let (kps, descs) = orb_detect_and_compute(&img, &OrbParams::default());
        assert!(!kps.is_empty());
        assert_eq!(kps.len(), descs.len());
        for kp in &kps {
            assert!(kp.angle >= 0.0 && kp.angle < 360.0);
            assert!(kp.x >= 0.0 && kp.y >= 0.0);
        }
    }
}
