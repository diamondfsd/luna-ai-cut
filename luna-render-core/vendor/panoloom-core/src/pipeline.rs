//! High-level stitching pipeline: the staged engine the app drives.
//!
//! Mirrors cv::Stitcher PANORAMA-mode orchestration (docs/pipeline.md §0)
//! over the ported stages. Inputs arrive as registration-scale RGB images
//! (the browser decodes + downscales); seam-scale copies are derived here.

#![allow(clippy::needless_range_loop)]

use crate::blend::{num_bands_for, result_roi, MultiBandBlender};
use crate::bundle::bundle_adjust_ray;
use crate::camera::CameraParams;
use crate::estimation::{
    homography_based_estimate, leave_biggest_component, warped_image_scale, wave_correct_horiz,
    FeatureSet, MatchGraph,
};
use crate::exposure::{BlocksGainCompensator, RgbImage};
use crate::imgproc::{rgb_to_gray_cv, GrayImage};
use crate::matcher::match_pair;
use crate::orb::{orb_detect_and_compute, OrbParams};
use crate::seam::find_seams_graph_cut_color;
use crate::warp::{Border, Interp, PixelImage, SphericalWarper};

/// Seam-estimation area relative to the registration area. The stitcher
/// uses absolute megapixels (0.6 / 0.1); inputs here are already at
/// registration scale, so the seam scale is the ratio sqrt(0.1/0.6).
const SEAM_FROM_WORK_SCALE: f64 = 0.408_248_290_463_863; // sqrt(1/6)

pub struct SourceImage {
    pub id: u32,
    /// Registration-scale RGB pixels.
    pub rgb: PixelImage,
    /// Optional shooting-rig pose prior (yaw, pitch, roll in degrees, e.g.
    /// DJI `drone-dji:Gimbal*Degree` XMP). Used to RESCUE images that have
    /// too few features to match (blank sky): after the feature-based
    /// solve, unmatched images with a prior are placed via the best-fit
    /// rotation between the prior frame and the solved frame.
    pub pose_prior: Option<[f64; 3]>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignedImage {
    pub id: u32,
    pub camera: CameraParams,
    /// True when placed from a pose prior rather than feature matches.
    pub rescued: bool,
}

/// Serializable (serde_json round-trips every float exactly, so a saved
/// project restores the alignment bit-for-bit).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alignment {
    pub images: Vec<AlignedImage>,
    /// ids that could not be matched into the panorama (and had no prior).
    pub dropped: Vec<u32>,
    pub warped_image_scale: f64,
    /// Shared lens distortion (all shots assumed same lens); zero until
    /// the control-point optimizer fits it. `default` keeps old projects
    /// loading.
    #[serde(default)]
    pub lens: crate::lens::LensParams,
}

/// Announces the stage to any installed [`crate::progress`] hook, then runs
/// it. Natively it also prints the duration to stderr when PANOLOOM_TIMING is
/// set (`Instant` is unavailable on wasm32-unknown-unknown).
macro_rules! stage_timed {
    ($label:expr, $body:expr) => {{
        crate::progress::stage($label);
        #[cfg(not(target_arch = "wasm32"))]
        let t0 = std::time::Instant::now();
        let out = $body;
        #[cfg(not(target_arch = "wasm32"))]
        if std::env::var_os("PANOLOOM_TIMING").is_some() {
            eprintln!(
                "[timing] {}: {:.0}ms",
                $label,
                t0.elapsed().as_secs_f64() * 1e3
            );
        }
        out
    }};
}

/// Rotate the whole panorama: left-multiply every camera rotation by the
/// pano-frame rotation `r_g` (same structure as the orientation fix and
/// wave correction). Content at direction d moves to r_g·d.
pub fn orient_alignment(alignment: &mut Alignment, r_g: &[[f64; 3]; 3]) {
    for ai in alignment.images.iter_mut() {
        let old = ai.camera.r;
        let mut r = [[0.0f32; 3]; 3];
        for a in 0..3 {
            for b in 0..3 {
                r[a][b] = (r_g[a][0] * old[0][b] as f64
                    + r_g[a][1] * old[1][b] as f64
                    + r_g[a][2] * old[2][b] as f64) as f32;
            }
        }
        ai.camera.r = r;
    }
}

/// Full registration: features → matching → biggest component →
/// estimation → bundle adjustment → wave correction.
pub fn align(sources: &[SourceImage]) -> Result<Alignment, String> {
    let mut pairs = Vec::new();
    for i in 0..sources.len() {
        for j in (i + 1)..sources.len() {
            pairs.push((i, j));
        }
    }
    align_with_pairs(sources, pairs)
}

/// Aligns a row-major spherical grid using only the image pairs that can
/// overlap by capture geometry: horizontal, vertical, diagonal and wrap seam.
pub fn align_grid_neighbors(
    sources: &[SourceImage],
    rows: usize,
    columns: usize,
) -> Result<Alignment, String> {
    if rows == 0 || columns == 0 || rows.checked_mul(columns) != Some(sources.len()) {
        return Err("grid dimensions do not match source images".into());
    }
    let pairs = grid_neighbor_pairs(rows, columns);
    align_with_pairs(sources, pairs.into_iter().collect())
}

/// Aligns a 3-by-6 spherical ring grid plus one zenith image. The final
/// source is paired with every image in the upper ring to connect its cap.
pub fn align_grid_neighbors_with_zenith(
    sources: &[SourceImage],
    rows: usize,
    columns: usize,
) -> Result<Alignment, String> {
    let ring_count = rows.checked_mul(columns);
    if rows == 0 || columns == 0 || ring_count != Some(sources.len().saturating_sub(1)) {
        return Err("zenith grid dimensions do not match source images".into());
    }
    let mut pairs = grid_neighbor_pairs(rows, columns);
    let zenith = sources.len() - 1;
    for column in 0..columns {
        pairs.insert((column, zenith));
    }
    align_with_pairs(sources, pairs.into_iter().collect())
}

/// Match only potentially overlapping views using their capture poses.
/// Angles are approximate priors: every accepted connection still requires
/// image features and geometric verification in `align_with_pairs`.
pub fn align_pose_neighbors(sources: &[SourceImage]) -> Result<Alignment, String> {
    if sources.iter().any(|source| source.pose_prior.is_none()) {
        return Err("all panorama photos require capture positions".into());
    }
    let mut pairs = Vec::new();
    for i in 0..sources.len() {
        let a = sources[i].pose_prior.expect("checked above");
        for j in i + 1..sources.len() {
            let b = sources[j].pose_prior.expect("checked above");
            let a_zenith = a[1] >= 85.0;
            let b_zenith = b[1] >= 85.0;
            let candidate = if a_zenith || b_zenith {
                if a_zenith {
                    b[1] >= 20.0
                } else {
                    a[1] >= 20.0
                }
            } else {
                let yaw_delta = (a[0] - b[0] + 180.0).rem_euclid(360.0) - 180.0;
                let a_pitch = a[1].to_radians();
                let b_pitch = b[1].to_radians();
                let cosine = a_pitch.sin() * b_pitch.sin()
                    + a_pitch.cos() * b_pitch.cos() * yaw_delta.to_radians().cos();
                (a[1] - b[1]).abs() <= 65.0 && cosine >= 88.0_f64.to_radians().cos()
            };
            if candidate {
                pairs.push((i, j));
            }
        }
    }
    align_with_pairs(sources, pairs)
}

fn grid_neighbor_pairs(rows: usize, columns: usize) -> std::collections::BTreeSet<(usize, usize)> {
    let mut pairs = std::collections::BTreeSet::new();
    let mut add = |a: usize, b: usize| {
        if a != b {
            pairs.insert((a.min(b), a.max(b)));
        }
    };
    for row in 0..rows {
        for column in 0..columns {
            let current = row * columns + column;
            add(current, row * columns + (column + 1) % columns);
            if row + 1 < rows {
                add(current, (row + 1) * columns + column);
                add(current, (row + 1) * columns + (column + 1) % columns);
                add(
                    current,
                    (row + 1) * columns + (column + columns - 1) % columns,
                );
            }
        }
    }
    pairs
}

fn align_with_pairs(
    sources: &[SourceImage],
    pair_ids: Vec<(usize, usize)>,
) -> Result<Alignment, String> {
    if sources.len() < 2 {
        return Err("need at least two images".into());
    }
    let n = sources.len();

    let detected = stage_timed!(
        "orb-detect",
        crate::par::map(sources, |s| {
            let gray = rgb_to_gray_cv(&s.rgb.data, s.rgb.width, s.rgb.height);
            let (kps, d) = orb_detect_and_compute(&gray, &OrbParams::default());
            let pts: Vec<[f32; 2]> = kps.iter().map(|k| [k.x, k.y]).collect();
            (pts, d, (s.rgb.width as u32, s.rgb.height as u32))
        })
    );
    let mut pts: Vec<Vec<[f32; 2]>> = Vec::with_capacity(n);
    let mut descs = Vec::with_capacity(n);
    let mut sizes = Vec::with_capacity(n);
    for (p, d, s) in detected {
        pts.push(p);
        descs.push(d);
        sizes.push(s);
    }

    let upper = stage_timed!(
        "match-pairs",
        crate::par::map(&pair_ids, |&(i, j)| {
            (
                (i, j),
                match_pair(&pts[i], &descs[i], sizes[i], &pts[j], &descs[j], sizes[j]),
            )
        })
    );
    let graph = MatchGraph::from_upper_triangle(n, upper);

    let kept = leave_biggest_component(&graph, 1.0);
    if kept.len() < 2 {
        return Err("images do not overlap enough to align".into());
    }
    let dropped: Vec<u32> = (0..n)
        .filter(|i| !kept.contains(i))
        .map(|i| sources[i].id)
        .collect();

    // Subset when needed (rebuild a dense graph over the kept indices).
    let (features, graph, kept): (Vec<FeatureSet>, MatchGraph, Vec<usize>) = if kept.len() == n {
        let features = (0..n)
            .map(|i| FeatureSet {
                width: sizes[i].0,
                height: sizes[i].1,
                keypoints: pts[i].clone(),
            })
            .collect();
        (features, graph, kept)
    } else {
        let m = kept.len();
        let features = kept
            .iter()
            .map(|&i| FeatureSet {
                width: sizes[i].0,
                height: sizes[i].1,
                keypoints: pts[i].clone(),
            })
            .collect();
        let mut sub_upper = Vec::new();
        for a in 0..m {
            for b in (a + 1)..m {
                sub_upper.push(((a, b), graph.at(kept[a], kept[b]).clone()));
            }
        }
        (
            features,
            MatchGraph::from_upper_triangle(m, sub_upper),
            kept,
        )
    };

    let mut cameras = stage_timed!("estimate", homography_based_estimate(&features, &graph));

    // Seed the rotations from the shooting rig's own pose when every kept
    // image carries one. The homography chain derives rotations by walking
    // a spanning tree of pairwise estimates, so error accumulates along the
    // walk; the gimbal reports each shot's pose absolutely and independently
    // (the DJI priors fit solved cameras at 0.81 deg median). Focals still
    // come from the estimate — priors say nothing about them — and bundle
    // adjustment still refines everything against image content. This only
    // moves the starting point.
    if kept.iter().all(|&i| sources[i].pose_prior.is_some()) {
        for (cam, &i) in cameras.iter_mut().zip(&kept) {
            let r = prior_rotation(sources[i].pose_prior.expect("checked above"));
            for a in 0..3 {
                for b in 0..3 {
                    cam.r[a][b] = r[a][b] as f32;
                }
            }
        }
    }

    if !stage_timed!(
        "bundle-adjust",
        bundle_adjust_ray(&features, &graph, &mut cameras)
    ) {
        return Err("bundle adjustment failed".into());
    }
    let mut rmats: Vec<[[f32; 3]; 3]> = cameras.iter().map(|c| c.r).collect();
    wave_correct_horiz(&mut rmats);
    for (c, r) in cameras.iter_mut().zip(&rmats) {
        c.r = *r;
    }

    let scale = warped_image_scale(&cameras);
    let mut images: Vec<AlignedImage> = kept
        .iter()
        .zip(cameras)
        .map(|(&i, camera)| AlignedImage {
            id: sources[i].id,
            camera,
            rescued: false,
        })
        .collect();

    // Pose-prior rescue: place unmatched images that carry a shooting-rig
    // pose (blank-sky shots in DJI sphere sets, etc.).
    let offset = fit_prior_offset(sources, &images);
    let mut still_dropped = Vec::new();
    let rescuable: Vec<&SourceImage> = sources.iter().filter(|s| dropped.contains(&s.id)).collect();
    if !rescuable.is_empty() {
        for s in rescuable {
            match (s.pose_prior, offset) {
                (Some(prior), Some(off)) => {
                    let r = mat3_mul_f64(&off, &prior_rotation(prior));
                    let mut cam = CameraParams {
                        focal: scale,
                        ..Default::default()
                    };
                    cam.ppx = 0.5 * s.rgb.width as f64;
                    cam.ppy = 0.5 * s.rgb.height as f64;
                    for a in 0..3 {
                        for b in 0..3 {
                            cam.r[a][b] = r[a][b] as f32;
                        }
                    }
                    images.push(AlignedImage {
                        id: s.id,
                        camera: cam,
                        rescued: true,
                    });
                }
                _ => still_dropped.push(s.id),
            }
        }
    }

    // Orientation fix: waveCorrect has a global 180° ambiguity (panos can
    // come out upside down). When pose priors exist, they define earth-up
    // authoritatively: if the fitted offset maps earth-up to pano-down,
    // roll the whole panorama 180° (Rz(pi), a pure rotation).
    if let Some(off) = offset {
        // Earth up in the prior frame is -y (y points down); mapped up's y
        // component > 0 means it points DOWN in the pano frame.
        let mapped_up_y = -off[1][1];
        if mapped_up_y > 0.0 {
            for ai in images.iter_mut() {
                let mut r = [[0.0f32; 3]; 3];
                for b in 0..3 {
                    // Rz(pi) · R: negate the first two rows.
                    r[0][b] = -ai.camera.r[0][b];
                    r[1][b] = -ai.camera.r[1][b];
                    r[2][b] = ai.camera.r[2][b];
                }
                ai.camera.r = r;
            }
        }
    }

    Ok(Alignment {
        images,
        dropped: still_dropped,
        warped_image_scale: scale,
        lens: crate::lens::LensParams::default(),
    })
}

type Mat3d = [[f64; 3]; 3];

fn mat3_mul_f64(a: &Mat3d, b: &Mat3d) -> Mat3d {
    let mut o = [[0.0; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            for k in 0..3 {
                o[r][c] += a[r][k] * b[k][c];
            }
        }
    }
    o
}

/// Rig pose (yaw, pitch, roll degrees, earth-referenced like DJI gimbal
/// values) to a pano<-camera rotation in our convention (y down, +pitch up):
/// R = Ry(yaw) · Rx(-pitch) · Rz(roll).
fn prior_rotation(p: [f64; 3]) -> Mat3d {
    let (y, pi, r) = (p[0].to_radians(), (-p[1]).to_radians(), p[2].to_radians());
    let ry = [
        [y.cos(), 0.0, y.sin()],
        [0.0, 1.0, 0.0],
        [-y.sin(), 0.0, y.cos()],
    ];
    let rx = [
        [1.0, 0.0, 0.0],
        [0.0, pi.cos(), -pi.sin()],
        [0.0, pi.sin(), pi.cos()],
    ];
    let rz = [
        [r.cos(), -r.sin(), 0.0],
        [r.sin(), r.cos(), 0.0],
        [0.0, 0.0, 1.0],
    ];
    mat3_mul_f64(&mat3_mul_f64(&ry, &rx), &rz)
}

/// Wahba/Kabsch fit of the single rotation `off` minimizing
/// Σ angle(off · R_prior_i, R_solved_i) over the feature-solved cameras
/// that carry priors. Returns None when fewer than 2 anchors exist or the
/// fit is poor (median residual > 8°, i.e. the priors are untrustworthy).
fn fit_prior_offset(sources: &[SourceImage], solved: &[AlignedImage]) -> Option<Mat3d> {
    use nalgebra::Matrix3;

    let mut m = Matrix3::<f64>::zeros();
    let mut anchors = Vec::new();
    for ai in solved {
        let src = sources.iter().find(|s| s.id == ai.id)?;
        let Some(prior) = src.pose_prior else {
            continue;
        };
        let rp = prior_rotation(prior);
        let mut rs = [[0.0f64; 3]; 3];
        for a in 0..3 {
            for b in 0..3 {
                rs[a][b] = ai.camera.r[a][b] as f64;
            }
        }
        // M += R_solved · R_priorᵀ
        for a in 0..3 {
            for b in 0..3 {
                let mut acc = 0.0;
                for k in 0..3 {
                    acc += rs[a][k] * rp[b][k];
                }
                m[(a, b)] += acc;
            }
        }
        anchors.push((rp, rs));
    }
    if anchors.len() < 2 {
        return None;
    }

    let svd = m.svd(true, true);
    let (u, v_t) = (svd.u?, svd.v_t?);
    let d = (u * v_t).determinant();
    let correction = Matrix3::from_diagonal(&nalgebra::Vector3::new(1.0, 1.0, d.signum()));
    let off_m = u * correction * v_t;
    let mut off = [[0.0f64; 3]; 3];
    for a in 0..3 {
        for b in 0..3 {
            off[a][b] = off_m[(a, b)];
        }
    }

    // Residual check: reject unusable priors.
    let mut residuals: Vec<f64> = anchors
        .iter()
        .map(|(rp, rs)| {
            let pred = mat3_mul_f64(&off, rp);
            let mut tr = 0.0;
            for a in 0..3 {
                for k in 0..3 {
                    tr += pred[a][k] * rs[a][k];
                }
            }
            (((tr - 1.0) / 2.0).clamp(-1.0, 1.0)).acos().to_degrees()
        })
        .collect();
    residuals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = residuals[residuals.len() / 2];
    if median > 8.0 {
        return None;
    }
    Some(off)
}

/// Diagnostic helper: median Wahba residual of a prior set against solved
/// cameras, ignoring the acceptance threshold. For convention probing.
pub fn debug_prior_fit_residual(sources: &[SourceImage], solved: &[AlignedImage]) -> Option<f64> {
    use nalgebra::Matrix3;
    let mut m = Matrix3::<f64>::zeros();
    let mut anchors = Vec::new();
    for ai in solved.iter().filter(|a| !a.rescued) {
        let src = sources.iter().find(|s| s.id == ai.id)?;
        let Some(prior) = src.pose_prior else {
            continue;
        };
        let rp = prior_rotation(prior);
        let mut rs = [[0.0f64; 3]; 3];
        for a in 0..3 {
            for b in 0..3 {
                rs[a][b] = ai.camera.r[a][b] as f64;
            }
        }
        for a in 0..3 {
            for b in 0..3 {
                let mut acc = 0.0;
                for k in 0..3 {
                    acc += rs[a][k] * rp[b][k];
                }
                m[(a, b)] += acc;
            }
        }
        anchors.push((rp, rs));
    }
    if anchors.len() < 2 {
        return None;
    }
    let svd = m.svd(true, true);
    let (u, v_t) = (svd.u?, svd.v_t?);
    let d = (u * v_t).determinant();
    let corr = Matrix3::from_diagonal(&nalgebra::Vector3::new(1.0, 1.0, d.signum()));
    let off_m = u * corr * v_t;
    let mut off = [[0.0f64; 3]; 3];
    for a in 0..3 {
        for b in 0..3 {
            off[a][b] = off_m[(a, b)];
        }
    }
    let mut residuals: Vec<f64> = anchors
        .iter()
        .map(|(rp, rs)| {
            let pred = mat3_mul_f64(&off, rp);
            let mut tr = 0.0;
            for a in 0..3 {
                for k in 0..3 {
                    tr += pred[a][k] * rs[a][k];
                }
            }
            (((tr - 1.0) / 2.0).clamp(-1.0, 1.0)).acos().to_degrees()
        })
        .collect();
    residuals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Some(residuals[residuals.len() / 2])
}

/// Snaps a warp scale so one full 360° period is an EXACT (even) integer
/// number of pixels: wrap folding and the 2:1 canvas are then exact,
/// eliminating sub-pixel shear at the meridian.
pub(crate) fn snap_scale(s: f64) -> f64 {
    let w = ((2.0 * std::f64::consts::PI * s).floor() as usize) & !1;
    w as f64 / (2.0 * std::f64::consts::PI)
}

/// K matrix for a camera whose focal/pp are scaled by `m` (f32, like the
/// oracle's numpy path).
pub(crate) fn camera_k_scaled(c: &CameraParams, m: f64) -> [[f32; 3]; 3] {
    [
        [(c.focal * m) as f32, 0.0, (c.ppx * m) as f32],
        [0.0, (c.focal * m) as f32, (c.ppy * m) as f32],
        [0.0, 0.0, 1.0],
    ]
}

/// Output of the seam-scale stage shared by preview and export: gains fed
/// from the original layout, graph-cut seams computed over the UNROLLED
/// layout (wrap-crossing images duplicated one period right).
/// Gains and graph-cut seams, computed at seam scale.
///
/// Public because it is expensive — minutes on a large set — and identical
/// for a given (sources, alignment, masks). A caller that renders a preview
/// and then exports would otherwise pay for it twice; both entry points
/// accept one that has already been computed.
pub struct SeamStage {
    /// (source/aligned index, duplicated one period to the right?)
    pub entries: Vec<(usize, bool)>,
    pub compensator: BlocksGainCompensator,
    pub e_seam_masks: Vec<GrayImage>,
}

/// User paint-mask values (registration-scale, one byte per pixel).
pub const MASK_EXCLUDE: u8 = 1;
pub const MASK_PREFER: u8 = 2;

pub fn seam_stage(
    sources: &[&PixelImage],
    alignment: &Alignment,
    user_masks: &[Option<&GrayImage>],
) -> SeamStage {
    let n = alignment.images.len();
    let seam_scale = snap_scale(alignment.warped_image_scale * SEAM_FROM_WORK_SCALE);
    let seam_mul = seam_scale / alignment.warped_image_scale;

    let inputs: Vec<(usize, &PixelImage, &AlignedImage)> = sources
        .iter()
        .zip(&alignment.images)
        .enumerate()
        .map(|(i, (src, ai))| (i, *src, ai))
        .collect();
    let warped = crate::par::map(&inputs, |&(i, src, ai)| {
        let mut seam_warper = SphericalWarper::new(seam_scale as f32);
        let (sw, sh) = (
            ((src.width as f64) * seam_mul).round().max(2.0) as usize,
            ((src.height as f64) * seam_mul).round().max(2.0) as usize,
        );
        let small = resize_rgb(src, sw, sh);
        let k = camera_k_scaled(&ai.camera, seam_mul);
        seam_warper.set_lens(
            alignment.lens,
            k[0][2] as f64,
            k[1][2] as f64,
            sw as f64,
            sh as f64,
        );
        let (tl, w_img) =
            seam_warper.warp(&small, &k, &ai.camera.r, Interp::Linear, Border::Reflect);
        let mask_src = PixelImage::new(sw, sh, 1, vec![255u8; sw * sh]);
        let (_, w_mask) = seam_warper.warp(
            &mask_src,
            &k,
            &ai.camera.r,
            Interp::Nearest,
            Border::Constant0,
        );
        // Warp the user paint mask through the identical geometry so its
        // labels land on the same seam-scale grid as the coverage mask.
        let w_user = user_masks.get(i).copied().flatten().map(|um| {
            let small_um = resize_nearest_gray(um, sw, sh);
            let src_um = PixelImage::new(sw, sh, 1, small_um.data);
            let (_, w) = seam_warper.warp(
                &src_um,
                &k,
                &ai.camera.r,
                Interp::Nearest,
                Border::Constant0,
            );
            GrayImage::new(w.width, w.height, w.data)
        });
        (
            tl,
            w_img,
            GrayImage::new(w_mask.width, w_mask.height, w_mask.data),
            w_user,
        )
    });
    let mut s_corners = Vec::with_capacity(n);
    let mut s_imgs: Vec<PixelImage> = Vec::with_capacity(n);
    let mut s_masks: Vec<GrayImage> = Vec::with_capacity(n);
    let mut s_user: Vec<Option<GrayImage>> = Vec::with_capacity(n);
    for (tl, w_img, w_mask, w_user) in warped {
        s_corners.push(tl);
        s_imgs.push(w_img);
        s_masks.push(w_mask);
        s_user.push(w_user);
    }
    apply_user_masks(&mut s_masks, &s_user, &s_corners);
    // Rescued shots fill holes only (see suppress_rescued_masks).
    suppress_rescued_masks(&mut s_masks, &s_corners, alignment, 2);

    let s_rgb: Vec<RgbImage> = s_imgs
        .iter()
        .map(|w| RgbImage::new(w.width, w.height, w.data.clone()))
        .collect();
    let compensator = BlocksGainCompensator::feed(&s_corners, &s_rgb, &s_masks);

    // Wrap unrolling: duplicate left-end images one period right so seams
    // and blending continue across the 360° boundary.
    let s_sizes: Vec<(i32, i32)> = s_imgs
        .iter()
        .map(|w| (w.width as i32, w.height as i32))
        .collect();
    let period_seam = (2.0 * std::f64::consts::PI * seam_scale).floor() as i32;
    let orig_strip = result_roi(&s_corners, &s_sizes);
    let full_wrap = orig_strip.2 as i32 >= period_seam - 2;
    let max_w_seam = s_sizes.iter().map(|s| s.0).max().unwrap_or(0);
    let mut entries: Vec<(usize, bool)> = (0..n).map(|i| (i, false)).collect();
    if full_wrap {
        for i in 0..n {
            if s_corners[i].0 - orig_strip.0 < max_w_seam {
                entries.push((i, true));
            }
        }
    }

    let e_imgs: Vec<PixelImage> = entries.iter().map(|&(i, _)| s_imgs[i].clone()).collect();
    let e_corners: Vec<(i32, i32)> = entries
        .iter()
        .map(|&(i, dup)| {
            (
                s_corners[i].0 + if dup { period_seam } else { 0 },
                s_corners[i].1,
            )
        })
        .collect();
    let mut e_seam_masks: Vec<GrayImage> =
        entries.iter().map(|&(i, _)| s_masks[i].clone()).collect();
    stage_timed!(
        "graph-cut-seams",
        find_seams_graph_cut_color(&e_imgs, &e_corners, &mut e_seam_masks)
    );

    SeamStage {
        entries,
        compensator,
        e_seam_masks,
    }
}

pub struct Preview {
    /// Full 360x180 equirectangular RGBA canvas (uncovered pixels alpha 0).
    pub rgba: Vec<u8>,
    pub width: usize,
    pub height: usize,
}

/// Renders a blended preview onto a FULL equirectangular canvas so a 360°
/// viewer can consume it directly. `sources` must correspond 1:1 with
/// `alignment.images` (already subset by the caller via ids).
///
/// `cached_stage` is a [`SeamStage`] already computed for exactly these
/// inputs, or None to compute one. A mismatched stage yields a wrong
/// panorama, so a caller that caches must key it on the inputs rather than
/// on remembering to invalidate.
pub fn render_preview(
    sources: &[&PixelImage],
    alignment: &Alignment,
    user_masks: &[Option<&GrayImage>],
    max_width: usize,
    cached_stage: Option<&SeamStage>,
) -> Result<Preview, String> {
    let n = alignment.images.len();
    if sources.len() != n {
        return Err("sources/alignment mismatch".into());
    }

    // Two-stage compose, mirroring the stitcher: gains + graph-cut seams at
    // SEAM scale (cheap), composite at REGISTRATION scale (sharp), capped
    // so the full 360° canvas stays <= max_width.
    let full_width_at = |s: f64| (2.0 * std::f64::consts::PI * s).ceil() as usize;
    let compose_scale = if full_width_at(alignment.warped_image_scale) > max_width {
        max_width as f64 / (2.0 * std::f64::consts::PI)
    } else {
        alignment.warped_image_scale
    };
    let compose_scale = snap_scale(compose_scale);

    let computed;
    let stage = match cached_stage {
        Some(s) => s,
        None => {
            computed = stage_timed!("seam-stage", seam_stage(sources, alignment, user_masks));
            &computed
        }
    };
    let (entries, compensator, e_seam_masks) =
        (&stage.entries, &stage.compensator, &stage.e_seam_masks);

    // --- stage 2: compose scale — warp sharp, apply gains, blend ---
    let k_for = camera_k_scaled;
    let compose_mul = compose_scale / alignment.warped_image_scale;
    let period_comp = (2.0 * std::f64::consts::PI * compose_scale).floor() as i32;
    let comp_inputs: Vec<(usize, &PixelImage, &AlignedImage)> = sources
        .iter()
        .zip(&alignment.images)
        .enumerate()
        .map(|(i, (src, ai))| (i, *src, ai))
        .collect();
    let composed = stage_timed!(
        "compose-warp",
        crate::par::map(&comp_inputs, |&(i, src, ai)| {
            let mut warper = SphericalWarper::new(compose_scale as f32);
            let (sw, sh) = (
                ((src.width as f64) * compose_mul).round().max(2.0) as usize,
                ((src.height as f64) * compose_mul).round().max(2.0) as usize,
            );
            let scaled = if (compose_mul - 1.0).abs() < 1e-9 {
                src.clone()
            } else {
                resize_rgb(src, sw, sh)
            };
            let k = k_for(&ai.camera, compose_mul);
            warper.set_lens(
                alignment.lens,
                k[0][2] as f64,
                k[1][2] as f64,
                scaled.width as f64,
                scaled.height as f64,
            );
            let (tl, w_img) =
                warper.warp(&scaled, &k, &ai.camera.r, Interp::Linear, Border::Reflect);
            let mask_src = PixelImage::new(
                scaled.width,
                scaled.height,
                1,
                vec![255u8; scaled.width * scaled.height],
            );
            let (_, w_mask) = warper.warp(
                &mask_src,
                &k,
                &ai.camera.r,
                Interp::Nearest,
                Border::Constant0,
            );
            let mut rgb = RgbImage::new(w_img.width, w_img.height, w_img.data);
            compensator.apply(i, &mut rgb);
            (
                tl,
                rgb,
                GrayImage::new(w_mask.width, w_mask.height, w_mask.data),
            )
        })
    );
    let mut comp_corners: Vec<(i32, i32)> = Vec::with_capacity(n);
    let mut comp_rgb: Vec<RgbImage> = Vec::with_capacity(n);
    let mut comp_cov: Vec<GrayImage> = Vec::with_capacity(n);
    for (tl, rgb, cov) in composed {
        comp_corners.push(tl);
        comp_rgb.push(rgb);
        comp_cov.push(cov);
    }

    // Feed every layout entry with ITS OWN seam mask, duplicates offset by
    // one compose-scale period.
    let e_comp_corners: Vec<(i32, i32)> = entries
        .iter()
        .map(|&(i, dup)| {
            (
                comp_corners[i].0 + if dup { period_comp } else { 0 },
                comp_corners[i].1,
            )
        })
        .collect();
    let e_sizes: Vec<(i32, i32)> = entries
        .iter()
        .map(|&(i, _)| (comp_rgb[i].width as i32, comp_rgb[i].height as i32))
        .collect();
    let roi = result_roi(&e_comp_corners, &e_sizes);
    let bands = num_bands_for(roi.2, roi.3);
    let mut blender = MultiBandBlender::new(bands);
    blender.prepare(roi.0, roi.1, roi.2, roi.3);
    stage_timed!("blend-feed", {
        for (e, &(i, _)) in entries.iter().enumerate() {
            let cov = &comp_cov[i];
            let dilated = dilate3(&e_seam_masks[e]);
            let up = crate::imgproc::resize_bilinear(&dilated, cov.width, cov.height);
            let mut final_mask = vec![0u8; cov.width * cov.height];
            for p in 0..final_mask.len() {
                final_mask[p] = up.data[p] & cov.data[p];
            }
            blender.feed(
                &comp_rgb[i].data,
                comp_rgb[i].width,
                comp_rgb[i].height,
                &GrayImage::new(cov.width, cov.height, final_mask),
                e_comp_corners[e],
            );
        }
    });
    let (blended, coverage) = stage_timed!("blend", blender.blend());
    let scale = compose_scale;

    // Strip ranges for the two-pass paste: the unrolled extension starts
    // where the FIRST duplicate begins (its overlap with right-end
    // originals is the true cross-wrap blend); its tail (the duplicates'
    // own coverage boundary) is trimmed — the original strip covers those
    // canvas columns instead.
    let originals_end: i32 = (0..n)
        .map(|i| comp_corners[i].0 + comp_rgb[i].width as i32)
        .max()
        .unwrap()
        - roi.0;
    let ext_start: i32 = entries
        .iter()
        .enumerate()
        .filter(|(_, &(_, dup))| dup)
        .map(|(e, _)| e_comp_corners[e].0 - roi.0)
        .min()
        .unwrap_or(roi.2 as i32);
    let ext_len = roi.2 as i32 - ext_start;
    let ext_trim = 64.min(ext_len / 2).max(0);

    // Paste onto the full equirect canvas. In warp coordinates the full
    // sphere spans u in [-pi*scale, pi*scale), v in [0, pi*scale].
    // Canvas width uses FLOOR: a full-360 ROI spans 2*trunc(pi*s)+1 >=
    // floor(2*pi*s) columns, so every canvas column is covered (extras
    // wrap-fold); ceil left a one-pixel black hairline at the wrap seam.
    // EXACTLY 2:1 — 360° viewers pad non-2:1 equirects onto a 2:1 canvas
    // with black bars, which materialize as a hairline at the wrap.
    let canvas_w = ((2.0 * std::f64::consts::PI * scale).floor() as usize) & !1;
    let canvas_h = canvas_w / 2;
    let mut rgba = vec![0u8; canvas_w * canvas_h * 4];
    let off_x = (-std::f64::consts::PI * scale) as i32;

    // Two-pass paste, first write wins. Pass 1 is the unrolled EXTENSION
    // (minus its trimmed tail): those columns were blended with true
    // cross-wrap neighbors, so they replace the artifact-prone outer
    // columns of the original strip at the meridian. Pass 2 fills the rest.
    let paste = |x0: i32, x1: i32, rgba: &mut Vec<u8>| {
        let (x0, x1) = (x0.max(0) as usize, x1.max(0) as usize);
        for y in 0..roi.3 {
            let cy = roi.1 + y as i32; // canvas v origin = warp v=0
            if cy < 0 || cy >= canvas_h as i32 {
                continue;
            }
            for x in x0..x1.min(roi.2) {
                let mut cx = roi.0 - off_x + x as i32;
                let w = canvas_w as i32;
                cx = ((cx % w) + w) % w;
                if coverage.data[y * roi.2 + x] == 0 {
                    continue;
                }
                let dst = (cy as usize * canvas_w + cx as usize) * 4;
                if rgba[dst + 3] != 0 {
                    continue;
                }
                let src = (y * roi.2 + x) * 3;
                rgba[dst] = blended[src];
                rgba[dst + 1] = blended[src + 1];
                rgba[dst + 2] = blended[src + 2];
                rgba[dst + 3] = 255;
            }
        }
    };
    if ext_len > 0 {
        paste(ext_start, roi.2 as i32 - ext_trim, &mut rgba);
    }
    paste(0, originals_end, &mut rgba);

    // The exact meridian column can remain sparse (only ROI-extremity
    // pixels land there); rebuild uncovered rows from the two sphere
    // neighbors — equivalent to cross-boundary texture filtering.
    if canvas_w >= 3 {
        for y in 0..canvas_h {
            let row = y * canvas_w;
            let dst = row * 4;
            if rgba[dst + 3] != 0 {
                continue;
            }
            let (l, r) = ((row + 1) * 4, (row + canvas_w - 1) * 4);
            let (la, ra) = (rgba[l + 3], rgba[r + 3]);
            if la != 0 && ra != 0 {
                for c in 0..3 {
                    rgba[dst + c] = ((rgba[l + c] as u16 + rgba[r + c] as u16) / 2) as u8;
                }
                rgba[dst + 3] = 255;
            } else if la != 0 {
                rgba.copy_within(l..l + 4, dst);
            } else if ra != 0 {
                rgba.copy_within(r..r + 4, dst);
            }
        }

        // Viewer-proofing: 360° viewers sample equirect textures with
        // clamp-to-edge filtering, so the first and last columns are never
        // interpolated ACROSS the wrap — any difference between them shows
        // as a 1px seam even on continuous content. Make them identical
        // (their average): the boundary then samples the same values from
        // both sides and disappears under any wrapping mode.
        for y in 0..canvas_h {
            let row = y * canvas_w;
            let (a, b) = (row * 4, (row + canvas_w - 1) * 4);
            if rgba[a + 3] != 0 && rgba[b + 3] != 0 {
                for c in 0..3 {
                    let avg = ((rgba[a + c] as u16 + rgba[b + c] as u16) / 2) as u8;
                    rgba[a + c] = avg;
                    rgba[b + c] = avg;
                }
            }
        }
    }

    Ok(Preview {
        rgba,
        width: canvas_w,
        height: canvas_h,
    })
}

/// Zeroes rescued images' mask pixels wherever ERODED matched coverage
/// exists: metadata-placed shots only fill holes, with a small overlap band
/// (the erosion ring) left for blending. Planar coordinates — pairs
/// spanning the 360° wrap are ignored, consistent with OpenCV's own
/// overlap handling.
/// Nearest-neighbor resize for label masks (values must survive exactly).
fn resize_nearest_gray(src: &GrayImage, dst_w: usize, dst_h: usize) -> GrayImage {
    let mut data = vec![0u8; dst_w * dst_h];
    for y in 0..dst_h {
        let sy = ((y as f64 + 0.5) * src.height as f64 / dst_h as f64) as usize;
        let sy = sy.min(src.height - 1);
        for x in 0..dst_w {
            let sx = ((x as f64 + 0.5) * src.width as f64 / dst_w as f64) as usize;
            data[y * dst_w + x] = src.data[sy * src.width + sx.min(src.width - 1)];
        }
    }
    GrayImage::new(dst_w, dst_h, data)
}

/// Applies painted masks to the seam coverage masks:
/// EXCLUDE zeroes the image's own coverage (its pixels never appear
/// there); PREFER zeroes every OTHER image's coverage underneath — but
/// only where the preferring image actually covers, so preference never
/// punches holes.
fn apply_user_masks(
    s_masks: &mut [GrayImage],
    s_user: &[Option<GrayImage>],
    corners: &[(i32, i32)],
) {
    for i in 0..s_masks.len() {
        if let Some(um) = &s_user[i] {
            for p in 0..s_masks[i].data.len() {
                if um.data[p] == MASK_EXCLUDE {
                    s_masks[i].data[p] = 0;
                }
            }
        }
    }
    for i in 0..s_masks.len() {
        let Some(um) = &s_user[i] else { continue };
        if !um.data.contains(&MASK_PREFER) {
            continue;
        }
        for j in 0..s_masks.len() {
            if j == i {
                continue;
            }
            let (jw, jh) = (s_masks[j].width, s_masks[j].height);
            for y in 0..jh {
                let uy = corners[j].1 + y as i32 - corners[i].1;
                if uy < 0 || uy as usize >= um.height {
                    continue;
                }
                for x in 0..jw {
                    let ux = corners[j].0 + x as i32 - corners[i].0;
                    if ux < 0 || ux as usize >= um.width {
                        continue;
                    }
                    let up = uy as usize * um.width + ux as usize;
                    if um.data[up] == MASK_PREFER && s_masks[i].data[up] != 0 {
                        s_masks[j].data[y * jw + x] = 0;
                    }
                }
            }
        }
    }
}

fn suppress_rescued_masks(
    masks: &mut [GrayImage],
    corners: &[(i32, i32)],
    alignment: &Alignment,
    erode_iters: usize,
) {
    let rescued: Vec<usize> = (0..masks.len())
        .filter(|&i| alignment.images[i].rescued)
        .collect();
    if rescued.is_empty() || rescued.len() == masks.len() {
        return;
    }
    let matched: Vec<usize> = (0..masks.len())
        .filter(|&i| !alignment.images[i].rescued)
        .collect();

    let m_corners: Vec<(i32, i32)> = matched.iter().map(|&i| corners[i]).collect();
    let m_sizes: Vec<(i32, i32)> = matched
        .iter()
        .map(|&i| (masks[i].width as i32, masks[i].height as i32))
        .collect();
    let roi = crate::blend::result_roi(&m_corners, &m_sizes);
    let mut union = vec![0u8; roi.2 * roi.3];
    for &i in &matched {
        let (cx0, cy0) = (corners[i].0 - roi.0, corners[i].1 - roi.1);
        for y in 0..masks[i].height {
            for x in 0..masks[i].width {
                if masks[i].data[y * masks[i].width + x] != 0 {
                    union[(cy0 as usize + y) * roi.2 + cx0 as usize + x] = 255;
                }
            }
        }
    }
    for _ in 0..erode_iters {
        union = erode3(&union, roi.2, roi.3);
    }

    for &i in &rescued {
        let (w, h) = (masks[i].width, masks[i].height);
        for y in 0..h {
            for x in 0..w {
                let gx = corners[i].0 + x as i32 - roi.0;
                let gy = corners[i].1 + y as i32 - roi.1;
                if gx >= 0
                    && gy >= 0
                    && (gx as usize) < roi.2
                    && (gy as usize) < roi.3
                    && union[gy as usize * roi.2 + gx as usize] != 0
                {
                    masks[i].data[y * w + x] = 0;
                }
            }
        }
    }
}

/// 3x3 rect erosion (min filter), border treated as covered so the erosion
/// only recedes at real coverage boundaries.
fn erode3(mask: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut v = 255u8;
            for dy in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for dx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    v = v.min(mask[dy * w + dx]);
                }
            }
            out[y * w + x] = v;
        }
    }
    out
}

/// Plain bilinear RGB resize (browser-quality; not a parity surface).
fn resize_rgb(src: &PixelImage, dst_w: usize, dst_h: usize) -> PixelImage {
    assert_eq!(src.channels, 3);
    let sx = src.width as f64 / dst_w as f64;
    let sy = src.height as f64 / dst_h as f64;
    let mut data = vec![0u8; dst_w * dst_h * 3];
    for dy in 0..dst_h {
        let fy = ((dy as f64 + 0.5) * sy - 0.5).clamp(0.0, src.height as f64 - 1.0);
        let y0 = fy.floor() as usize;
        let y1 = (y0 + 1).min(src.height - 1);
        let wy = (fy - y0 as f64) as f32;
        for dx in 0..dst_w {
            let fx = ((dx as f64 + 0.5) * sx - 0.5).clamp(0.0, src.width as f64 - 1.0);
            let x0 = fx.floor() as usize;
            let x1 = (x0 + 1).min(src.width - 1);
            let wx = (fx - x0 as f64) as f32;
            for c in 0..3 {
                let p00 = src.data[(y0 * src.width + x0) * 3 + c] as f32;
                let p01 = src.data[(y0 * src.width + x1) * 3 + c] as f32;
                let p10 = src.data[(y1 * src.width + x0) * 3 + c] as f32;
                let p11 = src.data[(y1 * src.width + x1) * 3 + c] as f32;
                let top = p00 + (p01 - p00) * wx;
                let bot = p10 + (p11 - p10) * wx;
                data[(dy * dst_w + dx) * 3 + c] =
                    (top + (bot - top) * wy).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    PixelImage::new(dst_w, dst_h, 3, data)
}

/// 3x3 rect dilation (cv2.dilate(mask, None), one iteration).
pub(crate) fn dilate3(mask: &GrayImage) -> GrayImage {
    let (w, h) = (mask.width, mask.height);
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut v = 0u8;
            for dy in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for dx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    v = v.max(mask.data[dy * w + dx]);
                }
            }
            out[y * w + x] = v;
        }
    }
    GrayImage::new(w, h, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orient_left_multiplies_and_round_trips() {
        let cam = CameraParams {
            r: [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
            ..Default::default()
        };
        let mut alignment = Alignment {
            images: vec![AlignedImage {
                id: 7,
                camera: cam,
                rescued: false,
            }],
            dropped: vec![],
            warped_image_scale: 1.0,
            lens: crate::lens::LensParams::default(),
        };
        // Ry(90°) in the engine convention.
        let r_g = [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]];
        orient_alignment(&mut alignment, &r_g);
        let r = alignment.images[0].camera.r;
        // R_g · cam.r, row by row.
        let expect = [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        for a in 0..3 {
            for b in 0..3 {
                assert!((r[a][b] - expect[a][b]).abs() < 1e-6, "({a},{b})");
            }
        }
        // Inverse rotation restores the original.
        let r_inv = [[0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]];
        orient_alignment(&mut alignment, &r_inv);
        let r = alignment.images[0].camera.r;
        for a in 0..3 {
            for b in 0..3 {
                assert!((r[a][b] - cam.r[a][b]).abs() < 1e-6, "({a},{b})");
            }
        }
    }
}

#[cfg(test)]
mod mask_tests {
    use super::*;

    fn gray(w: usize, h: usize, v: u8) -> GrayImage {
        GrayImage::new(w, h, vec![v; w * h])
    }

    #[test]
    fn exclude_zeroes_own_coverage_only() {
        let mut masks = vec![gray(4, 4, 255), gray(4, 4, 255)];
        let mut um = gray(4, 4, 0);
        um.data[5] = MASK_EXCLUDE; // (1,1) of image 0
        let user = vec![Some(um), None];
        apply_user_masks(&mut masks, &user, &[(0, 0), (2, 0)]);
        assert_eq!(masks[0].data[5], 0);
        assert_eq!(masks[0].data[6], 255);
        assert!(masks[1].data.iter().all(|&v| v == 255));
    }

    #[test]
    fn prefer_zeroes_competitors_under_own_coverage() {
        // Image 1 overlaps image 0 shifted right by 2.
        let mut masks = vec![gray(4, 4, 255), gray(4, 4, 255)];
        let mut um = gray(4, 4, 0);
        um.data[2] = MASK_PREFER; // (2,0) of image 0 == (0,0) of image 1
        let user = vec![Some(um), None];
        apply_user_masks(&mut masks, &user, &[(0, 0), (2, 0)]);
        // Image 0 keeps its coverage; image 1 loses the contested pixel.
        assert_eq!(masks[0].data[2], 255);
        assert_eq!(masks[1].data[0], 0);
        assert_eq!(masks[1].data[1], 255);
    }

    #[test]
    fn prefer_without_own_coverage_is_inert() {
        let mut masks = vec![gray(4, 4, 255), gray(4, 4, 255)];
        masks[0].data[2] = 0; // image 0 does NOT cover (2,0)
        let mut um = gray(4, 4, 0);
        um.data[2] = MASK_PREFER;
        let user = vec![Some(um), None];
        apply_user_masks(&mut masks, &user, &[(0, 0), (2, 0)]);
        // No hole punched in image 1.
        assert_eq!(masks[1].data[0], 255);
    }
}
