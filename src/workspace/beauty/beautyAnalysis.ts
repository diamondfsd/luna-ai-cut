import type { BeautyFaceGeometry } from '../shared/editPipeline'
import { detectBeautyFaces } from './faceLandmarker'
import { detectBodySkinMask } from './skinSegmenter'

export const BEAUTY_ANALYSIS_VERSION = 3

export interface BeautyAnalysisResult {
  faces: BeautyFaceGeometry[]
  skinMask: string
  skinMaskWidth: number
  skinMaskHeight: number
  analysisVersion: number
}

export async function detectBeautyAnalysis(filePath: string): Promise<BeautyAnalysisResult> {
  const [faces, skinMask] = await Promise.all([
    detectBeautyFaces(filePath),
    detectBodySkinMask(filePath),
  ])
  return {
    faces,
    skinMask: skinMask.data,
    skinMaskWidth: skinMask.width,
    skinMaskHeight: skinMask.height,
    analysisVersion: BEAUTY_ANALYSIS_VERSION,
  }
}
