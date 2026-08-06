/**
 * Adapter exports for preview dependencies.
 * Editor modules should import preview components/hooks/stores from here.
 */

export { ColorVideoPreview, VideoPreview } from '@freecut/features/preview/components/video-preview'
export { PlaybackControls } from '@freecut/features/preview/components/playback-controls'
export { AlignmentToolbar } from '@freecut/features/preview/components/alignment-hud'
export { TimecodeDisplay } from '@freecut/features/preview/components/timecode-display'
export { PreviewZoomControls } from '@freecut/features/preview/components/preview-zoom-controls'

export const importSourceMonitor = () => import('@freecut/features/preview/components/source-monitor')
export const importInlineSourcePreview = () =>
  import('@freecut/features/preview/components/inline-source-preview')
export const importInlineCompositionPreview = () =>
  import('@freecut/features/preview/components/inline-composition-preview')
export const importColorScopesMonitor = () =>
  import('@freecut/features/preview/components/color-scopes-monitor')

export { useGizmoStore } from '@freecut/features/preview/stores/gizmo-store'
export type { ItemPreview, ItemPropertiesPreview } from '@freecut/features/preview/stores/gizmo-store'
export { useMaskEditorStore } from '@freecut/features/preview/stores/mask-editor-store'
export { useCornerPinStore } from '@freecut/features/preview/stores/corner-pin-store'
export { usePowerWindowEditorStore } from '@freecut/features/preview/stores/power-window-editor-store'
export { useSpatialEffectEditorStore } from '@freecut/features/preview/stores/spatial-effect-editor-store'
export { useThrottledFrame } from '@freecut/features/preview/hooks/use-throttled-frame'
export { useItemsStore } from '@freecut/features/preview/deps/timeline-store'
