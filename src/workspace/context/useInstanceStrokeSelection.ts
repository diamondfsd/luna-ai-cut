import { useCallback } from 'react'
import type { WorkspaceSegmentationProgress } from '../../shared/types'
import { toast } from '../../ui'
import type { MaskOperation } from '../mask/maskOperationIdentity'
import { applyMaskSelectionOperation, type MaskSelectionOperation } from '../mask/maskSelectionOperations'
import { decodeInstanceIds, selectInstancesFromStroke, type NormalizedStrokePoint } from '../removal/instanceStrokeSelection'
import type { MaskComponentCommit, SegmentationPerformance } from './WorkspaceMaskContextTypes'

interface InstanceStrokeSelectionOptions {
  filePath?: string
  projectId?: string
  assetId?: string
  maskSize: { width: number; height: number } | null
  maskData: Uint8Array | null
  selectionOperation: MaskSelectionOperation
  beginOperation: (kind: MaskOperation['kind'], projectId: string, assetId: string, requestId?: string) => MaskOperation
  isCurrentOperation: (operation: MaskOperation) => boolean
  finishOperation: (operation: MaskOperation) => void
  commitMask: (data: Uint8Array, componentCommit?: MaskComponentCommit) => Promise<void>
  setPerformance: (performance: SegmentationPerformance) => void
  setProgress: (progress: WorkspaceSegmentationProgress | null) => void
  setError: (error: string | null) => void
}

export function useInstanceStrokeSelection(options: InstanceStrokeSelectionOptions) {
  return useCallback(async (points: NormalizedStrokePoint[]): Promise<void> => {
    const { filePath, projectId, assetId, maskSize } = options
    if (!filePath || !projectId || !assetId || !maskSize || points.length < 2) return
    const requestId = crypto.randomUUID()
    const operation = options.beginOperation('segmentation', projectId, assetId, requestId)
    const operationMode = options.selectionOperation
    const base = options.maskData
      ? new Uint8Array(options.maskData)
      : new Uint8Array(maskSize.width * maskSize.height)
    options.setError(null)
    options.setProgress({ requestId, phase: 'model', label: '正在准备模型', percent: null })
    try {
      const result = await window.luna.workspace.segmentInstances({ requestId, filePath })
      if (result.requestId !== requestId || !options.isCurrentOperation(operation)) return
      const selected = selectInstancesFromStroke({
        instanceIds: decodeInstanceIds(result.instanceIds),
        instanceWidth: result.width,
        instanceHeight: result.height,
        targetWidth: maskSize.width,
        targetHeight: maskSize.height,
        points,
        expansion: 4,
      })
      options.setPerformance(result.performance)
      if (!selected) {
        const message = '没有识别到划线经过的对象，可改用智能选择或画笔'
        options.setError(message)
        toast.error(message)
        return
      }
      const data = applyMaskSelectionOperation(base, selected, operationMode)
      await options.commitMask(data, {
        component: {
          id: `component-${crypto.randomUUID()}`,
          type: 'raster',
          operation: operationMode,
          enabled: true,
          inverted: false,
          path: '',
          width: maskSize.width,
          height: maskSize.height,
        },
        rasterData: selected,
      })
    } catch (error) {
      if (options.isCurrentOperation(operation)) {
        const message = error instanceof Error ? error.message : '划选失败，请重试'
        options.setError(message)
        toast.error(message)
      }
    } finally {
      options.finishOperation(operation)
    }
  }, [options])
}
