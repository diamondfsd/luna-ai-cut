use super::*;

impl Compositor {
    /// Create isolated texture/cache state while reusing an existing GPU device and pipelines.
    pub(crate) fn new_with_shared_gpu(shared: &Self) -> Result<Self, String> {
        let procedural = shared
            .textures
            .get(&0)
            .ok_or_else(|| "shared compositor is missing the procedural texture".to_string())?;
        let mut textures = HashMap::new();
        textures.insert(
            0,
            TextureEntry {
                texture: procedural.texture.clone(),
                width: procedural.width,
                height: procedural.height,
                #[cfg(target_os = "windows")]
                external: false,
            },
        );
        Ok(Self {
            device: shared.device.clone(),
            queue: shared.queue.clone(),
            pipelines: shared.pipelines.clone(),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            pipelines_bgra: shared.pipelines_bgra.clone(),
            sampler: shared.sampler.clone(),
            bind_group_layout: shared.bind_group_layout.clone(),
            textures,
            next_texture_id: 1,
            max_texture_size: shared.max_texture_size,
            backend: shared.backend,
            output_texture: None,
            texture_cache: HashMap::new(),
            unavailable_optional_assets: std::collections::HashSet::new(),
            mask_texture_cache: HashMap::new(),
            cache_order: VecDeque::new(),
            static_image_probed: HashMap::new(),
            video_probed: HashMap::new(),
            video_decoders: HashMap::new(),
            video_decoding_ended: std::collections::HashSet::new(),
            no_video_decoder_restart: false,
            last_preview_log: None,
            staging_buffer: None,
            identity_lut: shared.identity_lut.clone(),
            luts: HashMap::new(),
            fonts: HashMap::new(),
            text_texture_cache: HashMap::new(),
        })
    }
}
