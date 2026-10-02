use super::{EPSILON, FFT_SIZE, FRAME_LENGTH, FRAME_SHIFT, MEL_BINS, SAMPLE_RATE};
use rustfft::{num_complex::Complex, FftPlanner};

pub(super) fn hz_to_mel(frequency: f32) -> f32 {
    1127.0 * (1.0 + frequency / 700.0).ln()
}

pub(super) fn mel_filter_bank() -> Vec<Vec<(usize, f32)>> {
    let bins = FFT_SIZE / 2 + 1;
    let low_mel = hz_to_mel(20.0);
    let high_mel = hz_to_mel(8_000.0);
    let step = (high_mel - low_mel) / (MEL_BINS + 1) as f32;
    let mut filters = vec![Vec::new(); MEL_BINS];
    for (mel_index, filter) in filters.iter_mut().enumerate() {
        let left = low_mel + mel_index as f32 * step;
        let center = left + step;
        let right = center + step;
        for bin in 0..bins {
            let mel = hz_to_mel(bin as f32 * SAMPLE_RATE as f32 / FFT_SIZE as f32);
            let weight = if mel > left && mel <= center {
                (mel - left) / (center - left)
            } else if mel > center && mel < right {
                (right - mel) / (right - center)
            } else {
                0.0
            };
            if weight > 0.0 {
                filter.push((bin, weight));
            }
        }
    }
    filters
}

pub(super) fn compute_fbank(samples: &[f32]) -> Vec<f32> {
    if samples.len() < FRAME_LENGTH {
        return Vec::new();
    }
    let frame_count = (samples.len() - FRAME_LENGTH) / FRAME_SHIFT + 1;
    let filters = mel_filter_bank();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let window: Vec<f32> = (0..FRAME_LENGTH)
        .map(|index| {
            0.54 - 0.46
                * (2.0 * std::f32::consts::PI * index as f32 / (FRAME_LENGTH - 1) as f32).cos()
        })
        .collect();
    let mut output = vec![0.0f32; frame_count * MEL_BINS];
    let mut frame = vec![0.0f32; FRAME_LENGTH];
    let mut spectrum = vec![Complex::new(0.0f32, 0.0f32); FFT_SIZE];
    for frame_index in 0..frame_count {
        let source = &samples[frame_index * FRAME_SHIFT..frame_index * FRAME_SHIFT + FRAME_LENGTH];
        let mean = source.iter().sum::<f32>() / FRAME_LENGTH as f32;
        for (index, value) in source.iter().enumerate() {
            frame[index] = *value * 32768.0 - mean * 32768.0;
        }
        for index in (1..FRAME_LENGTH).rev() {
            frame[index] -= 0.97 * frame[index - 1];
        }
        frame[0] -= 0.97 * frame[0];
        for index in 0..FFT_SIZE {
            spectrum[index] = if index < FRAME_LENGTH {
                Complex::new(frame[index] * window[index], 0.0)
            } else {
                Complex::new(0.0, 0.0)
            };
        }
        fft.process(&mut spectrum);
        for (mel_index, filter) in filters.iter().enumerate() {
            let energy = filter.iter().fold(0.0f32, |sum, (bin, weight)| {
                sum + weight * spectrum[*bin].norm_sqr()
            });
            output[frame_index * MEL_BINS + mel_index] = energy.max(EPSILON).ln();
        }
    }
    output
}

pub(super) fn make_model_features(
    samples: &[f32],
    lfr_window_size: usize,
    lfr_window_shift: usize,
    neg_mean: &[f32],
    inv_stddev: &[f32],
) -> Vec<f32> {
    let fbank = compute_fbank(samples);
    let frame_count = fbank.len() / MEL_BINS;
    if frame_count == 0 {
        return Vec::new();
    }
    let output_frames = 1 + (frame_count - 1) / lfr_window_shift;
    let feature_dim = MEL_BINS * lfr_window_size;
    let mut output = vec![0.0f32; output_frames * feature_dim];
    for output_index in 0..output_frames {
        let center = output_index * lfr_window_shift;
        let left_context = (lfr_window_size - 1) / 2;
        for window_index in 0..lfr_window_size {
            let source_index = if window_index + center < left_context {
                0
            } else {
                let source_index = center + window_index - left_context;
                source_index.min(frame_count - 1)
            };
            let destination = output_index * feature_dim + window_index * MEL_BINS;
            let source = source_index * MEL_BINS;
            output[destination..destination + MEL_BINS]
                .copy_from_slice(&fbank[source..source + MEL_BINS]);
        }
    }
    for frame in 0..output_frames {
        for feature in 0..feature_dim {
            let index = frame * feature_dim + feature;
            output[index] = (output[index] + neg_mean[feature]) * inv_stddev[feature];
        }
    }
    output
}

pub(super) fn detokenize(ids: &[usize], vocab: &[String]) -> String {
    let mut text = String::new();
    let mut mergeable = false;
    let mut previous_was_ascii = false;
    for &id in ids {
        let Some(token) = vocab.get(id) else { continue };
        if token == "<blank>" || token == "<s>" || token == "</s>" {
            continue;
        }
        let is_continuation = token.ends_with("@@");
        let token = token.trim_end_matches("@@").replace('\u{2581}', " ");
        let is_ascii = token.as_bytes().first().is_some_and(|value| *value < 0x80);
        if is_continuation {
            if !mergeable && !text.is_empty() && !text.ends_with(' ') {
                text.push(' ');
            }
            text.push_str(&token);
            mergeable = true;
        } else if is_ascii {
            if !mergeable && !text.is_empty() && !text.ends_with(' ') {
                text.push(' ');
            }
            text.push_str(&token);
            mergeable = false;
        } else {
            if previous_was_ascii && !text.ends_with(' ') {
                text.push(' ');
            }
            text.push_str(&token);
            mergeable = false;
        }
        previous_was_ascii = is_ascii;
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}
