//! PanoLoom stitching engine.
//!
//! Pipeline stages (each ported from OpenCV `stitching::detail` and validated
//! against the Python oracle in `tools/reference` — see `docs/pipeline.md`):
//!
//! features → matching → rotation estimation → bundle adjustment →
//! wave correction → warping → photometric compensation → seam finding →
//! multiband blending
//!
//! This crate is wasm-agnostic: it also compiles natively for fast tests and
//! benchmarks. Browser bindings live in `panoloom-wasm`.

pub mod blend;
pub mod bundle;
pub mod camera;
pub mod cp;
pub mod cvmath;
pub mod estimation;
pub mod export;
pub mod exposure;
pub mod fast;
pub mod homography;
pub mod image;
pub mod imgproc;
pub mod lens;
pub mod matcher;
pub mod optimizer;
pub mod orb;
pub mod orb_pattern;
pub(crate) mod par;
pub mod pipeline;
pub mod progress;
pub mod project;
pub mod rng;
pub mod seam;
pub mod warp;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
