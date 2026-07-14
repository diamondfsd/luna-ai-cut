import type { BeautyFaceGeometry } from '../shared/editPipeline'
export const BEAUTY_ANALYSIS_VERSION = 9

export interface BeautyAnalysisResult {
  faces: BeautyFaceGeometry[]
  skinMask: string
  skinMaskWidth: number
  skinMaskHeight: number
  analysisVersion: number
}

export async function detectBeautyAnalysis(filePath: string): Promise<BeautyAnalysisResult> {
  const api = (window as unknown as {
    lunaRenderCore?: { analyzeBeauty?: (imagePath: string) => Promise<BeautyAnalysisResult> }
  }).lunaRenderCore
  if (!api?.analyzeBeauty) throw new Error('当前版本暂时无法分析这张图片')
  return api.analyzeBeauty(filePath)
}
