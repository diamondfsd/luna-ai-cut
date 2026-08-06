/**
 * Adapter exports for preview dependencies.
 * Effects modules should import preview stores/hooks from here.
 */

export { useGizmoStore } from '@freecut/features/preview/stores/gizmo-store'
export { usePowerWindowEditorStore } from '@freecut/features/preview/stores/power-window-editor-store'
export { useSpatialEffectEditorStore } from '@freecut/features/preview/stores/spatial-effect-editor-store'
export { useThrottledFrame } from '@freecut/features/preview/hooks/use-throttled-frame'
