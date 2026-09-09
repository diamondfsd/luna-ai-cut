export interface WorkspaceBeautyAnalysisRequest {
  requestId: string
  filePath: string
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
