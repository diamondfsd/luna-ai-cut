use std::ops::{Add, Div, Mul, Neg, Sub};

use bridge::export;
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};

use crate::frame_rate::FrameRate;

#[export]
pub const TICKS_PER_SECOND: i64 = 120_000;
const TICKS_PER_SECOND_F64: f64 = TICKS_PER_SECOND as f64;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct MediaTime(i64);

impl MediaTime {
    pub const ZERO: Self = Self(0);
    pub const ONE_TICK: Self = Self(1);

    pub const fn from_ticks(ticks: i64) -> Self {
        Self(ticks)
    }

    pub const fn as_ticks(self) -> i64 {
        self.0
    }

    pub fn from_seconds_f64(seconds: f64) -> Option<Self> {
        if !seconds.is_finite() {
            return None;
        }

        let ticks = (seconds * TICKS_PER_SECOND_F64).round().to_i64()?;
        Some(Self(ticks))
    }

    pub fn to_seconds_f64(self) -> f64 {
        self.0.to_f64().unwrap_or(0.0) / TICKS_PER_SECOND_F64
    }

    pub fn from_frame(frame: i64, rate: FrameRate) -> Option<Self> {
        let ticks_per_frame = rate.ticks_per_frame()?;
        Some(Self(frame.checked_mul(ticks_per_frame)?))
    }

    pub fn to_frame_round(self, rate: FrameRate) -> Option<i64> {
        let ticks_per_frame = rate.ticks_per_frame()?;
        let remainder = self.0.rem_euclid(ticks_per_frame);
        let floor = self.0.div_euclid(ticks_per_frame);
        if remainder * 2 >= ticks_per_frame {
            Some(floor + 1)
        } else {
            Some(floor)
        }
    }

    pub fn to_frame_floor(self, rate: FrameRate) -> Option<i64> {
        let ticks_per_frame = rate.ticks_per_frame()?;
        Some(self.0.div_euclid(ticks_per_frame))
    }

    pub fn round_to_frame(self, rate: FrameRate) -> Option<Self> {
        Self::from_frame(self.to_frame_round(rate)?, rate)
    }

    pub fn floor_to_frame(self, rate: FrameRate) -> Option<Self> {
        let ticks_per_frame = rate.ticks_per_frame()?;
        Some(Self(self.0.div_euclid(ticks_per_frame) * ticks_per_frame))
    }

    pub fn is_frame_aligned(self, rate: FrameRate) -> Option<bool> {
        let ticks_per_frame = rate.ticks_per_frame()?;
        Some(self.0.rem_euclid(ticks_per_frame) == 0)
    }

    pub fn last_frame_time(self, rate: FrameRate) -> Option<Self> {
        if self <= Self::ZERO {
            return Some(Self::ZERO);
        }

        let last_inclusive_tick = self.0.checked_sub(1).unwrap_or(0);
        Self::from_ticks(last_inclusive_tick).floor_to_frame(rate)
    }

    pub fn snapped_seek_time(self, duration: Self, rate: FrameRate) -> Option<Self> {
        let snapped = self.round_to_frame(rate)?;
        Some(snapped.clamp(Self::ZERO, duration))
    }

    pub fn clamp(self, min: Self, max: Self) -> Self {
        Self(self.0.clamp(min.0, max.0))
    }

    pub fn min(self, other: Self) -> Self {
        Self(self.0.min(other.0))
    }

    pub fn max(self, other: Self) -> Self {
        Self(self.0.max(other.0))
    }
}

impl Add for MediaTime {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        Self(self.0 + rhs.0)
    }
}

impl Sub for MediaTime {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        Self(self.0 - rhs.0)
    }
}

impl Neg for MediaTime {
    type Output = Self;

    fn neg(self) -> Self::Output {
        Self(-self.0)
    }
}

impl Mul<i64> for MediaTime {
    type Output = Self;

    fn mul(self, rhs: i64) -> Self::Output {
        Self(self.0 * rhs)
    }
}

impl Div<i64> for MediaTime {
    type Output = Self;

    fn div(self, rhs: i64) -> Self::Output {
        Self(self.0 / rhs)
    }
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeFromSecondsOptions {
    pub seconds: f64,
}

#[export]
pub fn media_time_from_seconds(
    MediaTimeFromSecondsOptions { seconds }: MediaTimeFromSecondsOptions,
) -> Option<MediaTime> {
    MediaTime::from_seconds_f64(seconds)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeToSecondsOptions {
    pub time: MediaTime,
}

#[export]
pub fn media_time_to_seconds(MediaTimeToSecondsOptions { time }: MediaTimeToSecondsOptions) -> f64 {
    time.to_seconds_f64()
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeFromFrameOptions {
    pub frame: i64,
    pub rate: FrameRate,
}

#[export]
pub fn media_time_from_frame(
    MediaTimeFromFrameOptions { frame, rate }: MediaTimeFromFrameOptions,
) -> Option<MediaTime> {
    MediaTime::from_frame(frame, rate)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeToFrameOptions {
    pub time: MediaTime,
    pub rate: FrameRate,
}

#[export]
pub fn media_time_to_frame(
    MediaTimeToFrameOptions { time, rate }: MediaTimeToFrameOptions,
) -> Option<i64> {
    time.to_frame_round(rate)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundToFrameOptions {
    pub time: MediaTime,
    pub rate: FrameRate,
}

#[export]
pub fn round_to_frame(
    RoundToFrameOptions { time, rate }: RoundToFrameOptions,
) -> Option<MediaTime> {
    time.round_to_frame(rate)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FloorToFrameOptions {
    pub time: MediaTime,
    pub rate: FrameRate,
}

#[export]
pub fn floor_to_frame(
    FloorToFrameOptions { time, rate }: FloorToFrameOptions,
) -> Option<MediaTime> {
    time.floor_to_frame(rate)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IsFrameAlignedOptions {
    pub time: MediaTime,
    pub rate: FrameRate,
}

#[export]
pub fn is_frame_aligned(
    IsFrameAlignedOptions { time, rate }: IsFrameAlignedOptions,
) -> Option<bool> {
    time.is_frame_aligned(rate)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastFrameTimeOptions {
    pub duration: MediaTime,
    pub rate: FrameRate,
}

#[export]
pub fn last_frame_time(
    LastFrameTimeOptions { duration, rate }: LastFrameTimeOptions,
) -> Option<MediaTime> {
    duration.last_frame_time(rate)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnappedSeekTimeOptions {
    pub time: MediaTime,
    pub duration: MediaTime,
    pub rate: FrameRate,
}

#[export]
pub fn snapped_seek_time(
    SnappedSeekTimeOptions {
        time,
        duration,
        rate,
    }: SnappedSeekTimeOptions,
) -> Option<MediaTime> {
    time.snapped_seek_time(duration, rate)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeAddOptions {
    pub lhs: MediaTime,
    pub rhs: MediaTime,
}

#[export]
pub fn media_time_add(MediaTimeAddOptions { lhs, rhs }: MediaTimeAddOptions) -> MediaTime {
    lhs + rhs
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeSubOptions {
    pub lhs: MediaTime,
    pub rhs: MediaTime,
}

#[export]
pub fn media_time_sub(MediaTimeSubOptions { lhs, rhs }: MediaTimeSubOptions) -> MediaTime {
    lhs - rhs
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeMinOptions {
    pub lhs: MediaTime,
    pub rhs: MediaTime,
}

#[export]
pub fn media_time_min(MediaTimeMinOptions { lhs, rhs }: MediaTimeMinOptions) -> MediaTime {
    lhs.min(rhs)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeMaxOptions {
    pub lhs: MediaTime,
    pub rhs: MediaTime,
}

#[export]
pub fn media_time_max(MediaTimeMaxOptions { lhs, rhs }: MediaTimeMaxOptions) -> MediaTime {
    lhs.max(rhs)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeClampOptions {
    pub time: MediaTime,
    pub min: MediaTime,
    pub max: MediaTime,
}

#[export]
pub fn media_time_clamp(
    MediaTimeClampOptions { time, min, max }: MediaTimeClampOptions,
) -> MediaTime {
    time.clamp(min, max)
}

#[cfg(test)]
mod tests {
    use crate::frame_rate::FrameRate;

    use super::{MediaTime, TICKS_PER_SECOND};

    #[test]
    fn converts_between_seconds_and_ticks() {
        assert_eq!(
            MediaTime::from_seconds_f64(1.5),
            Some(MediaTime::from_ticks(180_000))
        );
        assert_eq!(MediaTime::from_ticks(180_000).to_seconds_f64(), 1.5);
        assert_eq!(TICKS_PER_SECOND, 120_000);
    }

    #[test]
    fn rejects_non_finite_seconds() {
        assert_eq!(MediaTime::from_seconds_f64(f64::NAN), None);
        assert_eq!(MediaTime::from_seconds_f64(f64::INFINITY), None);
        assert_eq!(MediaTime::from_seconds_f64(f64::NEG_INFINITY), None);
    }

    #[test]
    fn snaps_to_the_nearest_frame() {
        let rate = FrameRate::FPS_30;
        let time = MediaTime::from_seconds_f64(1.26).unwrap();

        assert_eq!(time.to_frame_round(rate), Some(38));
        assert_eq!(
            time.round_to_frame(rate),
            Some(MediaTime::from_ticks(152_000))
        );
    }

    #[test]
    fn floors_to_frame() {
        let rate = FrameRate::FPS_30;
        let ticks_per_frame = 4_000;
        let time = MediaTime::from_ticks(ticks_per_frame * 5 + 1);

        assert_eq!(time.to_frame_floor(rate), Some(5));
        assert_eq!(time.to_frame_round(rate), Some(5));

        let almost_next = MediaTime::from_ticks(ticks_per_frame * 5 + ticks_per_frame / 2);
        assert_eq!(almost_next.to_frame_floor(rate), Some(5));
        assert_eq!(almost_next.to_frame_round(rate), Some(6));
    }

    #[test]
    fn computes_last_frame_time_and_snapped_seek_time() {
        let rate = FrameRate::new(5, 1);
        let duration = MediaTime::from_seconds_f64(10.0).unwrap();

        assert_eq!(
            duration.last_frame_time(rate),
            Some(MediaTime::from_seconds_f64(9.8).unwrap()),
        );
        assert_eq!(
            MediaTime::from_seconds_f64(10.0)
                .unwrap()
                .snapped_seek_time(duration, rate),
            Some(MediaTime::from_seconds_f64(10.0).unwrap()),
        );
    }
}
