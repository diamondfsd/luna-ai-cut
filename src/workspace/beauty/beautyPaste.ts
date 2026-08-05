import type { EditPipeline } from '../shared/editPipeline'
import type { BeautyClipboardSettings } from './beautyLayers'
import { analyzeBeautyForPipeline } from './beautyAnalysisClient'

export interface BeautyPasteTarget {
  index: number
  assetId: string
  filePath: string
  pipeline: EditPipeline
}

export async function prepareBeautyPasteTargets(
  projectId: string,
  targets: BeautyPasteTarget[],
  beauty: BeautyClipboardSettings,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<number, EditPipeline>> {
  const output = new Map<number, EditPipeline>()
  for (let position = 0; position < targets.length; position += 1) {
    const target = targets[position]
    onProgress?.(position, targets.length)
    const beautyMasks = await analyzeBeautyForPipeline({
      requestId: `beauty-paste-${crypto.randomUUID()}`,
      projectId,
      assetId: target.assetId,
      filePath: target.filePath,
      parameters: beauty.parameters,
      enabled: beauty.enabled,
    })
    if (beautyMasks) output.set(target.index, { ...target.pipeline, beautyMasks: beautyMasks.layers })
  }
  onProgress?.(targets.length, targets.length)
  return output
}
