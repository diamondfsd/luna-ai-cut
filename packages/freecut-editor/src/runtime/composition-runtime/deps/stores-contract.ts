/**
 * Adapter exports for shared store dependencies.
 * Composition runtime modules should import store hooks/types from here.
 */

export { useMediaLibraryStore } from '@freecut/features/media-library/stores/media-library-store'
export { useGizmoStore } from '@freecut/features/preview/stores/gizmo-store'
export { useItemGizmoPreview } from '@freecut/features/preview/stores/use-item-gizmo-preview'
export type { ItemPropertiesPreview } from '@freecut/features/preview/stores/gizmo-store'
export { useCornerPinStore } from '@freecut/features/preview/stores/corner-pin-store'
export { useMaskEditorStore } from '@freecut/features/preview/stores/mask-editor-store'
export { usePlaybackStore } from '@freecut/shared/state/playback'
export { useTimelineStore } from '@freecut/features/timeline/stores/timeline-store'
export { useCompositionsStore } from '@freecut/features/timeline/stores/compositions-store'
export { useDebugStore } from '@freecut/features/editor/stores/debug-store'
