//! Descriptor matching — port of OpenCV's `CpuMatcher` /
//! `BestOf2NearestMatcher` (stitching/src/matchers.cpp), with EXACT
//! brute-force Hamming instead of FLANN-LSH (see docs/pipeline.md §2: LSH is
//! approximate and nondeterministic; the oracle uses the same BF semantics).

use std::collections::HashSet;

use crate::homography::find_homography;

pub const MATCH_CONF: f32 = 0.3;
pub const NUM_MATCHES_THRESH1: usize = 6;
pub const NUM_MATCHES_THRESH2: usize = 6;
pub const MATCHES_CONFIDENCE_THRESH: f64 = 3.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RawMatch {
    pub query: usize,
    pub train: usize,
    pub distance: f32,
}

#[inline]
fn hamming(a: &[u8; 32], b: &[u8; 32]) -> u32 {
    let mut acc = 0u32;
    for i in 0..4 {
        let x = u64::from_le_bytes(a[i * 8..(i + 1) * 8].try_into().unwrap());
        let y = u64::from_le_bytes(b[i * 8..(i + 1) * 8].try_into().unwrap());
        acc += (x ^ y).count_ones();
    }
    acc
}

/// 2-NN over `train` for one query descriptor: (best_idx, best, second_best).
/// Ties keep the lower train index, like BFMatcher's strict-less scan.
fn two_nn(query: &[u8; 32], train: &[[u8; 32]]) -> Option<(usize, u32, u32)> {
    if train.len() < 2 {
        return None;
    }
    let (mut bi, mut b0, mut b1) = (0usize, u32::MAX, u32::MAX);
    for (i, t) in train.iter().enumerate() {
        let d = hamming(query, t);
        if d < b0 {
            b1 = b0;
            b0 = d;
            bi = i;
        } else if d < b1 {
            b1 = d;
        }
    }
    Some((bi, b0, b1))
}

/// `CpuMatcher::match` semantics: ratio-tested 2-NN in both directions,
/// second direction added swapped, skipping pairs already found.
pub fn best_of_2_nearest_raw(desc_a: &[[u8; 32]], desc_b: &[[u8; 32]]) -> Vec<RawMatch> {
    let ratio = 1.0 - MATCH_CONF;
    let mut matches = Vec::new();
    let mut seen: HashSet<(usize, usize)> = HashSet::new();

    for (q, d) in desc_a.iter().enumerate() {
        if let Some((t, d0, d1)) = two_nn(d, desc_b) {
            if (d0 as f32) < ratio * d1 as f32 {
                matches.push(RawMatch {
                    query: q,
                    train: t,
                    distance: d0 as f32,
                });
                seen.insert((q, t));
            }
        }
    }
    for (q, d) in desc_b.iter().enumerate() {
        if let Some((t, d0, d1)) = two_nn(d, desc_a) {
            if (d0 as f32) < ratio * d1 as f32 && !seen.contains(&(t, q)) {
                matches.push(RawMatch {
                    query: t,
                    train: q,
                    distance: d0 as f32,
                });
            }
        }
    }
    matches
}

/// Brown–Lowe confidence: `num_inliers / (8 + 0.3 * num_matches)`, zeroed
/// above the near-duplicate threshold (matchers.cpp:437-443).
pub fn match_confidence(num_inliers: usize, num_matches: usize) -> f64 {
    let c = num_inliers as f64 / (8.0 + 0.3 * num_matches as f64);
    if c > MATCHES_CONFIDENCE_THRESH {
        0.0
    } else {
        c
    }
}

/// `MatchesInfo` equivalent for one (src, dst) image pair.
#[derive(Debug, Clone, Default)]
pub struct PairMatches {
    pub matches: Vec<RawMatch>,
    pub inliers: Vec<bool>,
    pub num_inliers: usize,
    /// Homography in CENTERED coordinates (both point sets shifted by
    /// -size/2), like the whole OpenCV stitching pipeline expects.
    pub h: Option<[[f64; 3]; 3]>,
    pub confidence: f64,
}

/// `BestOf2NearestMatcher::match` (matchers.cpp:397-475): raw matches →
/// RANSAC homography on centered coordinates → confidence → H re-estimation
/// from inliers.
///
/// `pts_*` are keypoint positions indexed by the descriptors' order;
/// `size_*` are (width, height) of the images.
pub fn match_pair(
    pts_a: &[[f32; 2]],
    desc_a: &[[u8; 32]],
    size_a: (u32, u32),
    pts_b: &[[f32; 2]],
    desc_b: &[[u8; 32]],
    size_b: (u32, u32),
) -> PairMatches {
    let matches = best_of_2_nearest_raw(desc_a, desc_b);
    let mut out = PairMatches {
        inliers: vec![false; matches.len()],
        matches,
        ..Default::default()
    };
    if out.matches.len() < NUM_MATCHES_THRESH1 {
        return out;
    }

    // Centered coordinates (matchers.cpp:415-423).
    let src: Vec<[f32; 2]> = out
        .matches
        .iter()
        .map(|m| {
            let p = pts_a[m.query];
            [p[0] - size_a.0 as f32 * 0.5, p[1] - size_a.1 as f32 * 0.5]
        })
        .collect();
    let dst: Vec<[f32; 2]> = out
        .matches
        .iter()
        .map(|m| {
            let p = pts_b[m.train];
            [p[0] - size_b.0 as f32 * 0.5, p[1] - size_b.1 as f32 * 0.5]
        })
        .collect();

    let Some(res) = find_homography(&src, &dst) else {
        return out;
    };
    let det = det3(&res.h);
    if det.abs() < f64::EPSILON {
        return out;
    }

    out.num_inliers = res.inliers.iter().filter(|&&b| b).count();
    out.inliers = res.inliers;
    out.h = Some(res.h);
    out.confidence = match_confidence(out.num_inliers, out.matches.len());

    // Re-estimate H from inliers only (matchers.cpp:449-474). OpenCV keeps
    // the FIRST-pass inlier mask here, which is a real defect: when the
    // matches cluster in a small region, the first H is weakly constrained
    // and can absorb a grossly wrong correspondence; the refined H then no
    // longer fits it, but the stale mask still feeds it to the bundle
    // adjuster (least squares, no robust loss) and warps the whole result.
    // DELIBERATE DEVIATION: re-validate the mask against the final H,
    // pruning grossly inconsistent "inliers". The threshold is 3x the
    // RANSAC tolerance (9px): this is gross-outlier hygiene — tight enough
    // to kill wrong correspondences (observed: 3578px!), loose enough to
    // keep marginal genuine inliers that a strict recheck would drop.
    if out.num_inliers >= NUM_MATCHES_THRESH2 {
        let src_in: Vec<[f32; 2]> = src
            .iter()
            .zip(&out.inliers)
            .filter(|(_, &keep)| keep)
            .map(|(p, _)| *p)
            .collect();
        let dst_in: Vec<[f32; 2]> = dst
            .iter()
            .zip(&out.inliers)
            .filter(|(_, &keep)| keep)
            .map(|(p, _)| *p)
            .collect();
        if let Some(refined) = find_homography(&src_in, &dst_in) {
            out.h = Some(refined.h);
            let thr_sqr = 81.0f32; // (3 * 3.0 px)^2
            for (idx, keep) in out.inliers.iter_mut().enumerate() {
                if !*keep {
                    continue;
                }
                let (p, q) = (src[idx], dst[idx]);
                let h = &refined.h;
                let w = h[2][0] * p[0] as f64 + h[2][1] * p[1] as f64 + h[2][2];
                let hx = (h[0][0] * p[0] as f64 + h[0][1] * p[1] as f64 + h[0][2]) / w;
                let hy = (h[1][0] * p[0] as f64 + h[1][1] * p[1] as f64 + h[1][2]) / w;
                let err = ((hx - q[0] as f64).powi(2) + (hy - q[1] as f64).powi(2)) as f32;
                if err > thr_sqr {
                    *keep = false;
                    out.num_inliers -= 1;
                }
            }
        }
    }
    out
}

fn det3(h: &[[f64; 3]; 3]) -> f64 {
    h[0][0] * (h[1][1] * h[2][2] - h[1][2] * h[2][1])
        - h[0][1] * (h[1][0] * h[2][2] - h[1][2] * h[2][0])
        + h[0][2] * (h[1][0] * h[2][1] - h[1][1] * h[2][0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hamming_distance_works() {
        let a = [0u8; 32];
        let mut b = [0u8; 32];
        b[0] = 0xFF;
        b[31] = 0x0F;
        assert_eq!(hamming(&a, &b), 12);
        assert_eq!(hamming(&a, &a), 0);
    }

    #[test]
    fn ratio_test_rejects_ambiguous() {
        // Query equidistant to two train descriptors -> rejected.
        let mut t0 = [0u8; 32];
        let mut t1 = [0u8; 32];
        t0[0] = 0b1;
        t1[0] = 0b10;
        let q = [0u8; 32];
        let m = best_of_2_nearest_raw(&[q], &[t0, t1]);
        assert!(m.is_empty());
    }

    #[test]
    fn reverse_direction_adds_swapped() {
        // b0 matches a0 clearly; a-side has < 2 descriptors on one side is
        // fine because both directions are scanned independently.
        let mut a0 = [0u8; 32];
        a0[0] = 0xF0;
        let far = [0xFFu8; 32];
        let b0 = a0;
        let m = best_of_2_nearest_raw(&[a0, far], &[b0, [0u8; 32]]);
        assert!(m.iter().any(|m| m.query == 0 && m.train == 0));
        // No duplicates.
        let mut pairs: Vec<_> = m.iter().map(|m| (m.query, m.train)).collect();
        pairs.sort_unstable();
        pairs.dedup();
        assert_eq!(pairs.len(), m.len());
    }

    #[test]
    fn confidence_formula() {
        assert!((match_confidence(55, 55) - 55.0 / (8.0 + 16.5)).abs() < 1e-12);
        // Too-perfect match is zeroed (near-duplicate rejection).
        assert_eq!(match_confidence(100, 10), 0.0);
    }
}
