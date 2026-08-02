import type { EditPipeline } from '../shared/editPipeline'
import {
  createBeautyMaskLayer,
  replaceBeautyLayers,
  type BeautyParameters,
} from './beautyLayers'

interface AnalyzeBeautyForPipelineOptions {
  requestId: string
  projectId: string
  assetId: string
  filePath: string
  parameters: BeautyParameters
  enabled?: boolean
  onStatus?: (status: string) => void
  shouldContinue?: () => boolean
}

export async function analyzeBeautyForPipeline({
  requestId,
  projectId,
  assetId,
  filePath,
  parameters,
  enabled = true,
  onStatus,
  shouldContinue = () => true,
}: AnalyzeBeautyForPipelineOptions): Promise<EditPipeline['beautyMasks'] | null> {
  const result = await window.luna.workspace.analyzeBeauty({ requestId, filePath })
  if (!shouldContinue()) return null
  onStatus?.('正在保存美颜区域')
  const [faceSaved, bodySaved, acneSaved, spotSaved, wrinkleSaved] = await Promise.all([
    window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.faceMask, 0),
    window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.skinMask, 0),
    window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.acneMask, 0),
    window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.spotMask, 0),
    window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.wrinkleMask, 0),
  ])
  if (!shouldContinue()) return null
  const layers = replaceBeautyLayers(
    createBeautyMaskLayer('face', faceSaved, parameters),
    createBeautyMaskLayer('body', bodySaved, parameters),
    createBeautyMaskLayer('acne', acneSaved, parameters),
    createBeautyMaskLayer('spot', spotSaved, parameters),
    createBeautyMaskLayer('wrinkle', wrinkleSaved, parameters),
  )
  return layers.map((layer) => layer.id.startsWith('beauty-') ? { ...layer, enabled } : layer)
}
