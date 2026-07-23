use super::*;
use crate::log;
use std::collections::{HashMap, HashSet};

fn stale_mask_textures(
    cache: &HashMap<String, u32>,
    active_paths: &HashSet<&str>,
) -> Vec<(String, u32)> {
    cache
        .iter()
        .filter(|(path, _)| !active_paths.contains(path.as_str()))
        .map(|(path, texture_id)| (path.clone(), *texture_id))
        .collect()
}

impl Compositor {
    pub(super) fn retain_active_mask_textures(
        &mut self,
        layers: &[PreviewLayerInput],
    ) -> Result<(), String> {
        let active_paths: HashSet<&str> = layers
            .iter()
            .filter_map(|layer| layer.mask_path.as_deref())
            .collect();
        let stale = stale_mask_textures(&self.mask_texture_cache, &active_paths);

        for (path, texture_id) in stale {
            self.mask_texture_cache.remove(&path);
            if self.textures.contains_key(&texture_id) {
                self.release_texture(texture_id)?;
            }
        }
        Ok(())
    }

    pub fn release_texture(&mut self, texture_id: u32) -> Result<(), String> {
        self.textures
            .remove(&texture_id)
            .ok_or_else(|| format!("texture {} not found", texture_id))?;

        if let Some(path) = self
            .texture_cache
            .iter()
            .find(|(_, &id)| id == texture_id)
            .map(|(path, _)| path.clone())
        {
            self.texture_cache.remove(&path);
            self.cache_order.retain(|key| key != &path);
        }
        self.mask_texture_cache
            .retain(|_, cached_id| *cached_id != texture_id);
        log!("release_texture id={}", texture_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_only_unreferenced_mask_textures() {
        let cache = HashMap::from([
            ("current.pgm".to_string(), 10),
            ("replaced.pgm".to_string(), 11),
        ]);
        let active_paths = HashSet::from(["current.pgm"]);

        assert_eq!(
            stale_mask_textures(&cache, &active_paths),
            vec![("replaced.pgm".to_string(), 11)]
        );
    }
}
