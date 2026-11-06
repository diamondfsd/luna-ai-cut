//! Control points: auto-generation from feature matches.
//!
//! Coordinates are in REGISTRATION-scale pixels throughout the engine (the
//! app converts to/from original-image space using its work scale, per the
//! .panoproj convention).

use serde::{Deserialize, Serialize};

use crate::matcher::match_pair;
use crate::orb::{orb_detect_and_compute, OrbParams};
use crate::pipeline::SourceImage;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlPoint {
    pub id: u32,
    pub img_a: u32,
    pub img_b: u32,
    pub x_a: f64,
    pub y_a: f64,
    pub x_b: f64,
    pub y_b: f64,
    #[serde(default)]
    pub error_px: Option<f64>,
}

/// Feature-match derived control points: for every confident pair, up to
/// `max_per_pair` RANSAC inliers spread over a grid of image A (one pass
/// per cell round-robin, like a hand-placed spread).
pub fn auto_control_points(sources: &[SourceImage], max_per_pair: usize) -> Vec<ControlPoint> {
    let n = sources.len();
    let detected = crate::par::map(sources, |s| {
        let gray = crate::imgproc::rgb_to_gray_cv(&s.rgb.data, s.rgb.width, s.rgb.height);
        let (kps, d) = orb_detect_and_compute(&gray, &OrbParams::default());
        let pts: Vec<[f32; 2]> = kps.iter().map(|k| [k.x, k.y]).collect();
        (pts, d, (s.rgb.width as u32, s.rgb.height as u32))
    });

    let mut pair_ids = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            pair_ids.push((i, j));
        }
    }
    let matched = crate::par::map(&pair_ids, |&(i, j)| {
        match_pair(
            &detected[i].0,
            &detected[i].1,
            detected[i].2,
            &detected[j].0,
            &detected[j].1,
            detected[j].2,
        )
    });

    const GRID_X: usize = 6;
    const GRID_Y: usize = 4;
    let mut cps = Vec::new();
    let mut next_id = 0u32;
    for (&(i, j), pm) in pair_ids.iter().zip(&matched) {
        if pm.confidence < 1.0 || pm.h.is_none() {
            continue;
        }
        let (w_a, h_a) = detected[i].2;
        // Bin inliers over image A, then round-robin cells for spread.
        let mut cells: Vec<Vec<(usize, f32)>> = vec![Vec::new(); GRID_X * GRID_Y];
        for (mi, (m, &inl)) in pm.matches.iter().zip(&pm.inliers).enumerate() {
            if !inl {
                continue;
            }
            let p = detected[i].0[m.query];
            let cx = ((p[0] / w_a as f32) * GRID_X as f32) as usize;
            let cy = ((p[1] / h_a as f32) * GRID_Y as f32) as usize;
            let cell = cy.min(GRID_Y - 1) * GRID_X + cx.min(GRID_X - 1);
            cells[cell].push((mi, m.distance));
        }
        for cell in cells.iter_mut() {
            cell.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
        }
        let mut picked = Vec::new();
        let mut rank = 0;
        while picked.len() < max_per_pair {
            let before = picked.len();
            for cell in &cells {
                if picked.len() >= max_per_pair {
                    break;
                }
                if let Some(&(mi, _)) = cell.get(rank) {
                    picked.push(mi);
                }
            }
            if picked.len() == before {
                break;
            }
            rank += 1;
        }
        for mi in picked {
            let m = &pm.matches[mi];
            let pa = detected[i].0[m.query];
            let pb = detected[j].0[m.train];
            cps.push(ControlPoint {
                id: next_id,
                img_a: sources[i].id,
                img_b: sources[j].id,
                x_a: pa[0] as f64,
                y_a: pa[1] as f64,
                x_b: pb[0] as f64,
                y_b: pb[1] as f64,
                error_px: None,
            });
            next_id += 1;
        }
    }
    cps
}
