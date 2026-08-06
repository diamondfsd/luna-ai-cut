# OpenCut Native Modules

This directory vendors the reusable Rust editor crates from OpenCut Classic
commit `cf5e79e919144200294fb9fed22a222592a0aeea` under its MIT license.

The browser-only `rust/wasm` binding is intentionally excluded. Luna links the
time, compositor, effects, GPU, and mask crates natively through
`luna-render-core/src/opencut.rs` and exposes them through the existing N-API
and Electron IPC boundary.

The vendored crates use Luna's current `wgpu` major version. Keep Luna-specific
adapters outside the vendored crate sources so the upstream implementation can
be audited and updated independently.
