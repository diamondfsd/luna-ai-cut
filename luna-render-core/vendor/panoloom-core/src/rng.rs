//! Bit-exact port of `cv::RNG` — OpenCV's multiply-with-carry generator.
//!
//! Source: `opencv2/core/operations.hpp` (4.x branch), `class RNG` declared in
//! `opencv2/core.hpp`. The state transition is
//!
//! ```c
//! state = (uint64)(unsigned)state * CV_RNG_COEFF + (unsigned)(state >> 32);
//! return (unsigned)state;
//! ```
//!
//! Note the exact carry formulation: only the LOW 32 bits of the state are
//! multiplied by the coefficient, and the HIGH 32 bits are added back as the
//! carry. This is *not* `state * COEFF + (state >> 32)` over the full 64-bit
//! state — porting it that way silently diverges after the first step.
//!
//! `RANSACPointSetRegistrator::run` seeds this with `(uint64)-1`
//! (`ptsetreg.cpp`), which makes OpenCV's RANSAC fully deterministic; a
//! bit-exact port of this generator is what lets the Rust RANSAC pick the
//! same random subsets — and therefore the same inlier sets — as OpenCV.

/// `CV_RNG_COEFF` from `opencv2/core/cvdef.h`.
const CV_RNG_COEFF: u64 = 4164903690;

/// Bit-exact replica of `cv::RNG` (multiply-with-carry).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CvRng {
    state: u64,
}

impl CvRng {
    /// `RNG::RNG(uint64 state)`: a zero seed is replaced by `0xffffffff` to
    /// avoid the all-zero sequence.
    pub fn new(state: u64) -> Self {
        Self {
            state: if state == 0 { 0xffff_ffff } else { state },
        }
    }

    /// `RNG::next()`: advance the MWC state, return the low 32 bits.
    ///
    /// The multiply cannot overflow u64 mathematically
    /// (`(2^32-1)*(CV_RNG_COEFF+1) < 2^64`), but wrapping ops are used to
    /// mirror C's unsigned semantics exactly.
    #[inline]
    #[allow(clippy::should_implement_trait)] // named after cv::RNG::next
    pub fn next(&mut self) -> u32 {
        self.state = (self.state as u32 as u64)
            .wrapping_mul(CV_RNG_COEFF)
            .wrapping_add(self.state >> 32);
        self.state as u32
    }

    /// `RNG::uniform(int a, int b)`: uniformly distributed integer from
    /// `[a, b)`.
    ///
    /// The C++ body is `a == b ? a : (int)(next() % (b - a) + a)`. In C the
    /// `int` difference `b - a` is converted to `unsigned` for the `%`
    /// (usual arithmetic conversions), `a` is converted to `unsigned` for
    /// the `+`, and the final result is truncated back to `int`. All of
    /// that wrapping behaviour is reproduced here.
    #[inline]
    pub fn uniform_int(&mut self, a: i32, b: i32) -> i32 {
        if a == b {
            a
        } else {
            let diff = b.wrapping_sub(a) as u32;
            (self.next() % diff).wrapping_add(a as u32) as i32
        }
    }

    /// Raw state accessor (test/debug aid).
    pub fn state(&self) -> u64 {
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // All expected sequences below were produced by a C program containing a
    // verbatim copy of the cv::RNG inline implementation from
    // opencv2/core/operations.hpp (4.x), compiled with clang on the same
    // machine. See tools notes in the RANSAC port.

    #[test]
    fn next_seed_u64_max() {
        // RNG((uint64)-1) — the exact seed RANSACPointSetRegistrator uses.
        let mut rng = CvRng::new(u64::MAX);
        let expected: [u32; 10] = [
            130063605, 3133359004, 2578348940, 925327173, 1080261831, 2946015512, 94037301,
            2298661280, 300167573, 43921110,
        ];
        for &e in &expected {
            assert_eq!(rng.next(), e);
        }
    }

    #[test]
    fn next_seed_12345() {
        let mut rng = CvRng::new(12345);
        let expected: [u32; 10] = [
            682552634, 3453542663, 967509983, 607624631, 1008657709, 1829188414, 4054305612,
            1704611215, 747419472, 664386699,
        ];
        for &e in &expected {
            assert_eq!(rng.next(), e);
        }
    }

    #[test]
    fn zero_seed_becomes_0xffffffff() {
        // RNG(0) must behave exactly like RNG(0xffffffff).
        let mut rng = CvRng::new(0);
        let expected: [u32; 10] = [
            130063606, 3003295397, 3870020839, 1350273629, 4024955497, 3216027310, 1172977286,
            1125683993, 3469450876, 869437529,
        ];
        for &e in &expected {
            assert_eq!(rng.next(), e);
        }
        assert_eq!(CvRng::new(0), CvRng::new(0xffff_ffff));
    }

    #[test]
    fn state_trace_validates_carry_form() {
        // Full 64-bit state after each step: catches the "multiply the whole
        // state" mis-port, which produces different high words immediately.
        let mut rng = CvRng::new(u64::MAX);
        let expected: [u64; 4] = [
            17888125139669785845,
            541702392564106140,
            13050138477980449676,
            10738575017352060741,
        ];
        for &e in &expected {
            rng.next();
            assert_eq!(rng.state(), e);
        }
    }

    #[test]
    fn uniform_int_0_50() {
        let mut rng = CvRng::new(u64::MAX);
        let expected: [i32; 16] = [5, 4, 40, 23, 31, 12, 1, 30, 23, 10, 35, 44, 46, 49, 18, 3];
        for &e in &expected {
            assert_eq!(rng.uniform_int(0, 50), e);
        }
    }

    #[test]
    fn uniform_int_negative_range() {
        let mut rng = CvRng::new(u64::MAX);
        let expected: [i32; 16] = [-5, -6, -10, 3, 1, 2, -9, -10, 3, 0, -5, 4, -4, -1, 8, -7];
        for &e in &expected {
            assert_eq!(rng.uniform_int(-10, 10), e);
        }
    }

    #[test]
    fn uniform_int_degenerate_range() {
        // a == b returns a WITHOUT advancing the state.
        let mut rng = CvRng::new(u64::MAX);
        for _ in 0..4 {
            assert_eq!(rng.uniform_int(5, 5), 5);
        }
        assert_eq!(rng.state(), u64::MAX);
    }
}
