/** Focused editor seam for the Motion workspace timeline. */

export {
  CompactNavigator,
  getKeyframeNavigatorThumbMetrics,
  getNiceTickStep,
  useRafCoalescedValue,
  DopesheetEditor,
  PickWhipIcon,
  PropertyLinkPickWhipOverlay,
  GROUP_HEADER_HEIGHT,
  KEYFRAME_EDGE_INSET,
  KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
  ROW_HEIGHT,
  getAnimatablePropertiesForItem,
  getEffectPropertyBaseValue,
  getProceduralBands,
  getPropertyAccordionGroups,
  getPropertyDisplayGroups,
  buildVectorPromotionPlan,
  resolveAnimatedTransform,
  getShapeAnimatableBaseValue,
  resolveAnimatedShapeItem,
  resolveExpressionReferenceValue,
} from '@freecut/features/timeline/deps/keyframe-editors'
export { usePropertyLinkPickWhip } from '@freecut/features/timeline/hooks/use-property-link-pick-whip'
export { interpolatePropertyValue } from '@freecut/features/timeline/deps/keyframes'
export { captureSnapshot } from '@freecut/features/timeline/stores/commands/snapshot'
export { useItemsStore } from '@freecut/features/timeline/stores/items-store'
export { useKeyframesStore } from '@freecut/features/timeline/stores/keyframes-store'
export { useKeyframeSelectionStore } from '@freecut/features/timeline/stores/keyframe-selection-store'
export { useCompositionsStore } from '@freecut/features/timeline/stores/compositions-store'
export { useCompositionNavigationStore } from '@freecut/features/timeline/stores/composition-navigation-store'
export { useTimelineCommandStore } from '@freecut/features/timeline/stores/timeline-command-store'
export { useTimelineSettingsStore } from '@freecut/features/timeline/stores/timeline-settings-store'
export {
  addItemOnNewTrack,
  addItemsOnNewTracks,
  duplicateItemsWithTrackChanges,
  moveItems,
  removeItems,
  setTransformParents,
  trimItemEnd,
  trimItemStart,
  updateItem,
} from '@freecut/features/timeline/stores/actions/item-actions'
export {
  addKeyframe,
  promoteTransformToVector,
  setVectorDimensionsSeparated,
  removeVectorKeyframe,
  removePropertyExpression,
  removeKeyframes,
  setPropertyExpression,
  updateKeyframe,
  updateKeyframes,
  updateVectorKeyframe,
  upsertVectorKeyframe,
} from '@freecut/features/timeline/stores/actions/keyframe-actions'
export { setTracks } from '@freecut/features/timeline/stores/actions/track-actions'
export {
  createCompositeComposition,
  openComposition,
} from '@freecut/features/timeline/stores/actions/composition-actions'
export type { CreateCompositeCompositionOptions } from '@freecut/features/timeline/stores/actions/composition-actions'
export { buildDroppedCompositionTimelineItems } from '@freecut/features/timeline/utils/dropped-composition'
export {
  buildDroppedMediaTimelineItems,
  getDroppedMediaDurationInFrames,
} from '@freecut/features/timeline/utils/dropped-media'
export { resolveDroppedMediaEntriesFromPayload } from '@freecut/features/timeline/utils/drop-execution'
export {
  createDefaultControllerItem,
  createDefaultGradientItem,
  createDefaultShapeItem,
  createDefaultSolidColorItem,
  createTimelineTemplateItem,
  createTextTemplateItem,
  isTimelineTemplateDragData,
} from '@freecut/features/timeline/utils/generated-layer-items'
export { wouldCreateCompositionCycle } from '@freecut/features/timeline/utils/composition-graph'
