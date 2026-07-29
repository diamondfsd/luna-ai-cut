export interface WorkspaceBeautyAnalysisRequest {
  requestId: string
  filePath: string
}

export interface WorkspaceBeautyAnalysisResult {
  requestId: string
  width: number
  height: number
  faceCount: number
  faceMask: ArrayBuffer
  skinMask: ArrayBuffer
  performance: {
    modelLoadMs: number
    imagePrepareMs: number
    inferenceMs: number
    totalMs: number
  }
}
