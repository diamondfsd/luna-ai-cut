//! FAST-9/16 corner detector — port of OpenCV `FAST_t<16>` (fast.cpp) with
//! `cornerScore<16>` (fast_score.cpp). Detection uses the classic
//! threshold-table + 9-contiguous test; the nonmax score replicates the SIMD
//! formulation (max over all 16 nine-pixel windows of
//! `max(min_window, -max_window) - 1`), which is what shipped OpenCV runs.
//!
//! The FAST algorithm and OpenCV's implementation carry the original BSD
//! notice: Copyright (c) 2006, 2008 Edward Rosten. Redistribution per the
//! 3-clause BSD license; see NOTICE.

// Index-based loops mirror the OpenCV C++ so the port can be diffed against
// the source; iteration order is load-bearing for parity.
#![allow(clippy::needless_range_loop)]

use crate::imgproc::GrayImage;

pub const PATTERN_SIZE: usize = 16;
const K: usize = PATTERN_SIZE / 2; // 8
const N: usize = PATTERN_SIZE + K + 1; // 25

const OFFSETS16: [(i32, i32); 16] = [
    (0, 3),
    (1, 3),
    (2, 2),
    (3, 1),
    (3, 0),
    (3, -1),
    (2, -2),
    (1, -3),
    (0, -3),
    (-1, -3),
    (-2, -2),
    (-3, -1),
    (-3, 0),
    (-3, 1),
    (-2, 2),
    (-1, 3),
];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FastKeypoint {
    pub x: f32,
    pub y: f32,
    pub response: f32,
}

fn make_offsets(row_stride: i32) -> [i32; 25] {
    let mut pixel = [0i32; 25];
    for k in 0..PATTERN_SIZE {
        pixel[k] = OFFSETS16[k].0 + OFFSETS16[k].1 * row_stride;
    }
    for k in PATTERN_SIZE..25 {
        pixel[k] = pixel[k - PATTERN_SIZE];
    }
    pixel
}

/// `cornerScore<16>`: the maximum threshold at which the pixel is still a
/// corner. SIMD-path semantics: over all 16 rotations, windows of 9
/// contiguous differences.
fn corner_score(data: &[u8], center: usize, pixel: &[i32; 25]) -> u8 {
    let v = data[center] as i32;
    let mut d = [0i32; 25];
    for k in 0..N {
        d[k] = v - data[(center as isize + pixel[k] as isize) as usize] as i32;
    }
    let mut q0 = -1000i32;
    let mut q1 = 1000i32;
    for k in 0..16 {
        // min/max over d[k+1..=k+8]
        let mut a = d[k + 1];
        let mut b = d[k + 1];
        for t in 2..=8 {
            a = a.min(d[k + t]);
            b = b.max(d[k + t]);
        }
        q0 = q0.max(a.min(d[k]));
        q0 = q0.max(a.min(d[k + 9]));
        q1 = q1.min(b.max(d[k]));
        q1 = q1.min(b.max(d[k + 9]));
    }
    (q0.max(-q1) - 1).clamp(0, 255) as u8
}

/// Port of `FAST_t<16>` with nonmax suppression always on (ORB's usage).
pub fn fast16(img: &GrayImage, threshold: i32) -> Vec<FastKeypoint> {
    let threshold = threshold.clamp(0, 255);
    let (cols, rows) = (img.width, img.height);
    let mut keypoints = Vec::new();
    if rows < 7 || cols < 7 {
        return keypoints;
    }
    let pixel = make_offsets(cols as i32);

    // threshold_tab[i+255]: 1 if i < -threshold, 2 if i > threshold, else 0.
    let mut tab = [0u8; 512];
    for i in -255i32..=255 {
        tab[(i + 255) as usize] = if i < -threshold {
            1
        } else if i > threshold {
            2
        } else {
            0
        };
    }

    // Rolling 3-row score + corner-position buffers.
    let mut buf = vec![vec![0u8; cols]; 3];
    let mut cpbuf = vec![vec![0usize; cols]; 3];
    let mut ncorners_buf = [0usize; 3];

    for i in 3..rows - 2 {
        let row_base = i * cols;
        // OpenCV: curr = (i-3)%3, prev = (i-4+3)%3, pprev = (i-5+3)%3.
        // Rewritten mod-3-equivalent to avoid unsigned underflow.
        let curr_idx = i % 3;
        buf[curr_idx].fill(0);
        let mut ncorners = 0usize;

        if i < rows - 3 {
            for j in 3..cols - 3 {
                let center = row_base + j;
                let v = img.data[center] as i32;
                let at = |ofs: i32| -> usize { (center as isize + ofs as isize) as usize };
                let t = |px: usize| tab[(img.data[px] as i32 - v + 255) as usize];

                let mut d = t(at(pixel[0])) | t(at(pixel[8]));
                if d == 0 {
                    continue;
                }
                d &= t(at(pixel[2])) | t(at(pixel[10]));
                d &= t(at(pixel[4])) | t(at(pixel[12]));
                d &= t(at(pixel[6])) | t(at(pixel[14]));
                if d == 0 {
                    continue;
                }
                d &= t(at(pixel[1])) | t(at(pixel[9]));
                d &= t(at(pixel[3])) | t(at(pixel[11]));
                d &= t(at(pixel[5])) | t(at(pixel[13]));
                d &= t(at(pixel[7])) | t(at(pixel[15]));

                let mut is_corner = false;
                if d & 1 != 0 {
                    let vt = v - threshold;
                    let mut count = 0;
                    for k in 0..N {
                        let x = img.data[at(pixel[k])] as i32;
                        if x < vt {
                            count += 1;
                            if count > K {
                                is_corner = true;
                                break;
                            }
                        } else {
                            count = 0;
                        }
                    }
                }
                if !is_corner && d & 2 != 0 {
                    let vt = v + threshold;
                    let mut count = 0;
                    for k in 0..N {
                        let x = img.data[at(pixel[k])] as i32;
                        if x > vt {
                            count += 1;
                            if count > K {
                                is_corner = true;
                                break;
                            }
                        } else {
                            count = 0;
                        }
                    }
                }
                if is_corner {
                    cpbuf[curr_idx][ncorners] = j;
                    ncorners += 1;
                    buf[curr_idx][j] = corner_score(&img.data, center, &pixel);
                }
            }
        }
        ncorners_buf[curr_idx] = ncorners;

        if i == 3 {
            continue;
        }
        // Nonmax over the PREVIOUS row's corners against its neighbors.
        let prev_idx = (i + 2) % 3;
        let pprev_idx = (i + 1) % 3;
        let (prev_n, prev_row_y) = (ncorners_buf[prev_idx], i - 1);
        for k in 0..prev_n {
            let j = cpbuf[prev_idx][k];
            let score = buf[prev_idx][j];
            if score > buf[prev_idx][j + 1]
                && score > buf[prev_idx][j - 1]
                && score > buf[pprev_idx][j - 1]
                && score > buf[pprev_idx][j]
                && score > buf[pprev_idx][j + 1]
                && score > buf[curr_idx][j - 1]
                && score > buf[curr_idx][j]
                && score > buf[curr_idx][j + 1]
            {
                keypoints.push(FastKeypoint {
                    x: j as f32,
                    y: prev_row_y as f32,
                    response: score as f32,
                });
            }
        }
    }
    keypoints
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Textured image: corners must be found and nonmax must hold (no two
    /// detections 8-adjacent). NOTE: a perfectly uniform synthetic square is
    /// a degenerate case — all candidates score identically and strict
    /// nonmax suppresses every one of them (OpenCV behaves the same).
    #[test]
    fn detects_corners_on_texture_with_nonmax() {
        let (w, h) = (64, 64);
        let mut state = 42u32;
        let data: Vec<u8> = (0..w * h)
            .map(|_| {
                state = state.wrapping_mul(1103515245).wrapping_add(12345);
                (state >> 16) as u8
            })
            .collect();
        let img = GrayImage::new(w, h, data);
        let kps = fast16(&img, 20);
        assert!(!kps.is_empty());
        for (i, a) in kps.iter().enumerate() {
            for b in kps.iter().skip(i + 1) {
                let adjacent = (a.x - b.x).abs() <= 1.0 && (a.y - b.y).abs() <= 1.0;
                assert!(!adjacent, "nonmax violated: {a:?} vs {b:?}");
            }
        }
    }

    #[test]
    fn flat_image_has_no_corners() {
        let img = GrayImage::new(32, 32, vec![128; 32 * 32]);
        assert!(fast16(&img, 20).is_empty());
    }
}
