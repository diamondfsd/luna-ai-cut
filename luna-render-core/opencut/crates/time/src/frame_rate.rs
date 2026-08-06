use serde::{Deserialize, Serialize};

use crate::media_time::TICKS_PER_SECOND;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameRate {
    pub numerator: u32,
    pub denominator: u32,
}

impl FrameRate {
    pub const FPS_23_976: Self = Self {
        numerator: 24_000,
        denominator: 1_001,
    };
    pub const FPS_24: Self = Self {
        numerator: 24,
        denominator: 1,
    };
    pub const FPS_25: Self = Self {
        numerator: 25,
        denominator: 1,
    };
    pub const FPS_29_97: Self = Self {
        numerator: 30_000,
        denominator: 1_001,
    };
    pub const FPS_30: Self = Self {
        numerator: 30,
        denominator: 1,
    };
    pub const FPS_48: Self = Self {
        numerator: 48,
        denominator: 1,
    };
    pub const FPS_50: Self = Self {
        numerator: 50,
        denominator: 1,
    };
    pub const FPS_59_94: Self = Self {
        numerator: 60_000,
        denominator: 1_001,
    };
    pub const FPS_60: Self = Self {
        numerator: 60,
        denominator: 1,
    };
    pub const FPS_120: Self = Self {
        numerator: 120,
        denominator: 1,
    };

    pub const fn new(numerator: u32, denominator: u32) -> Self {
        Self {
            numerator,
            denominator,
        }
    }

    pub const fn is_valid(self) -> bool {
        self.numerator > 0 && self.denominator > 0
    }

    pub fn as_f64(self) -> Option<f64> {
        if !self.is_valid() {
            return None;
        }

        Some(f64::from(self.numerator) / f64::from(self.denominator))
    }

    pub fn frame_number_upper_bound(self) -> Option<u32> {
        if !self.is_valid() {
            return None;
        }

        Some(self.numerator.div_ceil(self.denominator))
    }

    pub fn ticks_per_frame(self) -> Option<i64> {
        if !self.is_valid() {
            return None;
        }

        let tick_numerator = TICKS_PER_SECOND.checked_mul(i64::from(self.denominator))?;
        let tick_denominator = i64::from(self.numerator);
        if tick_numerator % tick_denominator != 0 {
            return None;
        }

        Some(tick_numerator / tick_denominator)
    }
}

#[cfg(test)]
mod tests {
    use super::FrameRate;

    #[test]
    fn resolves_ticks_per_standard_frame_rate() {
        assert_eq!(FrameRate::FPS_23_976.ticks_per_frame(), Some(5_005));
        assert_eq!(FrameRate::FPS_24.ticks_per_frame(), Some(5_000));
        assert_eq!(FrameRate::FPS_25.ticks_per_frame(), Some(4_800));
        assert_eq!(FrameRate::FPS_29_97.ticks_per_frame(), Some(4_004));
        assert_eq!(FrameRate::FPS_30.ticks_per_frame(), Some(4_000));
        assert_eq!(FrameRate::FPS_48.ticks_per_frame(), Some(2_500));
        assert_eq!(FrameRate::FPS_50.ticks_per_frame(), Some(2_400));
        assert_eq!(FrameRate::FPS_59_94.ticks_per_frame(), Some(2_002));
        assert_eq!(FrameRate::FPS_60.ticks_per_frame(), Some(2_000));
        assert_eq!(FrameRate::FPS_120.ticks_per_frame(), Some(1_000));
    }

    #[test]
    fn rejects_invalid_or_unsupported_rates() {
        assert_eq!(FrameRate::new(0, 1).ticks_per_frame(), None);
        assert_eq!(FrameRate::new(1, 0).ticks_per_frame(), None);
        assert_eq!(FrameRate::new(7, 3).ticks_per_frame(), None);
    }
}
