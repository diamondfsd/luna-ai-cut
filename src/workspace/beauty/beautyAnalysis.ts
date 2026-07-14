import type { BeautyFaceGeometry } from '../shared/editPipeline'
import { detectBeautyFaces } from './faceLandmarker'
import { detectBodySkinMask } from './skinSegmenter'

export const BEAUTY_ANALYSIS_VERSION = 5

export interface BeautyAnalysisResult {
  faces: BeautyFaceGeometry[]
  skinMask: string
  skinMaskWidth: number
  skinMaskHeight: number
  analysisVersion: number
}

export async function detectBeautyAnalysis(filePath: string): Promise<BeautyAnalysisResult> {
  const skinMask = await detectBodySkinMask(filePath)
  const faces = await detectBeautyFaces(filePath, skinMask.personRegions)
  return {
    faces,
    skinMask: skinMask.data,
    skinMaskWidth: skinMask.width,
    skinMaskHeight: skinMask.height,
    analysisVersion: BEAUTY_ANALYSIS_VERSION,
  }
}
