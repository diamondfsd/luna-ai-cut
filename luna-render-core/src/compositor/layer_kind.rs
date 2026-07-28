pub(crate) fn is_procedural_layer_type(layer_type: Option<&str>) -> bool {
    !matches!(
        layer_type.unwrap_or("media"),
        "media" | "local-color" | "pixel-stretch" | "pixel-flow"
    )
}

#[cfg(test)]
mod tests {
    use super::is_procedural_layer_type;

    #[test]
    fn local_color_layers_reuse_media_textures() {
        assert!(!is_procedural_layer_type(None));
        assert!(!is_procedural_layer_type(Some("media")));
        assert!(!is_procedural_layer_type(Some("local-color")));
        assert!(!is_procedural_layer_type(Some("pixel-stretch")));
        assert!(!is_procedural_layer_type(Some("pixel-flow")));
        assert!(is_procedural_layer_type(Some("shape")));
    }
}
