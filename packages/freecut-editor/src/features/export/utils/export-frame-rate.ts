export interface ExportFramePlan {
  compositionFps: number
  outputFps: number
  durationSeconds: number
  totalFrames: number
}

export function buildExportFramePlan(
  durationInFrames: number,
  compositionFps: number,
  outputFps: number,
): ExportFramePlan {
  const durationSeconds = durationInFrames / compositionFps
  return {
    compositionFps,
    outputFps,
    durationSeconds,
    totalFrames: Math.max(1, Math.round(durationSeconds * outputFps)),
  }
}

export function compositionFrameForOutputFrame(frame: number, plan: ExportFramePlan): number {
  return (frame * plan.compositionFps) / plan.outputFps
}
