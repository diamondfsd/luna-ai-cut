import { isSamSegmentationModel, isSpecializedSegmentationModel, type SegmentationModelId, type SemanticSegmentationModelId } from '../../shared/segmentationModels'

export const FAST_MODEL_ID: SemanticSegmentationModelId = 'segformer-b0-ade20k'
export const FINE_MODEL_ID: SemanticSegmentationModelId = 'segformer-b2-ade20k'

export type MaskProductMode = 'fast' | 'fine'

const FAST_ARCHIVE_MODEL_IDS = new Set<SegmentationModelId>([
  FAST_MODEL_ID,
  'segformer-b1-ade20k',
  'slimsam-77-uniform',
  'slimsam-50-uniform',
])

export function productModeForModel(modelId: SegmentationModelId): MaskProductMode {
  return FAST_ARCHIVE_MODEL_IDS.has(modelId) ? 'fast' : 'fine'
}

export function modelForProductMode(mode: MaskProductMode): SemanticSegmentationModelId {
  return mode === 'fine' ? FINE_MODEL_ID : FAST_MODEL_ID
}

export function modelForAutomaticSelection(modelId: SegmentationModelId): SemanticSegmentationModelId {
  if (!isSamSegmentationModel(modelId) && !isSpecializedSegmentationModel(modelId)) return modelId
  return modelForProductMode(productModeForModel(modelId))
}
