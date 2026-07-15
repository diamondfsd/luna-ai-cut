# luna-render-core architecture

The crate is organized around stable API contracts, composition orchestration, rendering, and
media I/O. Keep these boundaries when adding features so the compositor does not become a shared
utility bucket again.

## Crate-level modules

- `api_types.rs`: N-API request, response, and render model types only.
- `lib.rs`: crate wiring, compositor lifecycle, and thin N-API entry points.
- `color_source.rs`: source color probing and SDR normalization.
- `logging.rs`: process-wide render-core logging.
- `export.rs`: export task state and quality presets.
- `media/`: reusable media probing, geometry, path normalization, and static image decoding.

## Composition

- `composition.rs`: composition data contracts and module exports.
- `composition/timeline.rs`: source timing, layer activation, audio muxing, and layer planning.
- `composition/frame.rs`: single-frame composition tasks.
- `composition/video_export.rs`: video encoder selection and video export tasks.
- `composition/image_export.rs`: still-image export tasks.

Composition code may depend on the compositor's public crate API. The compositor must not depend on
composition tasks or export orchestration.

## Compositor

- `compositor.rs`: `Compositor` state, construction, and small shared helpers.
- `compositor/gpu.rs`: stateless GPU resource and pipeline creation.
- `compositor/texture.rs`: texture upload, update, release, and text rasterization.
- `compositor/lut.rs`: LUT loading and caching.
- `compositor/render.rs`: layer parameter packing and GPU render execution.
- `compositor/playback.rs`: preview media decoding and frame/texture caches.
- `compositor/preview.rs`: preview layout and transform planning.
- `compositor/external.rs`: platform external-texture integration.

## Placement rules

1. Put reusable FFmpeg/ffprobe logic in `media/`, not in render or export tasks.
2. Keep N-API functions thin; convert inputs and delegate to a domain module.
3. Keep GPU functions that do not mutate `Compositor` state in `compositor/gpu.rs`.
4. Keep platform handles and unsafe interop in `compositor/external.rs` or the platform module.
5. Prefer `pub(crate)` or `pub(super)` for internal boundaries; only N-API contracts are public.
6. Split a module before it reaches 500 lines, based on responsibility rather than file size alone.
