import type { PreviewLayer } from '../shared/types'

/** 将主视频的源时间换算为输出时间轴时间。 */
export function compositionTimeForVideoLayer(layer: PreviewLayer, sourceTime: number): number {
  const sourceStart = layer.videoTime ?? 0
  const outputOffset = layer.videoOffset ?? 0
  return Math.max(0, sourceTime - sourceStart + outputOffset)
}
