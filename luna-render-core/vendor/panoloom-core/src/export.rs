//! Full-resolution banded export.
//!
//! A full-res panorama (e.g. 17000x8500) cannot be composed in one piece in
//! wasm memory (MultiBandBlender pyramids alone would exceed 1.5 GB), so
//! the canvas is composited in horizontal BANDS: for each band, only the
//! contributing full-resolution sources are needed, each warped just for
//! that band's rows (`SphericalWarper::warp_rows`). Seams and gains are
//! computed once at seam scale (shared `pipeline::seam_stage`, including
//! the wrap unrolling), and the finished canvas is JPEG-encoded in wasm so
//! only the compressed bytes cross to JS.

#![allow(clippy::needless_range_loop)]

use std::collections::HashMap;

use crate::blend::{num_bands_for, result_roi, MultiBandBlender};
use crate::camera::CameraParams;
use crate::exposure::{GainMap, RgbImage};
use crate::imgproc::{resize_bilinear_rows, GrayImage};
use crate::pipeline::{
    camera_k_scaled, dilate3, seam_stage, snap_scale, Alignment, SeamStage, SourceImage,
};
use crate::warp::{Border, Interp, PixelImage, SphericalWarper};

/// Band height in canvas rows (before padding). Padding must exceed the
/// multiband blend influence radius (~2^bands).
const BAND_H: usize = 768;
const BAND_PAD: usize = 256;

/// Largest compose canvas (RGB + coverage) an export may allocate.
///
/// wasm32 tops out at a 4 GB address space, shared with the registration
/// sources already resident, the full-resolution band sources, and the JPEG
/// buffer — so the canvas gets a fraction of it. Native builds have room to
/// spare and are limited only to keep the failure mode consistent.
#[cfg(target_arch = "wasm32")]
const MAX_CANVAS_BYTES: u64 = 1_250_000_000;
#[cfg(not(target_arch = "wasm32"))]
const MAX_CANVAS_BYTES: u64 = 32_000_000_000;

/// Widest 2:1 panorama this build can compose, from [`MAX_CANVAS_BYTES`].
/// The UI offers it so a set too large for full resolution still has a
/// one-click best option rather than a guess.
pub fn max_export_width() -> usize {
    (((MAX_CANVAS_BYTES / 2) as f64).sqrt() as usize) & !1
}

pub struct ExportBand {
    pub y0: usize,
    pub y1: usize,
    /// Source image ids whose pixels this band needs.
    pub needed: Vec<u32>,
}

struct EntryGeom {
    src_idx: usize,
    /// Compose-scale warp ROI (x with dup offset applied, y, w, h).
    roi: (i32, i32, i32, i32),
}

pub struct Exporter {
    // Layout.
    canvas_w: usize,
    canvas_h: usize,
    compose_scale: f64,
    ids: Vec<u32>,
    cameras: Vec<CameraParams>,
    /// K multiplier per aligned image for FULL-RES sources.
    k_mul: Vec<f64>,
    lens: crate::lens::LensParams,
    entries: Vec<EntryGeom>,
    gain_maps: Vec<GainMap>,
    seam_masks_dilated: Vec<GrayImage>,
    bands: Vec<ExportBand>,
    strip: (i32, i32, usize, usize),
    ext_start: i32,
    ext_trim: i32,
    originals_end: i32,
    mb_bands: usize,
    // State.
    canvas: Vec<u8>,
    covered: Vec<u8>, // 1 byte per canvas pixel (coverage)
    loaded: HashMap<u32, PixelImage>,
    bands_done: Vec<bool>,
    /// Coverage crop (x, y, w, h) in canvas coordinates.
    crop: (usize, usize, usize, usize),
}

impl Exporter {
    /// `reg_sources` are the registration-scale images already in the
    /// engine (for the seam stage); `full_sizes` maps every aligned id to
    /// its ORIGINAL pixel dimensions; `target_width` caps the canvas.
    /// `cached_stage` is a [`SeamStage`] already computed for exactly these
    /// inputs, or None to compute one. Graph-cut seams take minutes on a
    /// large set and a preview has usually already paid for them.
    pub fn new(
        reg_sources: &[SourceImage],
        alignment: &Alignment,
        user_masks: &[Option<&GrayImage>],
        full_sizes: &[(u32, u32, u32)],
        target_width: usize,
        cached_stage: Option<&SeamStage>,
    ) -> Result<Self, String> {
        let n = alignment.images.len();
        let mut srcs: Vec<&PixelImage> = Vec::with_capacity(n);
        let mut k_mul = Vec::with_capacity(n);
        let mut ids = Vec::with_capacity(n);
        let mut cameras = Vec::with_capacity(n);
        for ai in &alignment.images {
            let s = reg_sources
                .iter()
                .find(|s| s.id == ai.id)
                .ok_or("missing registration source")?;
            let (_, fw, _fh) = full_sizes
                .iter()
                .find(|(id, _, _)| *id == ai.id)
                .ok_or("missing full size")?;
            srcs.push(&s.rgb);
            k_mul.push(*fw as f64 / s.rgb.width as f64);
            ids.push(ai.id);
            cameras.push(ai.camera);
        }

        // Canvas scale: full native resolution (largest source factor),
        // capped by the requested width.
        let native = alignment.warped_image_scale * k_mul.iter().cloned().fold(1.0, f64::max);
        let native_w = (2.0 * std::f64::consts::PI * native).floor() as usize;
        let compose_scale = snap_scale(if native_w > target_width {
            target_width as f64 / (2.0 * std::f64::consts::PI)
        } else {
            native
        });
        let canvas_w = (2.0 * std::f64::consts::PI * compose_scale).floor() as usize & !1;
        let canvas_h = canvas_w / 2;

        // Refuse a canvas the address space cannot hold, BEFORE doing the
        // seam stage and long before `composite_band` would allocate it.
        //
        // This is not hypothetical: 137 shots at 12MP wants a 50113x25057
        // canvas — 4.7 GB of RGB plus coverage, against wasm32's 4 GB total.
        // The allocation traps, and because wasm builds abort rather than
        // unwind, the borrow guard on the exported object is never released:
        // every later call then fails with "recursive use of an object
        // detected", which says nothing about what actually went wrong.
        let canvas_bytes = (canvas_w as u64) * (canvas_h as u64) * 4;
        if canvas_bytes > MAX_CANVAS_BYTES {
            // Largest even width whose 2:1 canvas fits the budget.
            let fits = max_export_width();
            return Err(format!(
                "panorama would be {canvas_w}x{canvas_h} ({:.1} GB), over the {:.1} GB \
                 this build can address — export at {fits} px or less",
                canvas_bytes as f64 / (1u64 << 30) as f64,
                MAX_CANVAS_BYTES as f64 / (1u64 << 30) as f64,
            ));
        }

        // Seam stage (shared with preview): gains + unrolled seams.
        let computed;
        let stage = match cached_stage {
            Some(s) => s,
            None => {
                computed = seam_stage(&srcs, alignment, user_masks);
                &computed
            }
        };
        let seam_masks_dilated: Vec<GrayImage> = stage.e_seam_masks.iter().map(dilate3).collect();

        // Compose-scale ROIs per entry. K multiplier for a full-res source:
        // camera params are in registration px, the full-res source is
        // k_mul times larger, and the warper output scale handles the rest.
        let mut warper = SphericalWarper::new(compose_scale as f32);
        let period_comp = canvas_w as i32;
        let mut entries = Vec::with_capacity(stage.entries.len());
        for &(i, dup) in &stage.entries {
            let (_, fw, fh) = full_sizes.iter().find(|(id, _, _)| *id == ids[i]).unwrap();
            let k = camera_k_scaled(&cameras[i], k_mul[i]);
            warper.set_lens(
                alignment.lens,
                k[0][2] as f64,
                k[1][2] as f64,
                *fw as f64,
                *fh as f64,
            );
            let (x, y, w, h) = warper.warp_roi(*fw as usize, *fh as usize, &k, &cameras[i].r);
            entries.push(EntryGeom {
                src_idx: i,
                roi: (x + if dup { period_comp } else { 0 }, y, w, h),
            });
        }

        let e_corners: Vec<(i32, i32)> = entries.iter().map(|e| (e.roi.0, e.roi.1)).collect();
        let e_sizes: Vec<(i32, i32)> = entries.iter().map(|e| (e.roi.2, e.roi.3)).collect();
        let strip = result_roi(&e_corners, &e_sizes);
        let originals_end: i32 = entries
            .iter()
            .zip(&stage.entries)
            .filter(|(_, &(_, dup))| !dup)
            .map(|(e, _)| e.roi.0 + e.roi.2)
            .max()
            .unwrap()
            - strip.0;
        let ext_start: i32 = entries
            .iter()
            .zip(&stage.entries)
            .filter(|(_, &(_, dup))| dup)
            .map(|(e, _)| e.roi.0 - strip.0)
            .min()
            .unwrap_or(strip.2 as i32);
        let ext_len = strip.2 as i32 - ext_start;
        let ext_trim = 64.min(ext_len / 2).max(0);

        // Coverage crop: the JPEG carries only covered rows (and columns,
        // when the pano doesn't wrap); GPano croppedArea* fields tell
        // viewers where the crop sits on the full sphere.
        //
        // Warp bounding boxes over-report vertically (a high-pitch shot's
        // box reaches the pole even where its mask is empty), so the row
        // range is refined from the SEAM MASKS — actual coverage — mapped
        // proportionally into each entry's compose ROI, padded by the
        // multiband pyramid spread.
        let full_wrap = stage.entries.iter().any(|&(_, dup)| dup);
        let mb_bands = num_bands_for(strip.2, canvas_h);
        let margin = 1i32 << mb_bands;
        let (mut cov_y0, mut cov_y1) = (i32::MAX, i32::MIN);
        for (e, geom) in entries.iter().enumerate() {
            let m = &seam_masks_dilated[e];
            let mut rows = (0..m.height).filter(|&r| {
                m.data[r * m.width..(r + 1) * m.width]
                    .iter()
                    .any(|&v| v != 0)
            });
            if let Some(r0) = rows.next() {
                let r1 = rows.next_back().unwrap_or(r0);
                let scale_y = geom.roi.3 as f64 / m.height as f64;
                cov_y0 = cov_y0.min(geom.roi.1 + (r0 as f64 * scale_y).floor() as i32);
                cov_y1 = cov_y1.max(geom.roi.1 + ((r1 + 1) as f64 * scale_y).ceil() as i32);
            }
        }
        let (bbox_y0, bbox_y1) = (
            entries.iter().map(|e| e.roi.1).min().unwrap_or(0),
            entries
                .iter()
                .map(|e| e.roi.1 + e.roi.3)
                .max()
                .unwrap_or(canvas_h as i32),
        );
        let cy0 = (cov_y0.saturating_sub(margin))
            .max(bbox_y0)
            .clamp(0, canvas_h as i32) as usize;
        let cy1 = (cov_y1.saturating_add(margin))
            .min(bbox_y1)
            .clamp(cy0 as i32, canvas_h as i32) as usize;
        let off_x = (-std::f64::consts::PI * compose_scale) as i32;
        let (cx0, cw) = if full_wrap {
            (0usize, canvas_w)
        } else {
            // Content occupies strip columns [0, originals_end); crop only
            // when that maps to a contiguous canvas range (no wrap-around).
            let w = canvas_w as i32;
            let s = (((strip.0 - off_x) % w) + w) % w;
            let len = originals_end.clamp(0, w);
            if s + len <= w {
                (s as usize, len as usize)
            } else {
                (0, canvas_w)
            }
        };
        let crop = (cx0, cy0, cw, cy1.max(cy0 + 1) - cy0);

        // Bands over the cropped canvas rows; needed = sources of entries
        // intersecting the padded band (v coordinates == canvas rows).
        let mut bands = Vec::new();
        let mut y = cy0;
        while y < cy1 {
            let y1 = (y + BAND_H).min(cy1);
            let (py0, py1) = (y.saturating_sub(BAND_PAD) as i32, (y1 + BAND_PAD) as i32);
            let mut needed: Vec<u32> = entries
                .iter()
                .filter(|e| e.roi.1 < py1 && e.roi.1 + e.roi.3 > py0)
                .map(|e| ids[e.src_idx])
                .collect();
            needed.sort_unstable();
            needed.dedup();
            bands.push(ExportBand { y0: y, y1, needed });
            y = y1;
        }

        Ok(Self {
            canvas_w,
            canvas_h,
            crop,
            compose_scale,
            ids,
            cameras,
            k_mul,
            lens: alignment.lens,
            entries,
            gain_maps: stage.compensator.gain_maps().to_vec(),
            seam_masks_dilated,
            bands_done: vec![false; bands.len()],
            bands,
            strip,
            ext_start,
            ext_trim,
            originals_end,
            mb_bands,
            canvas: Vec::new(),
            covered: Vec::new(),
            loaded: HashMap::new(),
        })
    }

    pub fn canvas_size(&self) -> (usize, usize) {
        (self.canvas_w, self.canvas_h)
    }

    /// Coverage crop in canvas coordinates: (x, y, width, height). The
    /// encoded JPEG spans exactly this region.
    pub fn crop(&self) -> (usize, usize, usize, usize) {
        self.crop
    }

    pub fn bands(&self) -> &[ExportBand] {
        &self.bands
    }

    pub fn set_full_image(&mut self, id: u32, img: PixelImage) -> Result<(), String> {
        if !self.ids.contains(&id) {
            return Err("unknown image id".into());
        }
        self.loaded.insert(id, img);
        Ok(())
    }

    pub fn drop_full_image(&mut self, id: u32) {
        self.loaded.remove(&id);
    }

    pub fn composite_band(&mut self, b: usize) -> Result<(), String> {
        let (band_y0, band_y1, needed) = {
            let band = self.bands.get(b).ok_or("band out of range")?;
            (band.y0, band.y1, band.needed.clone())
        };
        for id in &needed {
            if !self.loaded.contains_key(id) {
                return Err(format!("image {id} not loaded"));
            }
        }
        if self.canvas.is_empty() {
            self.canvas = vec![0u8; self.canvas_w * self.canvas_h * 3];
            self.covered = vec![0u8; self.canvas_w * self.canvas_h];
        }

        let (py0, py1) = (
            band_y0.saturating_sub(BAND_PAD) as i32,
            ((band_y1 + BAND_PAD).min(self.canvas_h)) as i32,
        );
        let mut blender = MultiBandBlender::new(self.mb_bands);
        blender.prepare(self.strip.0, py0, self.strip.2, (py1 - py0) as usize);

        let mut warper = SphericalWarper::new(self.compose_scale as f32);
        for e in 0..self.entries.len() {
            let geom = &self.entries[e];
            let i = geom.src_idx;
            let (rx, ry, rw, rh) = geom.roi;
            if ry >= py1 || ry + rh <= py0 {
                continue;
            }
            let src = &self.loaded[&self.ids[i]];
            let ry0 = (py0 - ry).max(0) as usize;
            let ry1 = ((py1 - ry).max(0) as usize).min(rh as usize);
            if ry1 <= ry0 {
                continue;
            }

            let k = camera_k_scaled(&self.cameras[i], self.k_mul[i]);
            warper.set_lens(
                self.lens,
                k[0][2] as f64,
                k[1][2] as f64,
                src.width as f64,
                src.height as f64,
            );
            let (_, w_img) = warper.warp_rows(
                src,
                &k,
                &self.cameras[i].r,
                Interp::Linear,
                Border::Reflect,
                ry0,
                ry1,
            );
            let mask_src = PixelImage::new(
                src.width,
                src.height,
                1,
                vec![255u8; src.width * src.height],
            );
            let (_, w_mask) = warper.warp_rows(
                &mask_src,
                &k,
                &self.cameras[i].r,
                Interp::Nearest,
                Border::Constant0,
                ry0,
                ry1,
            );

            // Gains (seam-scale block maps) sampled for these ROI rows.
            let mut rgb = RgbImage::new(w_img.width, w_img.height, w_img.data);
            apply_gain_rows(&self.gain_maps[i], &mut rgb, rw as usize, rh as usize, ry0);

            // Seam mask rows for this entry, upscaled to the ROI dims.
            let up = resize_bilinear_rows(
                &self.seam_masks_dilated[e],
                rw as usize,
                rh as usize,
                ry0,
                ry1,
            );
            let mut final_mask = vec![0u8; w_mask.width * w_mask.height];
            for p in 0..final_mask.len() {
                final_mask[p] = up.data[p] & w_mask.data[p];
            }
            blender.feed(
                &rgb.data,
                rgb.width,
                rgb.height,
                &GrayImage::new(w_mask.width, w_mask.height, final_mask),
                (rx, ry + ry0 as i32),
            );
        }

        let (blended, coverage) = blender.blend();
        let bw = self.strip.2;
        let bh = (py1 - py0) as usize;

        // Paste this band's UNPADDED rows into the canvas, extension first
        // (see pipeline.rs — cross-wrap blended region wins at the wrap).
        let off_x = (-std::f64::consts::PI * self.compose_scale) as i32;
        let ranges: [(i32, i32); 2] = [
            if self.strip.2 as i32 - self.ext_start > 0 {
                (self.ext_start, self.strip.2 as i32 - self.ext_trim)
            } else {
                (0, 0)
            },
            (0, self.originals_end),
        ];
        for (x0, x1) in ranges {
            let (x0, x1) = (x0.max(0) as usize, (x1.max(0) as usize).min(bw));
            for by in band_y0..band_y1 {
                let sy = by as i32 - py0;
                if sy < 0 || sy >= bh as i32 {
                    continue;
                }
                let sy = sy as usize;
                for x in x0..x1 {
                    if coverage.data[sy * bw + x] == 0 {
                        continue;
                    }
                    let mut cx = self.strip.0 - off_x + x as i32;
                    let w = self.canvas_w as i32;
                    cx = ((cx % w) + w) % w;
                    let ci = by * self.canvas_w + cx as usize;
                    if self.covered[ci] != 0 {
                        continue;
                    }
                    let src = (sy * bw + x) * 3;
                    self.canvas[ci * 3..ci * 3 + 3].copy_from_slice(&blended[src..src + 3]);
                    self.covered[ci] = 1;
                }
            }
        }

        self.bands_done[b] = true;
        Ok(())
    }

    /// Finish: meridian repair + edge equalization, then JPEG encode.
    /// Returns the cropped JPEG and its location in the full equirectangular canvas.
    pub fn finish(
        self,
        quality: u8,
    ) -> Result<(Vec<u8>, usize, usize, usize, usize, usize, usize), String> {
        self.finish_inner(quality, false)
    }

    /// Finish a panorama while softly extending an uncovered nadir to the
    /// bottom of the equirectangular canvas. This is intended for spherical
    /// capture rigs whose head cannot point straight down.
    pub fn finish_with_bottom_blur(
        self,
        quality: u8,
    ) -> Result<(Vec<u8>, usize, usize, usize, usize, usize, usize), String> {
        self.finish_inner(quality, true)
    }

    fn finish_inner(
        mut self,
        quality: u8,
        blur_bottom_blind_spot: bool,
    ) -> Result<(Vec<u8>, usize, usize, usize, usize, usize, usize), String> {
        if self.bands_done.iter().any(|d| !d) {
            return Err("not all bands composited".into());
        }
        if blur_bottom_blind_spot {
            let bottom = self.canvas_h;
            let (x, y, width, height) = self.crop;
            let covered_end = y.saturating_add(height).min(bottom);
            if covered_end < bottom {
                self.blur_bottom_blind_spot(covered_end);
                self.crop = (x, y, width, bottom.saturating_sub(y));
            }
        }
        let (w, h) = (self.canvas_w, self.canvas_h);
        if w >= 3 {
            for y in 0..h {
                let row = y * w;
                // Rebuild uncovered meridian pixels from sphere neighbors.
                if self.covered[row] == 0 {
                    let (l, r) = ((row + 1) * 3, (row + w - 1) * 3);
                    let (lc, rc) = (self.covered[row + 1], self.covered[row + w - 1]);
                    if lc != 0 && rc != 0 {
                        for c in 0..3 {
                            self.canvas[row * 3 + c] =
                                ((self.canvas[l + c] as u16 + self.canvas[r + c] as u16) / 2) as u8;
                        }
                    } else if lc != 0 {
                        self.canvas.copy_within(l..l + 3, row * 3);
                    } else if rc != 0 {
                        self.canvas.copy_within(r..r + 3, row * 3);
                    }
                }
                // Equalize the wrap edges (viewer clamp-filter proofing).
                let (a, bx) = (row * 3, (row + w - 1) * 3);
                if self.covered[row] != 0 && self.covered[row + w - 1] != 0 {
                    for c in 0..3 {
                        let avg =
                            ((self.canvas[a + c] as u16 + self.canvas[bx + c] as u16) / 2) as u8;
                        self.canvas[a + c] = avg;
                        self.canvas[bx + c] = avg;
                    }
                }
            }
        }

        // Pack the crop to the buffer front in place (dst row offset is
        // always <= src row offset, so copy_within is a safe memmove).
        let (cx, cy, cw, ch) = self.crop;
        for r in 0..ch {
            let src = ((cy + r) * w + cx) * 3;
            self.canvas.copy_within(src..src + cw * 3, r * cw * 3);
        }

        let mut out = Vec::new();
        let encoder = jpeg_encoder::Encoder::new(&mut out, quality);
        encoder
            .encode(
                &self.canvas[..cw * ch * 3],
                cw as u16,
                ch as u16,
                jpeg_encoder::ColorType::Rgb,
            )
            .map_err(|e| format!("jpeg encode: {e}"))?;
        Ok((out, cw, ch, w, h, cx, cy))
    }

    fn blur_bottom_blind_spot(&mut self, start_y: usize) {
        let (width, height) = (self.canvas_w, self.canvas_h);
        if start_y >= height || width == 0 {
            return;
        }

        // Carry the last real covered pixel in each longitude downward. Then
        // blur that boundary row horizontally, so the blind cap fades into a
        // soft, image-derived fill instead of a hard black edge.
        let mut edge = vec![[0u8; 3]; width];
        let mut known = vec![false; width];
        let mut unresolved = width;
        for y in (0..start_y).rev() {
            for x in 0..width {
                if known[x] {
                    continue;
                }
                let index = y * width + x;
                if self.covered[index] == 0 {
                    continue;
                }
                edge[x].copy_from_slice(&self.canvas[index * 3..index * 3 + 3]);
                known[x] = true;
                unresolved -= 1;
            }
            if unresolved == 0 {
                break;
            }
        }

        let Some(first_known) = known.iter().position(|value| *value) else {
            return;
        };
        let mut last_known = first_known;
        for offset in 1..width {
            let x = (first_known + offset) % width;
            if known[x] {
                last_known = x;
            } else {
                edge[x] = edge[last_known];
                known[x] = true;
            }
        }

        let gap_height = height - start_y;
        let radius = (gap_height / 16).clamp(3, 48).min(width / 2);
        let mut blurred = vec![[0u8; 3]; width];
        let samples = (radius * 2 + 1) as u64;
        for x in 0..width {
            let mut sum = [0u64; 3];
            for offset in -(radius as isize)..=radius as isize {
                let sample_x = (x as isize + offset).rem_euclid(width as isize) as usize;
                for channel in 0..3 {
                    sum[channel] += edge[sample_x][channel] as u64;
                }
            }
            for channel in 0..3 {
                blurred[x][channel] = (sum[channel] / samples) as u8;
            }
        }

        for y in start_y..height {
            let progress = if gap_height <= 1 {
                1.0
            } else {
                (y - start_y) as f32 / (gap_height - 1) as f32
            };
            let blur_strength = 0.35 + 0.65 * progress;
            for x in 0..width {
                let index = y * width + x;
                if self.covered[index] != 0 {
                    edge[x].copy_from_slice(&self.canvas[index * 3..index * 3 + 3]);
                    continue;
                }
                for channel in 0..3 {
                    let original = edge[x][channel] as f32;
                    let soft = blurred[x][channel] as f32;
                    self.canvas[index * 3 + channel] =
                        (original * (1.0 - blur_strength) + soft * blur_strength).round() as u8;
                }
                self.covered[index] = 1;
            }
        }
    }
}

/// Row-aware BlocksGainCompensator::apply — samples the block-resolution
/// gain map with the SAME resize mapping as exposure.rs, but only for ROI
/// rows [y0, y0+img.height) of a full_w x full_h target.
fn apply_gain_rows(gm: &GainMap, img: &mut RgbImage, full_w: usize, full_h: usize, y0: usize) {
    let coeff = |src_len: usize, dst_len: usize, d: usize| -> (usize, usize, f32, f32) {
        let scale = src_len as f64 / dst_len as f64;
        let f = ((d as f64 + 0.5) * scale - 0.5) as f32;
        let mut s = f.floor() as i64;
        let mut f = f - s as f32;
        if s < 0 {
            s = 0;
            f = 0.0;
        }
        if s >= src_len as i64 - 1 {
            s = src_len as i64 - 1;
            f = 0.0;
        }
        let s = s as usize;
        (s, (s + 1).min(src_len - 1), 1.0 - f, f)
    };
    let xc: Vec<(usize, usize, f32, f32)> =
        (0..full_w).map(|x| coeff(gm.width, full_w, x)).collect();
    for row in 0..img.height {
        let (sy0, sy1, b0, b1) = coeff(gm.height, full_h, y0 + row);
        let r0 = &gm.data[sy0 * gm.width..(sy0 + 1) * gm.width];
        let r1 = &gm.data[sy1 * gm.width..(sy1 + 1) * gm.width];
        for x in 0..img.width.min(full_w) {
            let (sx0, sx1, a0, a1) = xc[x];
            let g = (r0[sx0] * a0 + r0[sx1] * a1) * b0 + (r1[sx0] * a0 + r1[sx1] * a1) * b1;
            let p = (row * img.width + x) * 3;
            for c in 0..3 {
                let v = img.data[p + c] as f32 * g;
                img.data[p + c] = crate::cvmath::cv_round_f32(v).clamp(0, 255) as u8;
            }
        }
    }
}
