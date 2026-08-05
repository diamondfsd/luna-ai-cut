export interface WorkspaceBeautyAnalysisRequest {
  requestId: string
  filePath: string
  /** 视频素材从该时间点取帧；图片素材忽略。 */
  frameTime?: number
}

export interface WorkspaceBeautyAnalysisResult {
  requestId: string
  width: number
  height: number
  faceCount: number
  acneCount: number
  spotCount: number
  wrinkleCount: number
  faceMask: ArrayBuffer
  skinMask: ArrayBuffer
  acneMask: ArrayBuffer
  spotMask: ArrayBuffer
  wrinkleMask: ArrayBuffer
  performance: {
    modelLoadMs: number
    imagePrepareMs: number
    inferenceMs: number
    totalMs: number
  }
}
