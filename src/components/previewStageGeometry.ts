import { isImagePath, isVideoPath } from '../lib/fileUtils'
import type { PreviewLayer } from '../shared/types'

export interface MediaResolution {
  width: number
  height: number
}

export interface StageSize {
  width: number
  height: number
}

function isValidSize(size: MediaResolution | StageSize | null): size is MediaResolution | StageSize {
  return !!size
    && Number.isFinite(size.width)
    && Number.isFinite(size.height)
    && size.width > 0
    && size.height > 0
}

function containFrame(
  media: MediaResolution,
  stage: StageSize,
): Pick<PreviewLayer, 'dstX' | 'dstY' | 'dstW' | 'dstH'> {
  const mediaAspect = media.width / media.height
  const stageAspect = stage.width / stage.height
  if (stageAspect > mediaAspect) {
    const dstW = mediaAspect / stageAspect
    return { dstX: (1 - dstW) / 2, dstY: 0, dstW, dstH: 1 }
  }
  const dstH = stageAspect / mediaAspect
  return { dstX: 0, dstY: (1 - dstH) / 2, dstW: 1, dstH }
}

export function buildLayers(
  url: string,
  resolution: MediaResolution | null = null,
  stageSize: StageSize | null = null,
): PreviewLayer[] {
  const hasMeasuredFrame = isValidSize(resolution) && isValidSize(stageSize)
  const frame = hasMeasuredFrame
    ? containFrame(resolution, stageSize)
    : { dstX: 0, dstY: 0, dstW: 1, dstH: 1 }
  const baseLayer = {
    ...frame,
    srcX: 0,
    srcY: 0,
    srcW: 1,
    srcH: 1,
    opacity: 1,
    zIndex: 0,
  }
  if (isImagePath(url)) return [{ ...baseLayer, filePath: url }]
  if (isVideoPath(url)) return [{ ...baseLayer, filePath: url, isVideo: true }]
  return []
}

export function calcAspectRatio(width: number, height: number): number {
  if (height === 0) return 1
  return Math.round((width / height) * 100) / 100
}

export function projectCanvasFor(
  resolution: MediaResolution | null,
  maxSide: number,
): StageSize | null {
  if (!resolution) return null
  const sourceMaxSide = Math.max(resolution.width, resolution.height)
  if (sourceMaxSide <= maxSide) return { width: resolution.width, height: resolution.height }
  const scale = maxSide / sourceMaxSide
  return {
    width: Math.max(1, Math.round(resolution.width * scale)),
    height: Math.max(1, Math.round(resolution.height * scale)),
  }
}
