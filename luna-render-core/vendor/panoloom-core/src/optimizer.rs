//! Control-point optimizer: Levenberg–Marquardt over per-image rotations,
//! a shared focal scale, and the shared PanoTools lens (a, b, c, d, e) —
//! PTGui-style variable flags. Original code (not an OpenCV port): the
//! residual is the difference of the two unit rays a control point maps
//! to, which the stitching BA cannot express because it has no lens model.

#![allow(clippy::needless_range_loop)]

use std::collections::HashMap;

use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};

use crate::cp::ControlPoint;
use crate::estimation::warped_image_scale;
use crate::lens::LensParams;
use crate::pipeline::Alignment;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OptimizeFlags {
    /// Shared focal scale (hfov). Rotations are always optimized.
    pub focal: bool,
    /// Radial distortion a, b, c.
    pub distortion: bool,
    /// Optical-center shift d, e.
    pub shift: bool,
}

impl Default for OptimizeFlags {
    fn default() -> Self {
        Self {
            focal: true,
            distortion: true,
            shift: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeReport {
    pub rms_px_before: f64,
    pub rms_px: f64,
    pub iterations: usize,
    /// Per control point, same order as the input.
    pub cp_errors_px: Vec<f64>,
    pub lens: LensParams,
}

/// exp of a so(3) vector (Rodrigues), f64.
fn exp_so3(w: [f64; 3]) -> [[f64; 3]; 3] {
    let theta = (w[0] * w[0] + w[1] * w[1] + w[2] * w[2]).sqrt();
    if theta < 1e-14 {
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    }
    let (kx, ky, kz) = (w[0] / theta, w[1] / theta, w[2] / theta);
    let (s, c) = theta.sin_cos();
    let v = 1.0 - c;
    [
        [c + kx * kx * v, kx * ky * v - kz * s, kx * kz * v + ky * s],
        [ky * kx * v + kz * s, c + ky * ky * v, ky * kz * v - kx * s],
        [kz * kx * v - ky * s, kz * ky * v + kx * s, c + kz * kz * v],
    ]
}

fn mat_mul(a: &[[f64; 3]; 3], b: &[[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let mut o = [[0.0; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            o[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
        }
    }
    o
}

/// One CP endpoint: (opt_idx into the optimized images, x, y).
type End = (usize, f64, f64);

struct Problem {
    ends: Vec<(End, End)>,
    /// Base rotation, focal, pp, dims per optimized image.
    base_r: Vec<[[f64; 3]; 3]>,
    base_f: Vec<f64>,
    pp: Vec<(f64, f64)>,
    dims: Vec<(f64, f64)>,
    base_lens: LensParams,
    flags: OptimizeFlags,
    n_images: usize,
    /// Index of the gauge image (its rotation stays fixed).
    anchor: usize,
    scale_px: f64,
}

impl Problem {
    /// Parameter layout: 3 rotation params per non-anchor image, then
    /// [log focal scale], [a, b, c], [d, e] per flags.
    fn n_params(&self) -> usize {
        3 * (self.n_images - 1)
            + usize::from(self.flags.focal)
            + 3 * usize::from(self.flags.distortion)
            + 2 * usize::from(self.flags.shift)
    }

    fn unpack(&self, p: &DVector<f64>) -> (Vec<[[f64; 3]; 3]>, f64, LensParams) {
        let mut rs = Vec::with_capacity(self.n_images);
        let mut k = 0usize;
        for i in 0..self.n_images {
            if i == self.anchor {
                rs.push(self.base_r[i]);
            } else {
                let w = [p[k], p[k + 1], p[k + 2]];
                k += 3;
                rs.push(mat_mul(&exp_so3(w), &self.base_r[i]));
            }
        }
        let fscale = if self.flags.focal {
            let s = p[k].exp();
            k += 1;
            s
        } else {
            1.0
        };
        let mut lens = self.base_lens;
        if self.flags.distortion {
            lens.a = p[k];
            lens.b = p[k + 1];
            lens.c = p[k + 2];
            k += 3;
        }
        if self.flags.shift {
            lens.d = p[k];
            lens.e = p[k + 1];
        }
        (rs, fscale, lens)
    }

    fn ray(
        &self,
        img: usize,
        x: f64,
        y: f64,
        rs: &[[[f64; 3]; 3]],
        fscale: f64,
        lens: &LensParams,
    ) -> [f64; 3] {
        let (w, h) = self.dims[img];
        let (px, py) = self.pp[img];
        let (xi, yi) = lens.undistort(x, y, px, py, w, h);
        let f = self.base_f[img] * fscale;
        let v = [(xi - px) / f, (yi - py) / f, 1.0];
        let r = &rs[img];
        let o = [
            r[0][0] * v[0] + r[0][1] * v[1] + r[0][2] * v[2],
            r[1][0] * v[0] + r[1][1] * v[1] + r[1][2] * v[2],
            r[2][0] * v[0] + r[2][1] * v[1] + r[2][2] * v[2],
        ];
        let n = (o[0] * o[0] + o[1] * o[1] + o[2] * o[2]).sqrt();
        [o[0] / n, o[1] / n, o[2] / n]
    }

    fn residuals(&self, p: &DVector<f64>) -> DVector<f64> {
        let (rs, fscale, lens) = self.unpack(p);
        let mut r = DVector::zeros(3 * self.ends.len());
        for (k, ((ia, xa, ya), (ib, xb, yb))) in self.ends.iter().enumerate() {
            let ra = self.ray(*ia, *xa, *ya, &rs, fscale, &lens);
            let rb = self.ray(*ib, *xb, *yb, &rs, fscale, &lens);
            r[3 * k] = (ra[0] - rb[0]) * self.scale_px;
            r[3 * k + 1] = (ra[1] - rb[1]) * self.scale_px;
            r[3 * k + 2] = (ra[2] - rb[2]) * self.scale_px;
        }
        r
    }

    /// Angular error per CP, converted to pixels at each pair's focal.
    fn errors_px(&self, p: &DVector<f64>) -> Vec<f64> {
        let (rs, fscale, lens) = self.unpack(p);
        self.ends
            .iter()
            .map(|((ia, xa, ya), (ib, xb, yb))| {
                let ra = self.ray(*ia, *xa, *ya, &rs, fscale, &lens);
                let rb = self.ray(*ib, *xb, *yb, &rs, fscale, &lens);
                let dot = (ra[0] * rb[0] + ra[1] * rb[1] + ra[2] * rb[2]).clamp(-1.0, 1.0);
                let f = 0.5 * (self.base_f[*ia] + self.base_f[*ib]) * fscale;
                dot.acos() * f
            })
            .collect()
    }
}

/// Optimizes `alignment` in place against the control points. Returns the
/// per-CP errors and the fitted lens. CPs referencing unknown ids fail.
pub fn optimize_control_points(
    alignment: &mut Alignment,
    cps: &[ControlPoint],
    reg_dims: &HashMap<u32, (u32, u32)>,
    flags: &OptimizeFlags,
) -> Result<OptimizeReport, String> {
    if cps.is_empty() {
        return Err("no control points".into());
    }
    // Images that appear in CPs, in alignment order.
    let mut used: Vec<usize> = Vec::new();
    let mut by_id: HashMap<u32, usize> = HashMap::new();
    for cp in cps {
        for id in [cp.img_a, cp.img_b] {
            let ai = alignment
                .images
                .iter()
                .position(|a| a.id == id)
                .ok_or_else(|| format!("control point references unknown image {id}"))?;
            if let std::collections::hash_map::Entry::Vacant(e) = by_id.entry(id) {
                e.insert(used.len());
                used.push(ai);
            }
        }
    }
    if used.len() < 2 {
        return Err("control points must span at least two images".into());
    }

    let mut base_r = Vec::new();
    let mut base_f = Vec::new();
    let mut pp = Vec::new();
    let mut dims = Vec::new();
    for &ai in &used {
        let cam = &alignment.images[ai].camera;
        let id = alignment.images[ai].id;
        let (w, h) = *reg_dims
            .get(&id)
            .ok_or_else(|| format!("missing dimensions for image {id}"))?;
        let mut r = [[0.0f64; 3]; 3];
        for a in 0..3 {
            for b in 0..3 {
                r[a][b] = cam.r[a][b] as f64;
            }
        }
        base_r.push(r);
        base_f.push(cam.focal);
        pp.push((cam.ppx, cam.ppy));
        dims.push((w as f64, h as f64));
    }
    let scale_px = base_f.iter().sum::<f64>() / base_f.len() as f64;

    let ends = cps
        .iter()
        .map(|cp| {
            (
                (by_id[&cp.img_a], cp.x_a, cp.y_a),
                (by_id[&cp.img_b], cp.x_b, cp.y_b),
            )
        })
        .collect();

    let problem = Problem {
        ends,
        base_r,
        base_f,
        pp,
        dims,
        base_lens: alignment.lens,
        flags: *flags,
        n_images: used.len(),
        anchor: 0,
        scale_px,
    };

    // Levenberg–Marquardt with a numeric central-difference Jacobian.
    let np = problem.n_params();
    let mut p = DVector::zeros(np);
    let mut r = problem.residuals(&p);
    let mut cost = r.norm_squared();
    let rms_before = {
        let e = problem.errors_px(&p);
        (e.iter().map(|x| x * x).sum::<f64>() / e.len() as f64).sqrt()
    };
    let mut lambda = 1e-3;
    let mut iterations = 0;
    const STEP: f64 = 1e-6;
    for _ in 0..60 {
        iterations += 1;
        let mut jac = DMatrix::zeros(r.len(), np);
        for c in 0..np {
            let mut pl = p.clone();
            let mut ph = p.clone();
            pl[c] -= STEP;
            ph[c] += STEP;
            let (rl, rh) = (problem.residuals(&pl), problem.residuals(&ph));
            for rr in 0..r.len() {
                jac[(rr, c)] = (rh[rr] - rl[rr]) / (2.0 * STEP);
            }
        }
        let jt = jac.transpose();
        let jtj = &jt * &jac;
        let jtr = &jt * &r;

        let mut improved = false;
        for _ in 0..12 {
            let mut a = jtj.clone();
            for d in 0..np {
                a[(d, d)] += lambda * (jtj[(d, d)].max(1e-12));
            }
            let Some(delta) = a.lu().solve(&(-&jtr)) else {
                lambda *= 5.0;
                continue;
            };
            let p_try = &p + &delta;
            let r_try = problem.residuals(&p_try);
            let cost_try = r_try.norm_squared();
            if cost_try < cost {
                let rel = (cost - cost_try) / cost.max(1e-30);
                p = p_try;
                r = r_try;
                cost = cost_try;
                lambda = (lambda / 3.0).max(1e-12);
                improved = true;
                if rel < 1e-8 {
                    iterations = usize::MAX; // converged marker
                }
                break;
            }
            lambda *= 5.0;
        }
        if !improved || iterations == usize::MAX {
            break;
        }
    }

    // Write back.
    let (rs, fscale, lens) = problem.unpack(&p);
    let errors = problem.errors_px(&p);
    for (k, &ai) in used.iter().enumerate() {
        let cam = &mut alignment.images[ai].camera;
        for a in 0..3 {
            for b in 0..3 {
                cam.r[a][b] = rs[k][a][b] as f32;
            }
        }
    }
    if flags.focal {
        for ai in alignment.images.iter_mut() {
            ai.camera.focal *= fscale;
        }
        let cams: Vec<_> = alignment.images.iter().map(|a| a.camera).collect();
        alignment.warped_image_scale = warped_image_scale(&cams);
    }
    alignment.lens = lens;

    let rms = (errors.iter().map(|x| x * x).sum::<f64>() / errors.len() as f64).sqrt();
    Ok(OptimizeReport {
        rms_px_before: rms_before,
        rms_px: rms,
        iterations: iterations.min(60),
        cp_errors_px: errors,
        lens,
    })
}
