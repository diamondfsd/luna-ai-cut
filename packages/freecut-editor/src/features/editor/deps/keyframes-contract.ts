/**
 * Adapter exports for keyframes dependencies.
 * Editor modules should import keyframes components/utils from here.
 */

export { KeyframeToggle } from '@freecut/features/keyframes/components/keyframe-toggle'
export { resolveAnimatedTransform } from '@freecut/features/keyframes/utils/animated-transform-resolver'
export {
  getCropPropertyValue,
  resolveAnimatedCrop,
} from '@freecut/features/keyframes/utils/animated-crop-resolver'
export {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@freecut/features/keyframes/utils/interpolation'
export { countTrimmedKeyframes } from '@freecut/features/keyframes/utils/trimmed-keyframes'
export {
  getAutoKeyframeOperation,
  type AutoKeyframeOperation,
} from '@freecut/features/keyframes/utils/auto-keyframe'
export { getAnimatablePropertiesForItem } from '@freecut/features/keyframes/utils/animatable-properties'
export { getAnimatablePropertyBaseValue } from '@freecut/features/keyframes/utils/animatable-property-base-value'
export { hasPathVertexKeyframes } from '@freecut/features/keyframes/utils/path-animatable-properties'
export { getKeyframePropertyLabel } from '@freecut/features/keyframes/utils/property-i18n'
export {
  MOTION_PRESETS,
  MOTION_PRESET_CATEGORIES,
  getMotionPresetAnchorFrame,
  motionPresetScalesBox,
  type MotionPreset,
  type MotionPresetCategory,
  type MotionThumbnail,
} from '@freecut/features/keyframes/utils/motion-presets'
export {
  DEFAULT_MOTION_GENERATOR_SETTINGS,
  applyMotionGeneratorSettings,
  type MotionGeneratorSettings,
} from '@freecut/features/keyframes/utils/motion-generator'
export {
  MOTION_MODULATORS,
  type MotionModulator,
} from '@freecut/features/keyframes/utils/motion-modulators'
export {
  createMotionModifier,
  getMotionModifierSettings,
  updateMotionModifierSettings,
} from '@freecut/features/keyframes/utils/motion-modifier-eval'
export { createMotionAnimationLayer } from '@freecut/features/keyframes/utils/motion-layer-eval'
export {
  bakeMotionModifiersToKeyframes,
  bakeAudioPulseToKeyframes,
  buildBakeMotionPlan,
} from '@freecut/features/keyframes/utils/bake-motion'
export {
  TRIGGER_WAVE_MOTION_LAYER_LABEL,
  createAudioPulseModulation,
  buildTriggerWaveMotionLayerKeyframes,
  createTriggerWaveMotionLayerEffects,
} from '@freecut/features/keyframes/utils/trigger-wave-motion-layer'
