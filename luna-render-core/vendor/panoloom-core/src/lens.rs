//! PanoTools-style radial lens model (the a/b/c/d/e of PTGui and Hugin;
//! algorithms only — no code derived from PanoTools/Hugin).
//!
//! Radii are normalized by min(width, height)/2. The polynomial maps the
//! IDEAL (corrected, pinhole) radius to the ACTUAL (distorted image)
//! radius: r_act = r_ideal · (a·r³ + b·r² + c·r + (1−a−b−c)), so r = 1 is
//! a fixed point when a+b+c = 0 is not required. `d`/`e` shift the optical
//! center, in normalized units. All parameters are resolution-independent.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LensParams {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
}

impl LensParams {
    pub fn is_zero(&self) -> bool {
        self.a == 0.0 && self.b == 0.0 && self.c == 0.0 && self.d == 0.0 && self.e == 0.0
    }

    /// Radial factor at ideal radius `r`: a·r³ + b·r² + c·r + (1−a−b−c).
    #[inline]
    pub fn factor(&self, r: f64) -> f64 {
        ((self.a * r + self.b) * r + self.c) * r + (1.0 - self.a - self.b - self.c)
    }

    /// d(r·factor(r))/dr — for the Newton inverse.
    #[inline]
    fn dradial(&self, r: f64) -> f64 {
        ((4.0 * self.a * r + 3.0 * self.b) * r + 2.0 * self.c) * r
            + (1.0 - self.a - self.b - self.c)
    }

    /// Ideal (pinhole) pixel -> actual image pixel for an image of
    /// `w` x `h` pixels whose pinhole principal point is (cx, cy).
    #[inline]
    pub fn distort(&self, x: f64, y: f64, cx: f64, cy: f64, w: f64, h: f64) -> (f64, f64) {
        if self.is_zero() {
            return (x, y);
        }
        let n = 0.5 * w.min(h);
        let ox = cx + self.d * n;
        let oy = cy + self.e * n;
        let (dx, dy) = ((x - ox) / n, (y - oy) / n);
        let r = (dx * dx + dy * dy).sqrt();
        let f = self.factor(r);
        (ox + dx * f * n, oy + dy * f * n)
    }

    /// Actual image pixel -> ideal pixel (Newton on the radial polynomial;
    /// converges in a few iterations for realistic distortion).
    #[inline]
    pub fn undistort(&self, x: f64, y: f64, cx: f64, cy: f64, w: f64, h: f64) -> (f64, f64) {
        if self.is_zero() {
            return (x, y);
        }
        let n = 0.5 * w.min(h);
        let ox = cx + self.d * n;
        let oy = cy + self.e * n;
        let (dx, dy) = ((x - ox) / n, (y - oy) / n);
        let r_act = (dx * dx + dy * dy).sqrt();
        if r_act < 1e-12 {
            return (ox, oy);
        }
        let mut r = r_act;
        for _ in 0..8 {
            let f = r * self.factor(r) - r_act;
            let df = self.dradial(r);
            if df.abs() < 1e-12 {
                break;
            }
            let step = f / df;
            r -= step;
            if step.abs() < 1e-12 {
                break;
            }
        }
        let s = r / r_act;
        (ox + dx * s * n, oy + dy * s * n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_params_are_identity() {
        let l = LensParams::default();
        let (x, y) = l.distort(123.4, 567.8, 500.0, 400.0, 1000.0, 800.0);
        assert_eq!((x, y), (123.4, 567.8));
        let (x, y) = l.undistort(123.4, 567.8, 500.0, 400.0, 1000.0, 800.0);
        assert_eq!((x, y), (123.4, 567.8));
    }

    #[test]
    fn distort_undistort_round_trip() {
        let l = LensParams {
            a: 0.01,
            b: -0.03,
            c: 0.02,
            d: 0.004,
            e: -0.002,
        };
        for &(x, y) in &[
            (10.0, 20.0),
            (999.0, 5.0),
            (500.0, 400.0),
            (130.7, 777.3),
            (0.0, 0.0),
        ] {
            let (dx, dy) = l.distort(x, y, 500.0, 400.0, 1000.0, 800.0);
            let (ux, uy) = l.undistort(dx, dy, 500.0, 400.0, 1000.0, 800.0);
            assert!((ux - x).abs() < 1e-8 && (uy - y).abs() < 1e-8, "({x},{y})");
        }
    }

    #[test]
    fn barrel_pulls_corners_inward() {
        // Negative b (common barrel term): actual radius < ideal radius at
        // the corners.
        let l = LensParams {
            b: -0.05,
            ..Default::default()
        };
        let (dx, _) = l.distort(1000.0, 400.0, 500.0, 400.0, 1000.0, 800.0);
        assert!(dx < 1000.0);
    }
}
