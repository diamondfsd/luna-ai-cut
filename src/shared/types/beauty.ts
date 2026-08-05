export interface WorkspaceBeautyAnalysisRequest {
  requestId: string
  filePath: string
  /** 视频素材从该时间点取帧；图片素材忽略。 */
  frameTime?: number
  /** 视频逐帧分析只生成皮肤蒙版，并使用较轻量的输出尺寸。 */
  videoFrame?: boolean
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
  /** 仅用于视频身体蒙版追踪，不参与美颜渲染。 */
  trackingGuideMask: ArrayBuffer
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
