use super::cached_texture_is_sufficient;

#[test]
fn rejects_thumbnail_texture_for_workspace_preview() {
    assert!(!cached_texture_is_sufficient(124, 220, 2560));
}

#[test]
fn reuses_larger_texture_for_smaller_preview() {
    assert!(cached_texture_is_sufficient(1440, 2560, 220));
}
