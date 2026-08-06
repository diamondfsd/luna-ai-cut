/**
 * Adapter exports for keyframes dependencies.
 * Export modules should import keyframe utilities from here.
 */

export {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@freecut/features/keyframes/utils/interpolation'
export { interpolateVectorPropertyValue } from '@freecut/features/keyframes/utils/vector-interpolation'
export { resolveAnimatedCrop } from '@freecut/features/keyframes/utils/animated-crop-resolver'
export { resolveAnimatedColorEffects } from '@freecut/features/keyframes/utils/effect-animatable-properties'
export { resolveAnimatedTextItem } from '@freecut/features/keyframes/utils/animated-text-item'
export { resolveAnimatedShapeItem } from '@freecut/features/keyframes/utils/animated-shape-item'
