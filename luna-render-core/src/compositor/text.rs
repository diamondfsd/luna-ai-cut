use super::*;

const TEXT_VERTICAL_SAFETY: f32 = 1.18;

impl Compositor {
    pub(super) fn text_texture(
        &mut self,
        layer: &RenderLayer,
        canvas_width: u32,
        canvas_height: u32,
    ) -> Result<u32, String> {
        let font_path = layer
            .font_file
            .as_deref()
            .ok_or_else(|| "text layer missing fontFile".to_string())?;
        let width = ((layer.dst_w.abs() * canvas_width as f64).round() as u32).max(2);
        let height = ((layer.dst_h.abs() * canvas_height as f64).round() as u32).max(2);
        let requested_font_px =
            (layer.font_size.unwrap_or(16.0) * canvas_height as f64 / 1080.0).max(5.0) as f32;
        let content = layer.content.as_deref().unwrap_or("");
        let color = parse_hex_color(layer.text_color.as_deref(), [1.0, 1.0, 1.0, 1.0]);
        let key = format!(
            "{}|{}|{}|{}|{:.2}|{:?}|{:?}|{:?}",
            font_path,
            content,
            width,
            height,
            requested_font_px,
            color,
            layer.text_align,
            layer.vertical_align
        );
        if let Some(id) = self.text_texture_cache.get(&key) {
            return Ok(*id);
        }
        if !self.fonts.contains_key(font_path) {
            let bytes = std::fs::read(font_path)
                .map_err(|error| format!("读取字体失败 {}: {}", font_path, error))?;
            self.fonts.insert(font_path.to_string(), bytes);
        }
        let font_data = self
            .fonts
            .get(font_path)
            .ok_or_else(|| "字体未加载".to_string())?;
        let font = swash::FontRef::from_index(font_data, 0)
            .ok_or_else(|| format!("无法读取字体 {}", font_path))?;
        let charmap = font.charmap();
        let lines: Vec<&str> = content.split('\n').collect();
        let requested_glyph_metrics = font.glyph_metrics(&[]).scale(requested_font_px);
        let requested_font_metrics = font.metrics(&[]).scale(requested_font_px);
        let requested_line_height =
            (requested_font_metrics.ascent - requested_font_metrics.descent).max(1.0);
        let requested_line_advance = requested_line_height * 1.18;
        let requested_block_height = (requested_line_height
            + requested_line_advance * lines.len().saturating_sub(1) as f32)
            * TEXT_VERTICAL_SAFETY;
        let requested_max_width = lines
            .iter()
            .map(|line| {
                line.chars()
                    .map(|character| requested_glyph_metrics.advance_width(charmap.map(character)))
                    .sum::<f32>()
            })
            .fold(0.0_f32, f32::max);
        let fit_scale = text_fit_scale(
            requested_max_width,
            requested_block_height,
            (width as f32 - 4.0).max(1.0),
            (height as f32 - 4.0).max(1.0),
        );
        let font_px = (requested_font_px * fit_scale).max(5.0);
        let glyph_metrics = font.glyph_metrics(&[]).scale(font_px);
        let font_metrics = font.metrics(&[]).scale(font_px);
        let line_height = (font_metrics.ascent - font_metrics.descent).max(1.0);
        let line_advance = line_height * 1.18;
        let block_height = (line_height + line_advance * lines.len().saturating_sub(1) as f32)
            * TEXT_VERTICAL_SAFETY;
        let block_top = match layer.vertical_align.as_deref() {
            Some("top") => 2.0,
            Some("bottom") => height as f32 - 2.0 - block_height,
            _ => (height as f32 - block_height) * 0.5,
        }
        .max(0.0);
        let mut rgba = vec![0u8; (width * height * 4) as usize];
        let mut scale_context = swash::scale::ScaleContext::new();
        for (line_index, line) in lines.iter().enumerate() {
            let glyph_ids: Vec<_> = line
                .chars()
                .map(|character| charmap.map(character))
                .collect();
            let text_width = glyph_ids
                .iter()
                .map(|glyph_id| glyph_metrics.advance_width(*glyph_id))
                .sum::<f32>();
            let mut pen_x = match layer.text_align.as_deref() {
                Some("right") => width as f32 - text_width - 2.0,
                Some("center") => (width as f32 - text_width) * 0.5,
                _ => 2.0,
            }
            .max(0.0);
            let baseline = block_top + font_metrics.ascent + line_index as f32 * line_advance;
            for glyph_id in glyph_ids {
                use swash::scale::{Render, Source};
                use swash::zeno::Format;
                let mut scaler = scale_context.builder(font).size(font_px).hint(true).build();
                if let Some(image) = Render::new(&[Source::Outline])
                    .format(Format::Alpha)
                    .render(&mut scaler, glyph_id)
                {
                    let origin_x = pen_x.round() as i32 + image.placement.left;
                    let origin_y = baseline.round() as i32 - image.placement.top;
                    for y in 0..image.placement.height as usize {
                        for x in 0..image.placement.width as usize {
                            let dx = origin_x + x as i32;
                            let dy = origin_y + y as i32;
                            if dx < 0 || dy < 0 || dx >= width as i32 || dy >= height as i32 {
                                continue;
                            }
                            let alpha = image.data[y * image.placement.width as usize + x] as f32
                                / 255.0
                                * color[3];
                            let offset = ((dy as u32 * width + dx as u32) * 4) as usize;
                            rgba[offset] = (color[0] * alpha * 255.0).round() as u8;
                            rgba[offset + 1] = (color[1] * alpha * 255.0).round() as u8;
                            rgba[offset + 2] = (color[2] * alpha * 255.0).round() as u8;
                            rgba[offset + 3] = (alpha * 255.0).round() as u8;
                        }
                    }
                }
                pen_x += glyph_metrics.advance_width(glyph_id);
            }
        }
        let id = self.load_texture(&rgba, width, height)?;
        self.text_texture_cache.insert(key, id);
        Ok(id)
    }
}

fn text_fit_scale(
    text_width: f32,
    text_height: f32,
    available_width: f32,
    available_height: f32,
) -> f32 {
    let width_scale = if text_width > 0.0 {
        available_width / text_width
    } else {
        1.0
    };
    let height_scale = if text_height > 0.0 {
        available_height / text_height
    } else {
        1.0
    };
    width_scale.min(height_scale).min(1.0).max(0.01)
}

#[cfg(test)]
mod tests {
    use super::text_fit_scale;

    #[test]
    fn shrinks_text_to_fit_both_dimensions() {
        assert_eq!(text_fit_scale(200.0, 50.0, 100.0, 100.0), 0.5);
        assert_eq!(text_fit_scale(50.0, 200.0, 100.0, 100.0), 0.5);
        assert_eq!(text_fit_scale(50.0, 50.0, 100.0, 100.0), 1.0);
    }
}
