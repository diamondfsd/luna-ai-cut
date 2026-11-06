//! Graph-cut seam finding — ports of `cv::detail::GCGraph` (gcgraph.hpp,
//! Boykov–Kolmogorov max-flow) and `GraphCutSeamFinder` with `COST_COLOR`
//! (seam_finders.cpp:1108-1381). Stitcher defaults: terminal cost 10000,
//! bad-region penalty 1000, overlap gap 10 px, weight_eps 1.0.

#![allow(clippy::needless_range_loop)]

use crate::imgproc::GrayImage;
use crate::warp::PixelImage;

pub const TERMINAL_COST: f32 = 10_000.0;
pub const BAD_REGION_PENALTY: f32 = 1_000.0;

// ---------------------------------------------------------------------------
// GCGraph<float> — Boykov-Kolmogorov max-flow, ported index-for-pointer.
//
// Pointer emulation: C++ uses Vtx* with a stack `stub` as nilNode. Here a
// "pointer" is i32: NIL (-1) is the stub, NULL_PTR (-2) is nullptr, other
// values are vertex indices. The stub's `next` field lives in `stub_next`.
// `parent` keeps OpenCV's encoding: 0 = none (edge 0 is a dummy),
// TERMINAL = -1, ORPHAN = -2, otherwise an edge index (>= 2).
// ---------------------------------------------------------------------------

const NIL: i32 = -1;
const NULL_PTR: i32 = -2;
const TERMINAL: i32 = -1;
const ORPHAN: i32 = -2;

#[derive(Clone, Copy)]
struct Vtx {
    next: i32, // pointer domain: NULL_PTR / NIL / vertex idx
    parent: i32,
    first: i32, // first edge index (0 = none)
    ts: i32,
    dist: i32,
    weight: f32,
    t: u8,
}

#[derive(Clone, Copy)]
struct Edge {
    dst: i32,
    next: i32,
    weight: f32,
}

pub struct GcGraph {
    vtcs: Vec<Vtx>,
    edges: Vec<Edge>,
    flow: f32,
    stub_next: i32,
}

impl GcGraph {
    pub fn new(vtx_count: usize, edge_count: usize) -> Self {
        let mut g = Self {
            vtcs: Vec::with_capacity(vtx_count),
            edges: Vec::with_capacity(edge_count * 2 + 2),
            flow: 0.0,
            stub_next: NIL,
        };
        g.edges.reserve(edge_count + 2);
        g
    }

    pub fn add_vtx(&mut self) -> i32 {
        self.vtcs.push(Vtx {
            next: NULL_PTR,
            parent: 0,
            first: 0,
            ts: 0,
            dist: 0,
            weight: 0.0,
            t: 0,
        });
        self.vtcs.len() as i32 - 1
    }

    pub fn add_edges(&mut self, i: i32, j: i32, w: f32, revw: f32) {
        debug_assert!(i != j && w >= 0.0 && revw >= 0.0);
        if self.edges.is_empty() {
            self.edges.resize(
                2,
                Edge {
                    dst: 0,
                    next: 0,
                    weight: 0.0,
                },
            );
        }
        let from_i = Edge {
            dst: j,
            next: self.vtcs[i as usize].first,
            weight: w,
        };
        self.vtcs[i as usize].first = self.edges.len() as i32;
        self.edges.push(from_i);
        let to_i = Edge {
            dst: i,
            next: self.vtcs[j as usize].first,
            weight: revw,
        };
        self.vtcs[j as usize].first = self.edges.len() as i32;
        self.edges.push(to_i);
    }

    pub fn add_term_weights(&mut self, i: i32, mut source_w: f32, mut sink_w: f32) {
        let dw = self.vtcs[i as usize].weight;
        if dw > 0.0 {
            source_w += dw;
        } else {
            sink_w -= dw;
        }
        self.flow += if source_w < sink_w { source_w } else { sink_w };
        self.vtcs[i as usize].weight = source_w - sink_w;
    }

    #[inline]
    fn next_of(&self, p: i32) -> i32 {
        if p == NIL {
            self.stub_next
        } else {
            self.vtcs[p as usize].next
        }
    }

    #[inline]
    fn set_next(&mut self, p: i32, q: i32) {
        if p == NIL {
            self.stub_next = q;
        } else {
            self.vtcs[p as usize].next = q;
        }
    }

    pub fn max_flow(&mut self) -> f32 {
        assert!(!self.vtcs.is_empty() && !self.edges.is_empty());
        let mut first = NIL;
        let mut last = NIL;
        let mut curr_ts: i32 = 0;
        self.stub_next = NIL;
        let mut orphans: Vec<i32> = Vec::new();

        // Initialize the active queue.
        for i in 0..self.vtcs.len() {
            let v = &mut self.vtcs[i];
            v.ts = 0;
            if v.weight != 0.0 {
                v.dist = 1;
                v.parent = TERMINAL;
                v.t = u8::from(v.weight < 0.0);
                let iv = i as i32;
                self.set_next(last, iv);
                last = iv;
            } else {
                v.parent = 0;
            }
        }
        first = self.next_of(first);
        self.set_next(last, NIL);
        self.stub_next = NULL_PTR; // C++: nilNode->next = 0

        loop {
            let mut e0: i32 = -1;

            // Grow S & T trees until they touch.
            while first != NIL {
                let v = first;
                if self.vtcs[v as usize].parent != 0 {
                    let vt = self.vtcs[v as usize].t;
                    let mut ei = self.vtcs[v as usize].first;
                    while ei != 0 {
                        if self.edges[(ei ^ vt as i32) as usize].weight != 0.0 {
                            let u = self.edges[ei as usize].dst;
                            if self.vtcs[u as usize].parent == 0 {
                                self.vtcs[u as usize].t = vt;
                                self.vtcs[u as usize].parent = ei ^ 1;
                                self.vtcs[u as usize].ts = self.vtcs[v as usize].ts;
                                self.vtcs[u as usize].dist = self.vtcs[v as usize].dist + 1;
                                if self.vtcs[u as usize].next == NULL_PTR {
                                    self.vtcs[u as usize].next = NIL;
                                    self.set_next(last, u);
                                    last = u;
                                }
                            } else if self.vtcs[u as usize].t != vt {
                                e0 = ei ^ vt as i32;
                                break;
                            } else if self.vtcs[u as usize].dist > self.vtcs[v as usize].dist + 1
                                && self.vtcs[u as usize].ts <= self.vtcs[v as usize].ts
                            {
                                self.vtcs[u as usize].parent = ei ^ 1;
                                self.vtcs[u as usize].ts = self.vtcs[v as usize].ts;
                                self.vtcs[u as usize].dist = self.vtcs[v as usize].dist + 1;
                            }
                        }
                        ei = self.edges[ei as usize].next;
                    }
                    if e0 > 0 {
                        break;
                    }
                }
                // Exclude the vertex from the active list.
                first = self.next_of(first);
                self.vtcs[v as usize].next = NULL_PTR;
            }

            if e0 <= 0 {
                break;
            }

            // Minimum residual along the found path.
            let mut min_weight = self.edges[e0 as usize].weight;
            debug_assert!(min_weight > 0.0);
            for k in (0..=1i32).rev() {
                let mut v = self.edges[(e0 ^ k) as usize].dst;
                loop {
                    let ei = self.vtcs[v as usize].parent;
                    if ei < 0 {
                        break;
                    }
                    let weight = self.edges[(ei ^ k) as usize].weight;
                    min_weight = min_weight.min(weight);
                    v = self.edges[ei as usize].dst;
                }
                let weight = self.vtcs[v as usize].weight.abs();
                min_weight = min_weight.min(weight);
            }

            // Augment.
            self.edges[e0 as usize].weight -= min_weight;
            self.edges[(e0 ^ 1) as usize].weight += min_weight;
            self.flow += min_weight;

            for k in (0..=1i32).rev() {
                let mut v = self.edges[(e0 ^ k) as usize].dst;
                loop {
                    let ei = self.vtcs[v as usize].parent;
                    if ei < 0 {
                        break;
                    }
                    self.edges[(ei ^ (k ^ 1)) as usize].weight += min_weight;
                    self.edges[(ei ^ k) as usize].weight -= min_weight;
                    if self.edges[(ei ^ k) as usize].weight == 0.0 {
                        orphans.push(v);
                        self.vtcs[v as usize].parent = ORPHAN;
                    }
                    v = self.edges[ei as usize].dst;
                }
                self.vtcs[v as usize].weight += min_weight * (1 - k * 2) as f32;
                if self.vtcs[v as usize].weight == 0.0 {
                    orphans.push(v);
                    self.vtcs[v as usize].parent = ORPHAN;
                }
            }

            // Adopt orphans.
            curr_ts += 1;
            while let Some(v2) = orphans.pop() {
                let mut min_dist = i32::MAX;
                let mut e0a: i32 = 0;
                let vt = self.vtcs[v2 as usize].t;

                let mut ei = self.vtcs[v2 as usize].first;
                while ei != 0 {
                    if self.edges[(ei ^ (vt ^ 1) as i32) as usize].weight != 0.0 {
                        let mut u = self.edges[ei as usize].dst;
                        if self.vtcs[u as usize].t == vt && self.vtcs[u as usize].parent != 0 {
                            // Distance to the tree root.
                            let mut d: i32 = 0;
                            loop {
                                if self.vtcs[u as usize].ts == curr_ts {
                                    d += self.vtcs[u as usize].dist;
                                    break;
                                }
                                let ej = self.vtcs[u as usize].parent;
                                d += 1;
                                if ej < 0 {
                                    if ej == ORPHAN {
                                        d = i32::MAX - 1;
                                    } else {
                                        self.vtcs[u as usize].ts = curr_ts;
                                        self.vtcs[u as usize].dist = 1;
                                    }
                                    break;
                                }
                                u = self.edges[ej as usize].dst;
                            }

                            d += 1;
                            if d < i32::MAX {
                                if d < min_dist {
                                    min_dist = d;
                                    e0a = ei;
                                }
                                let mut u2 = self.edges[ei as usize].dst;
                                let mut dd = d;
                                while self.vtcs[u2 as usize].ts != curr_ts {
                                    self.vtcs[u2 as usize].ts = curr_ts;
                                    dd -= 1;
                                    self.vtcs[u2 as usize].dist = dd;
                                    u2 = self.edges[self.vtcs[u2 as usize].parent as usize].dst;
                                }
                            }
                        }
                    }
                    ei = self.edges[ei as usize].next;
                }

                self.vtcs[v2 as usize].parent = e0a;
                if e0a > 0 {
                    self.vtcs[v2 as usize].ts = curr_ts;
                    self.vtcs[v2 as usize].dist = min_dist;
                    continue;
                }

                // No parent found: free the vertex, reactivate neighbors.
                self.vtcs[v2 as usize].ts = 0;
                let mut ei = self.vtcs[v2 as usize].first;
                while ei != 0 {
                    let u = self.edges[ei as usize].dst;
                    let ej = self.vtcs[u as usize].parent;
                    if self.vtcs[u as usize].t == vt && ej != 0 {
                        if self.edges[(ei ^ (vt ^ 1) as i32) as usize].weight != 0.0
                            && self.vtcs[u as usize].next == NULL_PTR
                        {
                            self.vtcs[u as usize].next = NIL;
                            self.set_next(last, u);
                            last = u;
                        }
                        if ej > 0 && self.edges[ej as usize].dst == v2 {
                            orphans.push(u);
                            self.vtcs[u as usize].parent = ORPHAN;
                        }
                    }
                    ei = self.edges[ei as usize].next;
                }
            }
        }
        self.flow
    }

    pub fn in_source_segment(&self, i: i32) -> bool {
        self.vtcs[i as usize].t == 0
    }
}

// ---------------------------------------------------------------------------
// GraphCutSeamFinder (COST_COLOR)
// ---------------------------------------------------------------------------

/// `normL2(Point3f)` from stitching's util_inl.hpp — the SQUARED norm.
#[inline]
fn norm_l2_sq(a: [f32; 3], b: [f32; 3]) -> f32 {
    let d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
}

/// `overlapRoi` (util.cpp): intersection of two placed rects.
pub fn overlap_roi(
    tl1: (i32, i32),
    tl2: (i32, i32),
    sz1: (i32, i32),
    sz2: (i32, i32),
) -> Option<(i32, i32, i32, i32)> {
    let x_tl = tl1.0.max(tl2.0);
    let y_tl = tl1.1.max(tl2.1);
    let x_br = (tl1.0 + sz1.0).min(tl2.0 + sz2.0);
    let y_br = (tl1.1 + sz1.1).min(tl2.1 + sz2.1);
    if x_tl < x_br && y_tl < y_br {
        Some((x_tl, y_tl, x_br - x_tl, y_br - y_tl))
    } else {
        None
    }
}

struct F32Image {
    width: usize,
    height: usize,
    data: Vec<[f32; 3]>,
}

/// `GraphCutSeamFinder("COST_COLOR").find(...)`: updates `masks` in place so
/// each overlap pixel belongs to exactly one image, with seams routed
/// through least-difference regions.
pub fn find_seams_graph_cut_color(
    images: &[PixelImage],
    corners: &[(i32, i32)],
    masks: &mut [GrayImage],
) {
    assert_eq!(images.len(), corners.len());
    assert_eq!(images.len(), masks.len());
    // f32 conversion, like the oracle's astype(np.float32).
    let imgs: Vec<F32Image> = images
        .iter()
        .map(|im| {
            assert_eq!(im.channels, 3);
            F32Image {
                width: im.width,
                height: im.height,
                data: im
                    .data
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .map(|p| [p[0] as f32, p[1] as f32, p[2] as f32])
                    .collect(),
            }
        })
        .collect();

    // The serial pair order (OpenCV's nested i<j loop). Each pair reads and
    // writes ONLY masks[i] and masks[j], so the result is determined by the
    // per-image order of pairs alone: pairs sharing no image commute
    // exactly. The parallel scheduler below preserves per-image order (a
    // pair runs when it is the EARLIEST remaining pair for both images),
    // which reproduces the serial output bit-for-bit — but with no round
    // barriers: a pair starts the moment its two predecessors finish.
    type Roi = (i32, i32, i32, i32);
    let mut pairs: Vec<(usize, usize, Roi)> = Vec::new();
    for i in 0..imgs.len().saturating_sub(1) {
        for j in (i + 1)..imgs.len() {
            let sz_i = (imgs[i].width as i32, imgs[i].height as i32);
            let sz_j = (imgs[j].width as i32, imgs[j].height as i32);
            if let Some(roi) = overlap_roi(corners[i], corners[j], sz_i, sz_j) {
                pairs.push((i, j, roi));
            }
        }
    }

    // Per-pair progress is not available here: `rayon::scope` blocks the
    // calling thread without enlisting it, so no pair ever runs on the
    // thread carrying the progress hook. Report the scale instead — with
    // the elapsed clock beside it, "3400 pairs" at least says what the wait
    // is proportional to.
    crate::progress::stage(&format!("graph-cut-seams:{} pairs", pairs.len()));

    // Bounding boxes of warped sphere images (pole shots span nearly the
    // whole strip) intersect far more often than the MASKS do, and when no
    // pixel carries both masks the cut's mask update is a no-op (every
    // write is guarded by the other image's mask) — `run_pair` skips the
    // max-flow entirely then. Output is identical to OpenCV's, which runs
    // every box pair.
    let run_pair =
        |i: usize, j: usize, roi: Roi, mask_i: &mut GrayImage, mask_j: &mut GrayImage| {
            if masks_intersect(corners[i], corners[j], mask_i, mask_j, roi) {
                find_in_pair(
                    &imgs[i], &imgs[j], corners[i], corners[j], mask_i, mask_j, roi,
                );
            }
        };

    #[cfg(not(feature = "parallel"))]
    for &(i, j, roi) in &pairs {
        let (a, b) = masks.split_at_mut(j);
        run_pair(i, j, roi, &mut a[i], &mut b[0]);
    }

    #[cfg(feature = "parallel")]
    {
        use std::sync::Mutex;

        // queues[img] = that image's pair indices in serial order;
        // fronts[img] = how many have completed.
        let mut queues: Vec<Vec<usize>> = vec![Vec::new(); imgs.len()];
        for (p, &(i, j, _)) in pairs.iter().enumerate() {
            queues[i].push(p);
            queues[j].push(p);
        }
        let mask_cells: Vec<Mutex<GrayImage>> = masks
            .iter_mut()
            .map(|m| Mutex::new(std::mem::replace(m, GrayImage::new(0, 0, Vec::new()))))
            .collect();
        let fronts = Mutex::new(vec![0usize; imgs.len()]);

        let eligible = |fronts: &[usize], p: usize| {
            let (i, j, _) = pairs[p];
            queues[i].get(fronts[i]) == Some(&p) && queues[j].get(fronts[j]) == Some(&p)
        };

        // Executes pair p, then advances both images' queues and returns
        // any pairs that just became runnable.
        let execute = |p: usize| -> Vec<usize> {
            let (i, j, roi) = pairs[p];
            {
                let mut mask_i = mask_cells[i].lock().unwrap();
                let mut mask_j = mask_cells[j].lock().unwrap();
                run_pair(i, j, roi, &mut mask_i, &mut mask_j);
            }
            let mut f = fronts.lock().unwrap();
            f[i] += 1;
            f[j] += 1;
            let mut next = Vec::new();
            for img in [i, j] {
                if let Some(&q) = queues[img].get(f[img]) {
                    if eligible(&f, q) {
                        next.push(q);
                    }
                }
            }
            next
        };

        // A pair becomes eligible exactly when its LAST predecessor
        // completes, so each pair is spawned exactly once — no dedup or
        // done-flags needed.
        fn spawn_chain<'s>(
            s: &rayon::Scope<'s>,
            exec: &'s (dyn Fn(usize) -> Vec<usize> + Sync),
            p: usize,
        ) {
            s.spawn(move |s| {
                for q in exec(p) {
                    spawn_chain(s, exec, q);
                }
            });
        }

        let initial: Vec<usize> = {
            let f = fronts.lock().unwrap();
            (0..pairs.len()).filter(|&p| eligible(&f, p)).collect()
        };
        let exec_ref: &(dyn Fn(usize) -> Vec<usize> + Sync) = &execute;
        rayon::scope(|s| {
            for p in initial {
                spawn_chain(s, exec_ref, p);
            }
        });

        for (m, cell) in masks.iter_mut().zip(mask_cells) {
            *m = cell.into_inner().unwrap();
        }
    }
}

/// True when any pixel inside the pair's overlap ROI carries BOTH masks.
fn masks_intersect(
    tl1: (i32, i32),
    tl2: (i32, i32),
    mask1: &GrayImage,
    mask2: &GrayImage,
    roi: (i32, i32, i32, i32),
) -> bool {
    let (roi_x, roi_y, roi_w, roi_h) = roi;
    for y in 0..roi_h {
        let y1 = roi_y - tl1.1 + y;
        let y2 = roi_y - tl2.1 + y;
        if y1 < 0 || y2 < 0 || y1 >= mask1.height as i32 || y2 >= mask2.height as i32 {
            continue;
        }
        let r1 = y1 as usize * mask1.width;
        let r2 = y2 as usize * mask2.width;
        for x in 0..roi_w {
            let x1 = roi_x - tl1.0 + x;
            let x2 = roi_x - tl2.0 + x;
            if x1 < 0 || x2 < 0 || x1 >= mask1.width as i32 || x2 >= mask2.width as i32 {
                continue;
            }
            if mask1.data[r1 + x1 as usize] != 0 && mask2.data[r2 + x2 as usize] != 0 {
                return true;
            }
        }
    }
    false
}

#[allow(clippy::too_many_arguments)]
fn find_in_pair(
    img1: &F32Image,
    img2: &F32Image,
    tl1: (i32, i32),
    tl2: (i32, i32),
    mask1: &mut GrayImage,
    mask2: &mut GrayImage,
    roi: (i32, i32, i32, i32),
) {
    const GAP: i32 = 10;
    let (roi_x, roi_y, roi_w, roi_h) = roi;
    let sub_w = (roi_w + 2 * GAP) as usize;
    let sub_h = (roi_h + 2 * GAP) as usize;

    let mut subimg1 = vec![[0f32; 3]; sub_w * sub_h];
    let mut subimg2 = vec![[0f32; 3]; sub_w * sub_h];
    let mut submask1 = vec![0u8; sub_w * sub_h];
    let mut submask2 = vec![0u8; sub_w * sub_h];

    for y in -GAP..roi_h + GAP {
        for x in -GAP..roi_w + GAP {
            let si = ((y + GAP) as usize) * sub_w + (x + GAP) as usize;
            let (y1, x1) = (roi_y - tl1.1 + y, roi_x - tl1.0 + x);
            if y1 >= 0 && x1 >= 0 && y1 < img1.height as i32 && x1 < img1.width as i32 {
                subimg1[si] = img1.data[y1 as usize * img1.width + x1 as usize];
                submask1[si] = mask1.data[y1 as usize * img1.width + x1 as usize];
            }
            let (y2, x2) = (roi_y - tl2.1 + y, roi_x - tl2.0 + x);
            if y2 >= 0 && x2 >= 0 && y2 < img2.height as i32 && x2 < img2.width as i32 {
                subimg2[si] = img2.data[y2 as usize * img2.width + x2 as usize];
                submask2[si] = mask2.data[y2 as usize * img2.width + x2 as usize];
            }
        }
    }

    let vertex_count = sub_h * sub_w;
    let edge_count = (sub_h - 1) * sub_w + (sub_w - 1) * sub_h;
    let mut graph = GcGraph::new(vertex_count, edge_count);

    // setGraphWeightsColor (seam_finders.cpp:1164-1209).
    for si in 0..sub_w * sub_h {
        let v = graph.add_vtx();
        graph.add_term_weights(
            v,
            if submask1[si] != 0 {
                TERMINAL_COST
            } else {
                0.0
            },
            if submask2[si] != 0 {
                TERMINAL_COST
            } else {
                0.0
            },
        );
    }
    const WEIGHT_EPS: f32 = 1.0;
    for y in 0..sub_h {
        for x in 0..sub_w {
            let v = (y * sub_w + x) as i32;
            let si = y * sub_w + x;
            if x < sub_w - 1 {
                let mut weight = norm_l2_sq(subimg1[si], subimg2[si])
                    + norm_l2_sq(subimg1[si + 1], subimg2[si + 1])
                    + WEIGHT_EPS;
                if submask1[si] == 0
                    || submask1[si + 1] == 0
                    || submask2[si] == 0
                    || submask2[si + 1] == 0
                {
                    weight += BAD_REGION_PENALTY;
                }
                graph.add_edges(v, v + 1, weight, weight);
            }
            if y < sub_h - 1 {
                let mut weight = norm_l2_sq(subimg1[si], subimg2[si])
                    + norm_l2_sq(subimg1[si + sub_w], subimg2[si + sub_w])
                    + WEIGHT_EPS;
                if submask1[si] == 0
                    || submask1[si + sub_w] == 0
                    || submask2[si] == 0
                    || submask2[si + sub_w] == 0
                {
                    weight += BAD_REGION_PENALTY;
                }
                graph.add_edges(v, v + sub_w as i32, weight, weight);
            }
        }
    }

    graph.max_flow();

    for y in 0..roi_h {
        for x in 0..roi_w {
            let si = ((y + GAP) as usize) * sub_w + (x + GAP) as usize;
            let m1 = (roi_y - tl1.1 + y) as usize * img1.width + (roi_x - tl1.0 + x) as usize;
            let m2 = (roi_y - tl2.1 + y) as usize * img2.width + (roi_x - tl2.0 + x) as usize;
            if graph.in_source_segment(si as i32) {
                if mask1.data[m1] != 0 {
                    mask2.data[m2] = 0;
                }
            } else if mask2.data[m2] != 0 {
                mask1.data[m1] = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_flow_tiny_graph() {
        // 2 vertices: v0 strongly source, v1 strongly sink, weak middle edge.
        let mut g = GcGraph::new(2, 1);
        let a = g.add_vtx();
        let b = g.add_vtx();
        g.add_term_weights(a, 10.0, 0.0);
        g.add_term_weights(b, 0.0, 10.0);
        g.add_edges(a, b, 1.0, 1.0);
        let flow = g.max_flow();
        assert!((flow - 1.0).abs() < 1e-6);
        assert!(g.in_source_segment(a));
        assert!(!g.in_source_segment(b));
    }

    #[test]
    fn seam_splits_overlap() {
        // Two identical flat images overlapping by half: every overlap pixel
        // must end up in exactly one mask.
        let img = PixelImage::new(8, 4, 3, vec![128u8; 8 * 4 * 3]);
        let images = vec![img.clone(), img];
        let corners = vec![(0, 0), (4, 0)];
        let mut masks = vec![
            GrayImage::new(8, 4, vec![255; 32]),
            GrayImage::new(8, 4, vec![255; 32]),
        ];
        find_seams_graph_cut_color(&images, &corners, &mut masks);
        for y in 0..4usize {
            for x in 4..8usize {
                let a = masks[0].data[y * 8 + x] != 0;
                let b = masks[1].data[y * 8 + x - 4] != 0;
                assert!(
                    a ^ b,
                    "overlap pixel ({x},{y}) owned by {}",
                    a as u8 + b as u8
                );
            }
        }
    }
}
