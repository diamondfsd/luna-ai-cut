import { logger } from '../../lib/rendererLogger'
import { automaticSegmentationTarget, type AutomaticSegmentationTargetId } from '../../shared/segmentationModels'
import type { WorkspaceSegmentationProgress } from '../../shared/types/api'
import type { MaskOperation } from '../mask/maskOperationIdentity'
import { hasUsableMask } from '../mask/maskSelectionOperations'
import { hardExpandMask } from '../removal/instanceStrokeSelection'
import { createDefaultPipeline, type ColorMaskLayer } from '../shared/editPipeline'

interface GenerateSuggestedColorMasksOptions {
  targetIds: AutomaticSegmentationTargetId[]
  existingLayers: ColorMaskLayer[]
  projectId: string
  assetId: string
  mediaPath: string
  expansion: number
  beginOperation: (kind: MaskOperation['kind'], projectId: string, assetId: string, requestId?: string) => MaskOperation
  isCurrentOperation: (operation: MaskOperation) => boolean
  finishOperation: (operation: MaskOperation) => void
  setProgress: (progress: WorkspaceSegmentationProgress | null) => void
}

export interface SuggestedColorMasksResult {
  candidateCount: number
  layers: ColorMaskLayer[]
}

export async function generateSuggestedColorMasks({
  targetIds,
  existingLayers,
  projectId,
  assetId,
  mediaPath,
  expansion,
  beginOperation,
  isCurrentOperation,
  finishOperation,
  setProgress,
}: GenerateSuggestedColorMasksOptions): Promise<SuggestedColorMasksResult | null> {
  const existingTargetIds = new Set(existingLayers.map((layer) => layer.targetId).filter(Boolean))
  const candidates = [...new Set(targetIds)].filter((targetId) => !existingTargetIds.has(targetId)).slice(0, 4)
  const layers: ColorMaskLayer[] = []

  for (const targetId of candidates) {
    const target = automaticSegmentationTarget(targetId)
    if (!target) continue
    const requestId = crypto.randomUUID()
    const operation = beginOperation('segmentation', projectId, assetId, requestId)
    setProgress({ requestId, phase: 'model', label: `正在识别${target.label}`, percent: null })
    try {
      const result = await window.luna.workspace.segmentImage({
        requestId,
        filePath: mediaPath,
        modelId: target.modelId,
        targetId,
        targetClassId: target.classId,
      })
      if (result.requestId !== requestId || !isCurrentOperation(operation)) return null
      const data = hardExpandMask(new Uint8Array(result.bytes), result.width, result.height, expansion)
      let selectedPixels = 0
      for (const value of data) if (value >= 128) selectedPixels += 1
      const coverage = selectedPixels / Math.max(1, data.length)
      if (!hasUsableMask(data) || coverage < 0.005 || coverage > 0.98) continue
      const saved = await window.luna.workspace.saveColorMask(
        projectId,
        assetId,
        result.width,
        result.height,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        0,
      )
      if (!isCurrentOperation(operation)) return null
      const layerId = `mask-${Date.now()}-${layers.length}-${Math.random().toString(36).slice(2, 7)}`
      const componentId = `component-${crypto.randomUUID()}`
      layers.push({
        id: layerId,
        name: result.className || target.label,
        path: saved.path,
        width: saved.width,
        height: saved.height,
        opacity: 1,
        inverted: false,
        feather: 0,
        kind: 'semantic',
        classId: result.classId,
        className: result.className,
        targetId: result.targetId,
        modelId: result.modelId,
        enabled: true,
        blendMode: 'normal',
        color: createDefaultPipeline().color,
        components: [{
          id: componentId,
          type: 'raster',
          operation: 'replace',
          enabled: true,
          inverted: false,
          path: saved.path,
          width: saved.width,
          height: saved.height,
          dynamicSource: {
            kind: 'segmentation',
            modelId: result.modelId,
            targetId: result.targetId,
            classId: result.classId,
            className: result.className,
          },
        }],
      })
    } catch (error) {
      if (!isCurrentOperation(operation)) return null
      logger.warn('[Mask] 简单模式区域未创建', {
        requestId,
        targetId,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      finishOperation(operation)
    }
  }

  return { candidateCount: candidates.length, layers }
}
