use crate::RenderLayer;

const MASK_DISTANCE_RANGE: f32 = 100.0;
const DIAGONAL_DISTANCE: f32 = std::f32::consts::SQRT_2;

fn distance_to_selection(selected: &[bool], width: usize, height: usize) -> Vec<f32> {
    let mut distances = selected
        .iter()
        .map(|is_selected| {
            if *is_selected {
                0.0
            } else {
                MASK_DISTANCE_RANGE + DIAGONAL_DISTANCE
            }
        })
        .collect::<Vec<_>>();

    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            if x > 0 {
                distances[index] = distances[index].min(distances[index - 1] + 1.0);
            }
            if y > 0 {
                distances[index] = distances[index].min(distances[index - width] + 1.0);
                if x > 0 {
                    distances[index] =
                        distances[index].min(distances[index - width - 1] + DIAGONAL_DISTANCE);
                }
                if x + 1 < width {
                    distances[index] =
                        distances[index].min(distances[index - width + 1] + DIAGONAL_DISTANCE);
                }
            }
        }
    }
    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let index = y * width + x;
            if x + 1 < width {
                distances[index] = distances[index].min(distances[index + 1] + 1.0);
            }
            if y + 1 < height {
                distances[index] = distances[index].min(distances[index + width] + 1.0);
                if x > 0 {
                    distances[index] =
                        distances[index].min(distances[index + width - 1] + DIAGONAL_DISTANCE);
                }
                if x + 1 < width {
                    distances[index] =
                        distances[index].min(distances[index + width + 1] + DIAGONAL_DISTANCE);
                }
            }
        }
    }
    distances
}

pub(super) fn encode_mask_distance_channels(data: &[u8], width: u32, height: u32) -> Vec<u8> {
    let pixel_count = width as usize * height as usize;
    let selected = (0..pixel_count)
        .map(|index| data[index * 4] >= 128)
        .collect::<Vec<_>>();
    let normal_distances = distance_to_selection(&selected, width as usize, height as usize);
    let inverted = selected.iter().map(|value| !value).collect::<Vec<_>>();
    let inverted_distances = distance_to_selection(&inverted, width as usize, height as usize);
    let mut encoded = data.to_vec();
    for index in 0..pixel_count {
        encoded[index * 4 + 1] = (normal_distances[index].min(MASK_DISTANCE_RANGE)
            / MASK_DISTANCE_RANGE
            * 255.0)
            .round() as u8;
        encoded[index * 4 + 2] =
            (inverted_distances[index].min(MASK_DISTANCE_RANGE) / MASK_DISTANCE_RANGE * 255.0)
                .round() as u8;
    }
    encoded
}

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
            layer.mask_feather.unwrap_or(0.0).clamp(0.0, 100.0) as f32
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
            precompose_group: None,
            precompose_role: None,
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
            mask_feather: Some(180.0),
            mask_transform: None,
            pixel_stretch: None,
            pixel_flow: None,
            transform: None,
            positioning: None,
            restore_lut_id: None,
            lut_id: None,
            lut_intensity: None,
        }
    }

    #[test]
    fn clamps_local_mask_parameters() {
        assert_eq!(mask_params(&layer()), [1.0, 1.0, 100.0, 1.0]);
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

    #[test]
    fn encodes_monotonic_distance_for_normal_and_inverted_masks() {
        let values = [255_u8, 255, 0, 0, 0];
        let rgba = values
            .iter()
            .flat_map(|value| [*value, *value, *value, 255])
            .collect::<Vec<_>>();
        let encoded = encode_mask_distance_channels(&rgba, 5, 1);
        let normal = (0..5)
            .map(|index| encoded[index * 4 + 1])
            .collect::<Vec<_>>();
        let inverted = (0..5)
            .map(|index| encoded[index * 4 + 2])
            .collect::<Vec<_>>();

        assert_eq!(normal[0], 0);
        assert_eq!(normal[1], 0);
        assert!(normal[2] > 0 && normal[2] < normal[3] && normal[3] < normal[4]);
        assert!(inverted[0] > inverted[1] && inverted[1] > 0);
        assert_eq!(&inverted[2..], &[0, 0, 0]);
    }
}
