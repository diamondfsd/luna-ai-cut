//! Scalar math primitives ported from OpenCV core. Bit-compatibility here is
//! what makes every downstream stage comparable with the oracle
//! (see docs/pipeline.md).

/// OpenCV `cvRound`: round half to even (SSE `cvtsd2si` semantics).
/// Rust's `round()` rounds half away from zero — do NOT substitute it.
#[inline]
pub fn cv_round_f32(x: f32) -> i32 {
    x.round_ties_even() as i32
}

#[inline]
pub fn cv_round_f64(x: f64) -> i32 {
    x.round_ties_even() as i32
}

#[inline]
pub fn cv_floor(x: f64) -> i32 {
    x.floor() as i32
}

#[inline]
pub fn cv_ceil(x: f64) -> i32 {
    x.ceil() as i32
}

const DBL_EPSILON_F32: f32 = f64::EPSILON as f32;

/// OpenCV `fastAtan2`: polynomial atan2 approximation, degrees in [0, 360).
/// Accuracy ~0.3°; ORB keypoint angles use THIS, not libm atan2 — using the
/// exact polynomial keeps rBRIEF descriptor bits comparable.
/// Port of `atan_f32` in modules/core/src/mathfuncs_core.simd.hpp.
pub fn fast_atan2(y: f32, x: f32) -> f32 {
    // Constants exactly as written in OpenCV (f64 expressions cast to f32).
    let p1 = (0.999_787_841_279_480_7_f64 * (180.0 / std::f64::consts::PI)) as f32;
    let p3 = (-0.325_808_397_464_097_5_f64 * (180.0 / std::f64::consts::PI)) as f32;
    let p5 = (0.155_578_651_846_328_1_f64 * (180.0 / std::f64::consts::PI)) as f32;
    let p7 = (-0.044_326_555_547_921_28_f64 * (180.0 / std::f64::consts::PI)) as f32;

    let ax = x.abs();
    let ay = y.abs();
    let mut a = if ax >= ay {
        let c = ay / (ax + DBL_EPSILON_F32);
        let c2 = c * c;
        (((p7 * c2 + p5) * c2 + p3) * c2 + p1) * c
    } else {
        let c = ax / (ay + DBL_EPSILON_F32);
        let c2 = c * c;
        90.0 - (((p7 * c2 + p5) * c2 + p3) * c2 + p1) * c
    };
    if x < 0.0 {
        a = 180.0 - a;
    }
    if y < 0.0 {
        a = 360.0 - a;
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cv_round_is_bankers() {
        assert_eq!(cv_round_f32(0.5), 0);
        assert_eq!(cv_round_f32(1.5), 2);
        assert_eq!(cv_round_f32(2.5), 2);
        assert_eq!(cv_round_f32(-0.5), 0);
        assert_eq!(cv_round_f32(-1.5), -2);
        assert_eq!(cv_round_f32(2.4), 2);
        assert_eq!(cv_round_f64(3.5), 4);
    }

    #[test]
    #[allow(clippy::excessive_precision)] // literals are exact cv2 outputs
    fn fast_atan2_matches_opencv() {
        // Reference values from cv2.fastAtan2 (opencv-python 4.14).
        let cases: [(f32, f32, f32); 8] = [
            (1.0, 1.0, 44.990455627441406),
            (3.0, -4.0, 143.13629150390625),
            (-2.5, 7.0, 340.342041015625),
            (0.0, 0.0, 0.0),
            (-1.0, 0.0, 270.0),
            (0.0, -1.0, 180.0),
            (1e-8, 1.0, 5.728362566514988e-7),
            (100.0, 3.0, 88.28199768066406),
        ];
        for (y, x, expected) in cases {
            let got = fast_atan2(y, x);
            assert!(
                (got - expected).abs() < 1e-4,
                "fastAtan2({y}, {x}) = {got}, expected {expected}"
            );
        }
    }
}
