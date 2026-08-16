/**
 * Adapter exports for timeline store dependencies.
 * Editor modules should import timeline store types/selectors from here.
 */

export type { TimelineState, TimelineActions } from '@freecut/features/timeline/types'
export { useTimelineStore } from '@freecut/features/timeline/stores/timeline-store'
export { useTimelineSettingsStore } from '@freecut/features/timeline/stores/timeline-settings-store'
export { useItemsStore } from '@freecut/features/timeline/stores/items-store'
export { useKeyframesStore } from '@freecut/features/timeline/stores/keyframes-store'
export { useCompositionsStore } from '@freecut/features/timeline/stores/compositions-store'
export {
  getActiveTabId,
  useCompositionNavigationStore,
} from '@freecut/features/timeline/stores/composition-navigation-store'
export { useTimelineCommandStore } from '@freecut/features/timeline/stores/timeline-command-store'
export { execute as executeTimelineCommand } from '@freecut/features/timeline/stores/actions/shared'
export { captureSnapshot, restoreSnapshot } from '@freecut/features/timeline/stores/commands/snapshot'
export type { TimelineSnapshot } from '@freecut/features/timeline/stores/commands/types'
export { rateStretchItemWithoutHistory } from '@freecut/features/timeline/stores/actions/item-edit-actions'
export {
  addCompositionControl,
  removeCompositionControl,
  renameCompositionControl,
  repairCompositeCompositionEditorialLeak,
  setCompositionCanvasSettings,
  setCompositionDuration,
  trimCompositionToActiveRegion,
} from '@freecut/features/timeline/stores/actions/composition-editor-actions'
export { setInOutPointsWithoutHistory } from '@freecut/features/timeline/stores/actions/marker-actions'
export { applyAnimationPreset } from '@freecut/features/timeline/stores/actions/preset-actions'
export {
  applyMotionPresetKeyframes,
  removePresetKeyframeApplication,
  removeManualKeyframes,
  trimAnimationToItemBounds,
} from '@freecut/features/timeline/stores/actions/keyframe-actions'
export type {
  MotionPresetClear,
  MotionPresetVectorApply,
} from '@freecut/features/timeline/stores/actions/keyframe-actions'
export {
  applyMotionLayersToItems,
  removeMotionLayerFromItems,
  applyMotionModifierToItems,
  updateMotionModifiersLive,
  beginMotionModifierEdit,
  commitMotionModifierEdit,
  removeMotionModifierFromItems,
  removeAudioPulseFromItems,
  bakeMotionToKeyframes,
} from '@freecut/features/timeline/stores/actions/motion-modifier-actions'
export {
  applyTextMotionEffect,
  updateTextMotionLive,
  beginTextMotionEdit,
  commitTextMotionEdit,
  removeTextMotionEffect,
} from '@freecut/features/timeline/stores/actions/text-motion-actions'
export {
  captureAnimationFromItem,
  getPresetCompatibility,
} from '@freecut/features/timeline/deps/keyframe-editors'
export {
  createMotionClip,
  openComposition,
} from '@freecut/features/timeline/stores/actions/composition-actions'
