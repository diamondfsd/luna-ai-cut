use std::collections::HashMap;

use crate::compositor::{Compositor, PreviewLayerInput};
use crate::media::decode_static_image_scaled;

pub(crate) fn bind_layer_mask_texture(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    max_side: u32,
    mask_textures: &mut HashMap<String, u32>,
    layer: &mut PreviewLayerInput,
) -> Result<(), String> {
    let Some(mask_path) = layer.mask_path.as_deref() else {
        return Ok(());
    };
    let texture_id = if let Some(cached) = mask_textures.get(mask_path).copied() {
        cached
    } else {
        let (rgba, width, height) =
            decode_static_image_scaled(ffmpeg_path, ffprobe_path, mask_path, max_side)?;
        let texture_id = compositor.load_external_mask_texture(&rgba, width, height)?;
        mask_textures.insert(mask_path.to_string(), texture_id);
        texture_id
    };
    layer.mask_texture_id = Some(texture_id);
    Ok(())
}
