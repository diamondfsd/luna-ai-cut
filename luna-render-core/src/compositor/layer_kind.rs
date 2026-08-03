pub(crate) fn is_procedural_layer_type(layer_type: Option<&str>) -> bool {
    !matches!(
        layer_type.unwrap_or("media"),
        "media" | "local-color" | "pixel-stretch" | "pixel-flow"
    )
}

/// Positioned static overlays are watermark assets. They are optional so an
/// unavailable bundled/custom watermark must not prevent the media from rendering.
pub(crate) fn is_optional_positioned_asset(
    layer_type: Option<&str>,
    has_positioning: bool,
) -> bool {
    has_positioning && !is_procedural_layer_type(layer_type)
}

pub(crate) fn tolerate_optional_positioned_asset_error<T>(
    layer_type: Option<&str>,
    has_positioning: bool,
    file_path: &str,
    unavailable_assets: &mut std::collections::HashSet<String>,
    result: Result<T, String>,
) -> Result<Option<T>, String> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if is_optional_positioned_asset(layer_type, has_positioning) => {
            unavailable_assets.insert(file_path.to_string());
            crate::logging::write(&format!(
                "skip unavailable watermark {}: {}",
                file_path, error
            ));
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_optional_positioned_asset, is_procedural_layer_type,
        tolerate_optional_positioned_asset_error,
    };

    #[test]
    fn local_color_layers_reuse_media_textures() {
        assert!(!is_procedural_layer_type(None));
        assert!(!is_procedural_layer_type(Some("media")));
        assert!(!is_procedural_layer_type(Some("local-color")));
        assert!(!is_procedural_layer_type(Some("pixel-stretch")));
        assert!(!is_procedural_layer_type(Some("pixel-flow")));
        assert!(is_procedural_layer_type(Some("shape")));
    }

    #[test]
    fn positioned_media_assets_are_optional_watermarks() {
        assert!(is_optional_positioned_asset(Some("media"), true));
        assert!(is_optional_positioned_asset(None, true));
        assert!(!is_optional_positioned_asset(Some("media"), false));
        assert!(!is_optional_positioned_asset(Some("shape"), true));
    }

    #[test]
    fn only_watermark_errors_are_tolerated() {
        let mut unavailable_assets = std::collections::HashSet::new();
        assert_eq!(
            tolerate_optional_positioned_asset_error(
                Some("media"),
                true,
                "missing.png",
                &mut unavailable_assets,
                Err("missing".to_string())
            ),
            Ok(None::<()>),
        );
        assert!(unavailable_assets.contains("missing.png"));
        assert_eq!(
            tolerate_optional_positioned_asset_error::<()>(
                Some("media"),
                false,
                "missing.png",
                &mut unavailable_assets,
                Err("missing".to_string()),
            ),
            Err("missing".to_string()),
        );
    }
}
