import type { EditPipeline } from '../shared/editPipeline'
import {
  createBeautyMaskLayer,
  replaceBeautyLayers,
  type BeautyParameters,
} from './beautyLayers'

export interface BeautyAnalysisForPipelineResult {
  layers: EditPipeline['beautyMasks']
  width: number
  height: number
  masks: {
    face: Uint8Array
    body: Uint8Array
  }
}

interface AnalyzeBeautyForPipelineOptions {
  requestId: string
  projectId: string
  assetId: string
  filePath: string
  parameters: BeautyParameters
  enabled?: boolean
  frameTime?: number
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
  frameTime,
  onStatus,
  shouldContinue = () => true,
}: AnalyzeBeautyForPipelineOptions): Promise<BeautyAnalysisForPipelineResult | null> {
  const result = await window.luna.workspace.analyzeBeauty({ requestId, filePath, frameTime })
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
  return {
    layers: layers.map((layer) => layer.id.startsWith('beauty-') ? { ...layer, enabled } : layer),
    width: result.width,
    height: result.height,
    masks: {
      face: new Uint8Array(result.faceMask),
      body: new Uint8Array(result.skinMask),
    },
  }
}
