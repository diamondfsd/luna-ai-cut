/**
 * Adapter exports for keyframes dependencies.
 * Timeline modules should import keyframe components/utilities from here.
 */

export type { AutoKeyframeOperation } from '@freecut/features/keyframes/utils/auto-keyframe'
export { interpolatePropertyValue } from '@freecut/features/keyframes/utils/interpolation'
export { sampleVectorSpeedGraph } from '@freecut/features/keyframes/utils/vector-interpolation'
export {
  cleanupTrimmedKeyframes,
  countTrimmedKeyframes,
} from '@freecut/features/keyframes/utils/trimmed-keyframes'
export {
  buildVectorPromotionPlan,
  remapLegacyVectorPromotionIdentities,
} from '@freecut/features/keyframes/utils/vector-promotion'
export {
  resolveAnimatedTransform,
  resolveExpressionReferenceValue,
  wouldCreateDirectPropertyLinkCycle,
} from '@freecut/features/keyframes/utils/animated-transform-resolver'
export {
  getShapeAnimatableBaseValue,
  resolveAnimatedShapeItem,
} from '@freecut/features/keyframes/utils/animated-shape-item'
export {
  BEZIER_PRESETS,
  areBezierPointsEqual,
  findMatchingBezierPreset,
  clampBezierValue,
  clampSpringValue,
  buildEasingConfig,
} from '@freecut/features/keyframes/utils/easing-presets'
export type { BezierPresetValue } from '@freecut/features/keyframes/utils/easing-presets'
export {
  getTransitionBlockedRanges,
  isFrameInTransitionRegion,
} from '@freecut/features/keyframes/utils/transition-region'
export { DopesheetEditor } from '@freecut/features/keyframes/components/dopesheet-editor'
export { PickWhipIcon } from '@freecut/features/keyframes/components/dopesheet-editor/pick-whip-icon'
export { PropertyLinkPickWhipOverlay } from '@freecut/features/keyframes/components/property-link-pick-whip-overlay'
export {
  GROUP_HEADER_HEIGHT,
  ROW_HEIGHT,
} from '@freecut/features/keyframes/components/dopesheet-editor/dopesheet-constants'
export {
  getPropertyAccordionGroups,
  getPropertyDisplayGroups,
} from '@freecut/features/keyframes/components/dopesheet-editor/property-groups'
export { CompactNavigator } from '@freecut/features/keyframes/components/dopesheet-editor/compact-navigator'
export { getKeyframeNavigatorThumbMetrics } from '@freecut/features/keyframes/components/dopesheet-editor/compact-navigator-utils'
export {
  KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
  KEYFRAME_EDGE_INSET,
} from '@freecut/features/keyframes/components/dopesheet-editor/layout'
export { getNiceTickStep } from '@freecut/features/keyframes/components/dopesheet-editor/dopesheet-helpers'
export { useRafCoalescedValue } from '@freecut/features/keyframes/components/use-raf-coalesced-value'
export { getAnimatablePropertiesForItem } from '@freecut/features/keyframes/utils/animatable-properties'
export { getAnimatablePropertyBaseValue } from '@freecut/features/keyframes/utils/animatable-property-base-value'
export {
  getProceduralBands,
  type ProceduralPreviewInput,
} from '@freecut/features/keyframes/utils/procedural-preview'
export { buildBakeMotionPlan } from '@freecut/features/keyframes/utils/bake-motion'
export { cloneMotionAnimationLayer } from '@freecut/features/keyframes/utils/motion-layer-eval'
export { getEffectPropertyBaseValue } from '@freecut/features/keyframes/utils/effect-animatable-properties'
export {
  captureAnimationFromItem,
  getPresetCompatibility,
} from '@freecut/features/keyframes/utils/animation-preset-compat'
export type { PresetIncompatibilityReason } from '@freecut/features/keyframes/utils/animation-preset-compat'
