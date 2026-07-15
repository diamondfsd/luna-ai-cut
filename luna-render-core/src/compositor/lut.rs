use super::*;
use crate::log;

impl Compositor {
    pub(super) fn ensure_lut_loaded(&mut self, path: &str) -> Result<&LutEntry, String> {
        use std::collections::hash_map::Entry;
        match self.luts.entry(path.to_string()) {
            Entry::Occupied(entry) => Ok(entry.into_mut()),
            Entry::Vacant(entry) => {
                let mut file = std::fs::File::open(path)
                    .map_err(|e| format!("打开 LUT 文件失败 {}: {}", path, e))?;
                let mut data = Vec::new();
                file.read_to_end(&mut data)
                    .map_err(|e| format!("读取 LUT 文件失败 {}: {}", path, e))?;
                let (size, values) = parse_cube_lut(&data)?;
                if size < 2 || size > self.device.limits().max_texture_dimension_3d {
                    return Err(format!(
                        "LUT size {} out of range [2, {}]",
                        size,
                        self.device.limits().max_texture_dimension_3d
                    ));
                }
                let texture = create_lut_3d_texture(&self.device, &self.queue, size, &values);
                log!(
                    "load_lut_file path={} size={}x{}x{}",
                    path,
                    size,
                    size,
                    size
                );
                Ok(entry.insert(LutEntry { texture, size }))
            }
        }
    }

    // ── 渲染 ──
}
