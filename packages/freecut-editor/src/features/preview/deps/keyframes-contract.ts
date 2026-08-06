/**
 * Adapter exports for keyframes dependencies.
 * Preview modules should import keyframe hooks/utilities from here.
 */

export { useAnimatedTransform } from '@freecut/features/keyframes/hooks/use-animated-transform'
export { resolveAnimatedCrop } from '@freecut/features/keyframes/utils/animated-crop-resolver'
export {
  getAutoKeyframeOperation,
  getVectorAutoKeyframeOperation,
  type AutoKeyframeOperation,
} from '@freecut/features/keyframes/utils/auto-keyframe'
export { removeMotionAnimationLayers } from '@freecut/features/keyframes/utils/motion-layer-eval'
export { removeMotionModifiers } from '@freecut/features/keyframes/utils/motion-modifier-eval'
export { isFrameInTransitionRegion } from '@freecut/features/keyframes/utils/transition-region'
export { resolveAnimatedTextItem } from '@freecut/features/keyframes/utils/animated-text-item'
export { resolveAnimatedShapeItem } from '@freecut/features/keyframes/utils/animated-shape-item'
export { resetAutoKeyframeStore } from '@freecut/features/keyframes/stores/auto-keyframe-store'
export {
  clonePathVertices,
  getChangedPathVertexValues,
  hasPathVertexKeyframes,
} from '@freecut/features/keyframes/utils/path-animatable-properties'
