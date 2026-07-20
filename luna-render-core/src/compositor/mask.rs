use crate::RenderLayer;

pub(super) fn mask_params(layer: &RenderLayer) -> [f32; 4] {
    let has_mask = layer.mask_texture_id.is_some();
    [
        if has_mask {
            layer.mask_opacity.unwrap_or(1.0).clamp(0.0, 1.0) as f32
        } else {
            1.0
        },
        if has_mask && layer.mask_inverted.unwrap_or(false) {
            1.0
        } else {
            0.0
        },
        if has_mask {
            layer.mask_feather.unwrap_or(2.0).clamp(0.0, 40.0) as f32
        } else {
            0.0
        },
        if has_mask && layer.layer_type.as_deref() == Some("local-color") {
            1.0
        } else {
            0.0
        },
    ]
}

pub(super) fn linear_clamp_sampler_descriptor() -> wgpu::SamplerDescriptor<'static> {
    wgpu::SamplerDescriptor {
        label: Some("linear clamp"),
        address_mode_u: wgpu::AddressMode::ClampToEdge,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        address_mode_w: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::MipmapFilterMode::Nearest,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer() -> RenderLayer {
        RenderLayer {
            texture_id: 1,
            layer_type: Some("local-color".to_string()),
            shape: None,
            fill_color: None,
            corner_radius: None,
            stroke_color: None,
            stroke_width: None,
            content: None,
            font_size: None,
            font_family: None,
            font_file: None,
            font_weight: None,
            text_color: None,
            text_align: None,
            vertical_align: None,
            fit: None,
            dst_x: 0.0,
            dst_y: 0.0,
            dst_w: 1.0,
            dst_h: 1.0,
            src_x: 0.0,
            src_y: 0.0,
            src_w: 1.0,
            src_h: 1.0,
            opacity: 1.0,
            blend_mode: None,
            reveal_progress: None,
            z_index: 0,
            color: None,
            mask_path: None,
            mask_texture_id: Some(2),
            mask_opacity: Some(1.5),
            mask_inverted: Some(true),
            mask_feather: Some(80.0),
            pixel_stretch: None,
            transform: None,
            positioning: None,
            restore_lut_id: None,
            lut_id: None,
            lut_intensity: None,
        }
    }

    #[test]
    fn clamps_local_mask_parameters() {
        assert_eq!(mask_params(&layer()), [1.0, 1.0, 40.0, 1.0]);
    }

    #[test]
    fn disables_mask_semantics_without_a_mask_texture() {
        let mut input = layer();
        input.mask_texture_id = None;
        assert_eq!(mask_params(&input), [1.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn mask_sampler_is_linear_and_clamped() {
        let descriptor = linear_clamp_sampler_descriptor();
        assert_eq!(descriptor.address_mode_u, wgpu::AddressMode::ClampToEdge);
        assert_eq!(descriptor.address_mode_v, wgpu::AddressMode::ClampToEdge);
        assert_eq!(descriptor.mag_filter, wgpu::FilterMode::Linear);
        assert_eq!(descriptor.min_filter, wgpu::FilterMode::Linear);
    }
}
