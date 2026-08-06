/**
 * Adapter exports for composition-runtime dependencies.
 * Keyframes modules should import transform helpers from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@freecut/runtime/composition-runtime/utils/transform-resolver'
export { expandTextTransformToFitContent } from '@freecut/runtime/composition-runtime/utils/text-layout'
export { hasCornerPin } from '@freecut/runtime/composition-runtime/utils/corner-pin'
