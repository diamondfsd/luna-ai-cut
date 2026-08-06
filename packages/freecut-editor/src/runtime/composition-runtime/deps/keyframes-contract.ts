/**
 * Adapter exports for keyframe-layer dependencies.
 */

export {
  resolveAnimatedTransform,
  hasKeyframeAnimation,
} from '@freecut/features/keyframes/utils/animated-transform-resolver'
export type { LinkedPropertyEvaluationContext } from '@freecut/features/keyframes/utils/animated-transform-resolver'
export { applyMotionModifiers } from '@freecut/features/keyframes/utils/motion-modifier-eval'
export { applyMotionAnimationLayers } from '@freecut/features/keyframes/utils/motion-layer-eval'
export { resolveAnimatedCrop } from '@freecut/features/keyframes/utils/animated-crop-resolver'
export {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@freecut/features/keyframes/utils/interpolation'
export { resolveAnimatedTextItem } from '@freecut/features/keyframes/utils/animated-text-item'
export { resolveAnimatedShapeItem } from '@freecut/features/keyframes/utils/animated-shape-item'
