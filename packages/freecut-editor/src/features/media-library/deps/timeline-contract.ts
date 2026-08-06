/**
 * Single import seam for media-library -> timeline dependencies.
 */

export type { SubComposition } from '@freecut/features/timeline/contracts/media-library'
export {
  autoMatchOrphanedClips,
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
  importCanvasRenderOrchestrator,
  resolveMediaUrl,
  resolveMediaUrls,
  useCompositionsStore,
} from '@freecut/features/timeline/contracts/media-library'
