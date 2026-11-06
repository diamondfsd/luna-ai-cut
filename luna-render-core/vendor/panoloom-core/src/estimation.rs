//! Camera estimation graph machinery — ports of `cv::detail` utilities:
//! `DisjointSets` (util.cpp), `leaveBiggestComponent` and
//! `findMaxSpanningTree` (motion_estimators.cpp), plus the shared data
//! types that the estimator and bundle adjuster operate on.

// Index-based loops mirror the OpenCV C++ for diffability.
#![allow(clippy::needless_range_loop)]

use crate::matcher::PairMatches;

/// Per-image features at work scale (`ImageFeatures` without descriptors —
/// estimation only needs geometry).
#[derive(Debug, Clone)]
pub struct FeatureSet {
    pub width: u32,
    pub height: u32,
    /// Keypoint positions, indexed by the match indices.
    pub keypoints: Vec<[f32; 2]>,
}

/// Dense N x N pairwise-match grid mirroring OpenCV's
/// `std::vector<MatchesInfo>` layout: entry `(i, j)` at `i * n + j`.
#[derive(Debug, Clone)]
pub struct MatchGraph {
    pub n: usize,
    pub entries: Vec<PairMatches>,
}

impl MatchGraph {
    #[inline]
    pub fn at(&self, i: usize, j: usize) -> &PairMatches {
        &self.entries[i * self.n + j]
    }

    /// Build the dense grid from per-pair (i < j) results, filling the dual
    /// (j, i) with the inverted homography and swapped match indices
    /// (matchers.cpp:88-99).
    pub fn from_upper_triangle(n: usize, mut upper: Vec<((usize, usize), PairMatches)>) -> Self {
        let mut entries = vec![PairMatches::default(); n * n];
        for ((i, j), pm) in upper.drain(..) {
            let dual = PairMatches {
                matches: pm
                    .matches
                    .iter()
                    .map(|m| crate::matcher::RawMatch {
                        query: m.train,
                        train: m.query,
                        distance: m.distance,
                    })
                    .collect(),
                inliers: pm.inliers.clone(),
                num_inliers: pm.num_inliers,
                h: pm.h.map(|h| invert_3x3(&h)),
                confidence: pm.confidence,
            };
            // The dual's inlier mask stays aligned with the dual's (swapped)
            // match list — the order is unchanged, so the clone is correct.
            entries[i * n + j] = pm;
            entries[j * n + i] = dual;
        }
        Self { n, entries }
    }
}

/// 3x3 inverse via adjugate (H is well-conditioned when it exists here).
pub fn invert_3x3(m: &[[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    let inv_det = 1.0 / det;
    let mut out = [[0.0; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            let (r1, r2) = ((r + 1) % 3, (r + 2) % 3);
            let (c1, c2) = ((c + 1) % 3, (c + 2) % 3);
            // Transposed cofactor (adjugate).
            out[c][r] = (m[r1][c1] * m[r2][c2] - m[r1][c2] * m[r2][c1]) * inv_det;
        }
    }
    out
}

/// Port of `cv::detail::DisjointSets` (util.cpp:48-90).
pub struct DisjointSets {
    parent: Vec<usize>,
    rank: Vec<usize>,
    pub size: Vec<usize>,
}

impl DisjointSets {
    pub fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
            rank: vec![0; n],
            size: vec![1; n],
        }
    }

    pub fn find_set_by_elem(&mut self, elem: usize) -> usize {
        let mut set = elem;
        while self.parent[set] != set {
            set = self.parent[set];
        }
        // Path compression, exactly like util.cpp findSetByElem.
        let mut x = elem;
        while self.parent[x] != set {
            let next = self.parent[x];
            self.parent[x] = set;
            x = next;
        }
        set
    }

    /// Merge by rank; returns the surviving set id (util.cpp mergeSets).
    pub fn merge_sets(&mut self, set1: usize, set2: usize) -> usize {
        match self.rank[set1].cmp(&self.rank[set2]) {
            std::cmp::Ordering::Less => {
                self.parent[set1] = set2;
                self.size[set2] += self.size[set1];
                set2
            }
            std::cmp::Ordering::Greater => {
                self.parent[set2] = set1;
                self.size[set1] += self.size[set2];
                set1
            }
            std::cmp::Ordering::Equal => {
                self.parent[set1] = set2;
                self.rank[set2] += 1;
                self.size[set2] += self.size[set1];
                set2
            }
        }
    }
}

/// Port of `leaveBiggestComponent` (motion_estimators.cpp:1079-1135):
/// returns the (sorted) indices of the largest confidently-connected
/// component. Unlike OpenCV this does NOT mutate its inputs — callers
/// subset the feature/graph containers themselves.
pub fn leave_biggest_component(graph: &MatchGraph, conf_threshold: f64) -> Vec<usize> {
    let n = graph.n;
    let mut comps = DisjointSets::new(n);
    for i in 0..n {
        for j in 0..n {
            if graph.at(i, j).confidence < conf_threshold {
                continue;
            }
            let c1 = comps.find_set_by_elem(i);
            let c2 = comps.find_set_by_elem(j);
            if c1 != c2 {
                comps.merge_sets(c1, c2);
            }
        }
    }
    // max_element over the raw size array (stale non-root entries can never
    // exceed their root's accumulated size, so the max is a root).
    let max_comp = comps
        .size
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(&a.0)))
        .map(|(i, _)| i)
        .unwrap();
    (0..n)
        .filter(|&i| comps.find_set_by_elem(i) == max_comp)
        .collect()
}

/// Spanning tree over images: adjacency lists + tree centers.
#[derive(Debug, Clone)]
pub struct SpanningTree {
    pub adj: Vec<Vec<usize>>,
    pub centers: Vec<usize>,
}

impl SpanningTree {
    /// Breadth-first walk from `start`, calling `visit(from, to)` on each
    /// tree edge in BFS order (util.hpp walkBreadthFirst equivalent).
    pub fn walk_breadth_first(&self, start: usize, mut visit: impl FnMut(usize, usize)) {
        let mut seen = vec![false; self.adj.len()];
        let mut queue = std::collections::VecDeque::from([start]);
        seen[start] = true;
        while let Some(u) = queue.pop_front() {
            for &v in &self.adj[u] {
                if !seen[v] {
                    seen[v] = true;
                    visit(u, v);
                    queue.push_back(v);
                }
            }
        }
    }
}

/// Port of `findMaxSpanningTree` (motion_estimators.cpp:1138-1206).
/// Edge weight = num_inliers; Kruskal over descending weights.
///
/// PARITY NOTE: OpenCV uses unstable `std::sort`; between equal-weight
/// edges the chosen tree is implementation-defined there. We sort
/// descending by weight with insertion order as tie-break (deterministic);
/// on real data equal num_inliers across pairs is rare.
pub fn find_max_spanning_tree(graph: &MatchGraph) -> SpanningTree {
    let n = graph.n;
    let mut edges: Vec<(usize, usize, i32)> = Vec::new();
    for i in 0..n {
        for j in 0..n {
            if graph.at(i, j).h.is_none() {
                continue;
            }
            edges.push((i, j, graph.at(i, j).num_inliers as i32));
        }
    }
    edges.sort_by_key(|e| std::cmp::Reverse(e.2));

    let mut comps = DisjointSets::new(n);
    let mut adj = vec![Vec::new(); n];
    let mut powers = vec![0usize; n];
    for (from, to, _) in edges {
        let c1 = comps.find_set_by_elem(from);
        let c2 = comps.find_set_by_elem(to);
        if c1 != c2 {
            comps.merge_sets(c1, c2);
            adj[from].push(to);
            adj[to].push(from);
            powers[from] += 1;
            powers[to] += 1;
        }
    }

    let tree = SpanningTree {
        adj,
        centers: Vec::new(),
    };

    // Max distance from each leaf via BFS; centers minimize the max.
    let leafs: Vec<usize> = (0..n).filter(|&i| powers[i] == 1).collect();
    let mut max_dists = vec![0usize; n];
    for &leaf in &leafs {
        let mut dist = vec![0usize; n];
        tree.walk_breadth_first(leaf, |from, to| dist[to] = dist[from] + 1);
        for j in 0..n {
            max_dists[j] = max_dists[j].max(dist[j]);
        }
    }
    let min_max = *max_dists.iter().min().unwrap();
    let centers: Vec<usize> = (0..n).filter(|&i| max_dists[i] == min_max).collect();
    assert!(!centers.is_empty() && centers.len() <= 2);

    SpanningTree {
        adj: tree.adj,
        centers,
    }
}

// ---------------------------------------------------------------------------
// Focal estimation (autocalib.cpp) + HomographyBasedEstimator
// (motion_estimators.cpp:59-192) + waveCorrect (motion_estimators.cpp:924-1008)
// ---------------------------------------------------------------------------

use crate::camera::CameraParams;

type Mat3 = [[f64; 3]; 3];

fn mat3_mul(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut out = [[0.0; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            for k in 0..3 {
                out[r][c] += a[r][k] * b[k][c];
            }
        }
    }
    out
}

/// `focalsFromHomography` (autocalib.cpp:63-99): focal estimates from a
/// homography between two images of a rotating camera, assuming centered
/// principal points. Returns (f0, f1) = (source, destination) candidates.
pub fn focals_from_homography(h3: &Mat3) -> (Option<f64>, Option<f64>) {
    let h = [
        h3[0][0], h3[0][1], h3[0][2], h3[1][0], h3[1][1], h3[1][2], h3[2][0], h3[2][1], h3[2][2],
    ];

    let f1 = {
        let mut d1 = h[6] * h[7];
        let mut d2 = (h[7] - h[6]) * (h[7] + h[6]);
        let mut v1 = -(h[0] * h[1] + h[3] * h[4]) / d1;
        let mut v2 = (h[0] * h[0] + h[3] * h[3] - h[1] * h[1] - h[4] * h[4]) / d2;
        if v1 < v2 {
            std::mem::swap(&mut v1, &mut v2);
            std::mem::swap(&mut d1, &mut d2);
        }
        if v1 > 0.0 && v2 > 0.0 {
            Some(if d1.abs() > d2.abs() { v1 } else { v2 }.sqrt())
        } else if v1 > 0.0 {
            Some(v1.sqrt())
        } else {
            None
        }
    };

    let f0 = {
        let mut d1 = h[0] * h[3] + h[1] * h[4];
        let mut d2 = h[0] * h[0] + h[1] * h[1] - h[3] * h[3] - h[4] * h[4];
        let mut v1 = -h[2] * h[5] / d1;
        let mut v2 = (h[5] * h[5] - h[2] * h[2]) / d2;
        if v1 < v2 {
            std::mem::swap(&mut v1, &mut v2);
            std::mem::swap(&mut d1, &mut d2);
        }
        if v1 > 0.0 && v2 > 0.0 {
            Some(if d1.abs() > d2.abs() { v1 } else { v2 }.sqrt())
        } else if v1 > 0.0 {
            Some(v1.sqrt())
        } else {
            None
        }
    };

    (f0, f1)
}

/// `estimateFocal` (autocalib.cpp:102-147): median of sqrt(f0*f1) over all
/// pairs (duals included), or the naive size-based guess when too few.
pub fn estimate_focal(features: &[FeatureSet], graph: &MatchGraph) -> Vec<f64> {
    let n = features.len();
    let mut all_focals: Vec<f64> = Vec::new();
    for i in 0..n {
        for j in 0..n {
            let Some(h) = &graph.at(i, j).h else { continue };
            if let (Some(f0), Some(f1)) = focals_from_homography(h) {
                all_focals.push((f0 * f1).sqrt());
            }
        }
    }

    if all_focals.len() + 1 >= n {
        all_focals.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let m = all_focals.len();
        let median = if m % 2 == 1 {
            all_focals[m / 2]
        } else {
            (all_focals[m / 2 - 1] + all_focals[m / 2]) * 0.5
        };
        vec![median; n]
    } else {
        let sum: f64 = features.iter().map(|f| (f.width + f.height) as f64).sum();
        vec![sum / n as f64; n]
    }
}

/// `HomographyBasedEstimator::estimate` (motion_estimators.cpp:126-192):
/// median focal for all cameras, rotations chained over the max spanning
/// tree (R_to = R_from · K_from⁻¹ · H⁻¹ · K_to), then principal points set
/// to the image centers. R computed in f64, stored f32 (the stitcher
/// converts to CV_32F right after estimation).
pub fn homography_based_estimate(features: &[FeatureSet], graph: &MatchGraph) -> Vec<CameraParams> {
    let n = features.len();
    let focals = estimate_focal(features, graph);
    let mut cameras: Vec<CameraParams> = (0..n)
        .map(|i| CameraParams {
            focal: focals[i],
            ..Default::default()
        })
        .collect();

    // f64 rotations during chaining.
    let mut rotations: Vec<Mat3> = vec![[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]; n];
    let tree = find_max_spanning_tree(graph);
    tree.walk_breadth_first(tree.centers[0], |from, to| {
        // CalcRotation (motion_estimators.cpp:59-87). ppx/ppy are 0 at this
        // stage, so K is just diag(f, f*aspect, 1).
        let k_from = [
            [cameras[from].focal, 0.0, cameras[from].ppx],
            [
                0.0,
                cameras[from].focal * cameras[from].aspect,
                cameras[from].ppy,
            ],
            [0.0, 0.0, 1.0],
        ];
        let k_to = [
            [cameras[to].focal, 0.0, cameras[to].ppx],
            [0.0, cameras[to].focal * cameras[to].aspect, cameras[to].ppy],
            [0.0, 0.0, 1.0],
        ];
        let h = graph.at(from, to).h.as_ref().expect("tree edge has H");
        let r = mat3_mul(&mat3_mul(&invert_3x3(&k_from), &invert_3x3(h)), &k_to);
        rotations[to] = mat3_mul(&rotations[from], &r);
    });

    for i in 0..n {
        for r in 0..3 {
            for c in 0..3 {
                cameras[i].r[r][c] = rotations[i][r][c] as f32;
            }
        }
        cameras[i].ppx += 0.5 * features[i].width as f64;
        cameras[i].ppy += 0.5 * features[i].height as f64;
    }
    cameras
}

/// `warped_image_scale` = median camera focal (stitcher.cpp:517-528).
/// Quirk preserved: for even counts the SUM is cast to f32 BEFORE halving.
pub fn warped_image_scale(cameras: &[CameraParams]) -> f64 {
    let mut focals: Vec<f64> = cameras.iter().map(|c| c.focal).collect();
    focals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = focals.len();
    if n % 2 == 1 {
        focals[n / 2]
    } else {
        ((focals[n / 2 - 1] + focals[n / 2]) as f32 * 0.5) as f64
    }
}

/// Symmetric 3x3 eigen-decomposition (cyclic Jacobi, f64), eigenvalues
/// descending — the contract of `cv::eigen`. Returns (values, vectors as
/// rows).
fn eigen_sym3(m: &Mat3) -> ([f64; 3], Mat3) {
    let mut a = *m;
    let mut v: Mat3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    for _ in 0..64 {
        // Largest off-diagonal element.
        let (mut p, mut q, mut mx) = (0usize, 1usize, 0.0f64);
        for r in 0..3 {
            for c in (r + 1)..3 {
                if a[r][c].abs() > mx {
                    mx = a[r][c].abs();
                    p = r;
                    q = c;
                }
            }
        }
        if mx < 1e-15 {
            break;
        }
        let theta = 0.5 * (a[q][q] - a[p][p]) / a[p][q];
        let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
        let c = 1.0 / (t * t + 1.0).sqrt();
        let s = t * c;
        // Rotate A and accumulate V.
        let (app, aqq, apq) = (a[p][p], a[q][q], a[p][q]);
        a[p][p] = app - t * apq;
        a[q][q] = aqq + t * apq;
        a[p][q] = 0.0;
        a[q][p] = 0.0;
        for k in 0..3 {
            if k != p && k != q {
                let (akp, akq) = (a[k][p], a[k][q]);
                a[k][p] = c * akp - s * akq;
                a[p][k] = a[k][p];
                a[k][q] = s * akp + c * akq;
                a[q][k] = a[k][q];
            }
            let (vkp, vkq) = (v[p][k], v[q][k]);
            v[p][k] = c * vkp - s * vkq;
            v[q][k] = s * vkp + c * vkq;
        }
    }
    // Sort descending by eigenvalue (rows of v are eigenvectors).
    let mut idx = [0usize, 1, 2];
    idx.sort_by(|&x, &y| a[y][y].partial_cmp(&a[x][x]).unwrap());
    let vals = [a[idx[0]][idx[0]], a[idx[1]][idx[1]], a[idx[2]][idx[2]]];
    let vecs = [v[idx[0]], v[idx[1]], v[idx[2]]];
    (vals, vecs)
}

/// `waveCorrect(rmats, WAVE_CORRECT_HORIZ)` (motion_estimators.cpp:924-1008):
/// finds the global rotation that makes camera x-axes span a horizontal
/// plane, resolving sign by the summed x-axis direction.
pub fn wave_correct_horiz(rmats: &mut [[[f32; 3]; 3]]) {
    if rmats.len() <= 1 {
        return;
    }

    // moment = sum over cameras of col0 * col0^T (f32 in OpenCV; f64 here,
    // differences are below the f32 rotation storage precision).
    let mut moment = [[0.0f64; 3]; 3];
    for r in rmats.iter() {
        let col0 = [r[0][0] as f64, r[1][0] as f64, r[2][0] as f64];
        for i in 0..3 {
            for j in 0..3 {
                moment[i][j] += col0[i] * col0[j];
            }
        }
    }
    let (_vals, vecs) = eigen_sym3(&moment);
    let mut rg1 = vecs[2]; // smallest eigenvalue -> normal of the x-axis plane

    let mut img_k = [0.0f64; 3];
    for r in rmats.iter() {
        img_k[0] += r[0][2] as f64;
        img_k[1] += r[1][2] as f64;
        img_k[2] += r[2][2] as f64;
    }
    let mut rg0 = [
        rg1[1] * img_k[2] - rg1[2] * img_k[1],
        rg1[2] * img_k[0] - rg1[0] * img_k[2],
        rg1[0] * img_k[1] - rg1[1] * img_k[0],
    ];
    let rg0_norm = (rg0[0] * rg0[0] + rg0[1] * rg0[1] + rg0[2] * rg0[2]).sqrt();
    if rg0_norm <= f64::MIN_POSITIVE {
        return;
    }
    for x in rg0.iter_mut() {
        *x /= rg0_norm;
    }
    let rg2 = [
        rg0[1] * rg1[2] - rg0[2] * rg1[1],
        rg0[2] * rg1[0] - rg0[0] * rg1[2],
        rg0[0] * rg1[1] - rg0[1] * rg1[0],
    ];

    let mut conf = 0.0f64;
    for r in rmats.iter() {
        conf += rg0[0] * r[0][0] as f64 + rg0[1] * r[1][0] as f64 + rg0[2] * r[2][0] as f64;
    }
    if conf < 0.0 {
        for x in rg0.iter_mut() {
            *x = -*x;
        }
        for x in rg1.iter_mut() {
            *x = -*x;
        }
    }

    let global = [rg0, rg1, rg2];
    for r in rmats.iter_mut() {
        let mut out = [[0.0f32; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let mut acc = 0.0f64;
                for k in 0..3 {
                    acc += global[i][k] * r[k][j] as f64;
                }
                out[i][j] = acc as f32;
            }
        }
        *r = out;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matcher::PairMatches;

    fn graph_with_edges(n: usize, edges: &[(usize, usize, usize, f64)]) -> MatchGraph {
        // (i, j, num_inliers, confidence)
        let mut entries = vec![PairMatches::default(); n * n];
        for &(i, j, ni, conf) in edges {
            for &(a, b) in &[(i, j), (j, i)] {
                entries[a * n + b] = PairMatches {
                    matches: Vec::new(),
                    inliers: Vec::new(),
                    num_inliers: ni,
                    h: Some([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]),
                    confidence: conf,
                };
            }
        }
        MatchGraph { n, entries }
    }

    #[test]
    fn biggest_component_is_selected() {
        // 0-1-2 connected, 3-4 connected, 5 isolated.
        let g = graph_with_edges(6, &[(0, 1, 30, 2.0), (1, 2, 20, 2.0), (3, 4, 50, 2.0)]);
        assert_eq!(leave_biggest_component(&g, 1.0), vec![0, 1, 2]);
    }

    #[test]
    fn spanning_tree_prefers_high_inliers() {
        // Triangle 0-1-2; edge 0-2 is weakest and must be dropped.
        let g = graph_with_edges(3, &[(0, 1, 50, 2.0), (1, 2, 40, 2.0), (0, 2, 10, 2.0)]);
        let tree = find_max_spanning_tree(&g);
        assert!(tree.adj[0].contains(&1));
        assert!(tree.adj[1].contains(&2));
        assert!(!tree.adj[0].contains(&2));
        // Path graph 0-1-2: center is 1.
        assert_eq!(tree.centers, vec![1]);
    }

    #[test]
    fn eigen_sym3_recovers_diagonal() {
        let m = [[3.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 2.0]];
        let (vals, vecs) = eigen_sym3(&m);
        assert!((vals[0] - 3.0).abs() < 1e-12);
        assert!((vals[1] - 2.0).abs() < 1e-12);
        assert!((vals[2] - 1.0).abs() < 1e-12);
        // Smallest eigenvalue's eigenvector is +/- e_y.
        assert!(vecs[2][1].abs() > 0.999);
    }

    #[test]
    fn wave_correct_levels_a_tilted_ring() {
        // Cameras on a ring, all tilted by a common roll: wave correction
        // must undo the roll so camera x-axes lie in one horizontal plane.
        let roll = 0.3f64;
        let (cr, sr) = (roll.cos(), roll.sin());
        let tilt = [[cr, -sr, 0.0], [sr, cr, 0.0], [0.0, 0.0, 1.0]];
        let mut rmats: Vec<[[f32; 3]; 3]> = (0..8)
            .map(|i| {
                let yaw = i as f64 * std::f64::consts::FRAC_PI_4;
                let (cy, sy) = (yaw.cos(), yaw.sin());
                let ry = [[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]];
                let m = mat3_mul(&tilt, &ry);
                let mut out = [[0.0f32; 3]; 3];
                for r in 0..3 {
                    for c in 0..3 {
                        out[r][c] = m[r][c] as f32;
                    }
                }
                out
            })
            .collect();
        wave_correct_horiz(&mut rmats);
        // After correction every camera's x-axis y-component ~ 0.
        for r in &rmats {
            assert!(
                r[1][0].abs() < 1e-4,
                "x-axis not level after wave correct: {r:?}"
            );
        }
    }

    #[test]
    fn invert_3x3_roundtrip() {
        let m = [[2.0, 0.0, 1.0], [0.0, 3.0, -1.0], [1.0, 0.0, 1.0]];
        let inv = invert_3x3(&m);
        for r in 0..3 {
            for c in 0..3 {
                let mut acc = 0.0;
                for k in 0..3 {
                    acc += m[r][k] * inv[k][c];
                }
                let expect = if r == c { 1.0 } else { 0.0 };
                assert!((acc - expect).abs() < 1e-12);
            }
        }
    }
}
