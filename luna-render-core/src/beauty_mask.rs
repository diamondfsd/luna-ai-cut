const CLOSE_RADIUS: usize = 1;
const GAUSSIAN_KERNEL: [u32; 3] = [1, 2, 1];
const GAUSSIAN_DIVISOR: u32 = 16;

fn clamped_offset(value: usize, offset: isize, limit: usize) -> usize {
    value
        .saturating_add_signed(offset)
        .min(limit.saturating_sub(1))
}

fn dilate(mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut output = vec![0; mask.len()];
    for y in 0..height {
        for x in 0..width {
            let active = (-(CLOSE_RADIUS as isize)..=CLOSE_RADIUS as isize).any(|dy| {
                (-(CLOSE_RADIUS as isize)..=CLOSE_RADIUS as isize).any(|dx| {
                    let sample_x = clamped_offset(x, dx, width);
                    let sample_y = clamped_offset(y, dy, height);
                    mask[sample_y * width + sample_x] > 0
                })
            });
            output[y * width + x] = if active { 255 } else { 0 };
        }
    }
    output
}

fn erode(mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut output = vec![0; mask.len()];
    for y in 0..height {
        for x in 0..width {
            let active = (-(CLOSE_RADIUS as isize)..=CLOSE_RADIUS as isize).all(|dy| {
                (-(CLOSE_RADIUS as isize)..=CLOSE_RADIUS as isize).all(|dx| {
                    let sample_x = clamped_offset(x, dx, width);
                    let sample_y = clamped_offset(y, dy, height);
                    mask[sample_y * width + sample_x] > 0
                })
            });
            output[y * width + x] = if active { 255 } else { 0 };
        }
    }
    output
}

fn gaussian_feather(mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut horizontal = vec![0u32; mask.len()];
    for y in 0..height {
        for x in 0..width {
            horizontal[y * width + x] = GAUSSIAN_KERNEL
                .iter()
                .enumerate()
                .map(|(index, weight)| {
                    let sample_x = clamped_offset(x, index as isize - 1, width);
                    u32::from(mask[y * width + sample_x]) * weight
                })
                .sum();
        }
    }

    let mut output = vec![0u8; mask.len()];
    for y in 0..height {
        for x in 0..width {
            let value: u32 = GAUSSIAN_KERNEL
                .iter()
                .enumerate()
                .map(|(index, weight)| {
                    let sample_y = clamped_offset(y, index as isize - 1, height);
                    horizontal[sample_y * width + x] * weight
                })
                .sum();
            output[y * width + x] = ((value + GAUSSIAN_DIVISOR / 2) / GAUSSIAN_DIVISOR) as u8;
        }
    }
    output
}

pub(crate) fn smooth_skin_mask(mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    if width == 0 || height == 0 || mask.len() != width * height {
        return mask.to_vec();
    }
    gaussian_feather(
        &erode(&dilate(mask, width, height), width, height),
        width,
        height,
    )
}

#[cfg(test)]
mod tests {
    use super::smooth_skin_mask;

    #[test]
    fn closing_fills_a_single_pixel_gap() {
        let mut mask = vec![255; 7 * 7];
        mask[3 * 7 + 3] = 0;
        let output = smooth_skin_mask(&mask, 7, 7);
        assert_eq!(output[3 * 7 + 3], 255);
    }

    #[test]
    fn feather_creates_a_soft_transition() {
        let mut mask = vec![0; 11 * 11];
        for y in 3..=7 {
            for x in 3..=7 {
                mask[y * 11 + x] = 255;
            }
        }
        let output = smooth_skin_mask(&mask, 11, 11);
        assert_eq!(output[5 * 11 + 5], 255);
        assert!(output[5 * 11 + 2] > 0 && output[5 * 11 + 2] < 255);
        assert_eq!(output[5 * 11], 0);
    }
}
