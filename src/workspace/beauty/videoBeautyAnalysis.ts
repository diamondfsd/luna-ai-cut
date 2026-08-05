import type { ColorMaskTimeline, EditPipeline } from '../shared/editPipeline'
import { maskTimelineSampleTimes } from '../mask/maskTimeline'
import {
  createBeautyMaskLayer,
  replaceVideoBeautyLayers,
  type BeautyParameters,
} from './beautyLayers'

const VIDEO_BEAUTY_SAMPLE_INTERVAL = 0.5
const ACTIVE_MASK_THRESHOLD = 16

interface AnalyzeVideoBeautyOptions {
  operationId: string
  projectId: string
  assetId: string
  filePath: string
  duration: number
  parameters: BeautyParameters
  enabled: boolean
  shouldContinue: () => boolean
  onRequestStart: (requestId: string) => void
  onRequestEnd: (requestId: string) => void
  onProgress?: (completed: number, total: number) => void
}

function hasActivePixels(buffer: ArrayBuffer): boolean {
  return new Uint8Array(buffer).some((value) => value >= ACTIVE_MASK_THRESHOLD)
}

export async function analyzeVideoBeauty({
  operationId,
  projectId,
  assetId,
  filePath,
  duration,
  parameters,
  enabled,
  shouldContinue,
  onRequestStart,
  onRequestEnd,
  onProgress,
}: AnalyzeVideoBeautyOptions): Promise<EditPipeline['beautyMasks'] | null> {
  const times = maskTimelineSampleTimes(duration, VIDEO_BEAUTY_SAMPLE_INTERVAL)
  const faceFrames: ColorMaskTimeline['frames'] = []
  const bodyFrames: ColorMaskTimeline['frames'] = []
  const createdPaths: string[] = []
  let dimensions = { width: 1024, height: 1024 }

  try {
    for (let index = 0; index < times.length; index += 1) {
      if (!shouldContinue()) throw new Error('美颜识别已取消')
      const time = times[index]
      const requestId = `${operationId}-${index}`
      onRequestStart(requestId)
      try {
        const result = await window.luna.workspace.analyzeBeauty({ requestId, filePath, frameTime: time })
        if (!shouldContinue()) throw new Error('美颜识别已取消')
        dimensions = { width: result.width, height: result.height }
        const [face, body] = await Promise.all([
          hasActivePixels(result.faceMask)
            ? window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.faceMask, 0)
            : null,
          hasActivePixels(result.skinMask)
            ? window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.skinMask, 0)
            : null,
        ])
        if (face) createdPaths.push(face.path)
        if (body) createdPaths.push(body.path)
        faceFrames.push({ time, path: face?.path })
        bodyFrames.push({ time, path: body?.path })
      } finally {
        onRequestEnd(requestId)
      }
      onProgress?.(index + 1, times.length)
    }
    if (!shouldContinue()) throw new Error('美颜识别已取消')

    const needsFallback = !faceFrames.some((frame) => frame.path) || !bodyFrames.some((frame) => frame.path)
    const fallback = needsFallback
      ? await window.luna.workspace.saveColorMask(
          projectId,
          assetId,
          dimensions.width,
          dimensions.height,
          new Uint8Array(dimensions.width * dimensions.height).buffer,
          0,
        )
      : null
    if (fallback) createdPaths.push(fallback.path)
    if (!shouldContinue()) throw new Error('美颜识别已取消')
    const timeline = (frames: ColorMaskTimeline['frames']): ColorMaskTimeline => ({
      version: 1,
      startTime: 0,
      endTime: duration,
      sampleInterval: VIDEO_BEAUTY_SAMPLE_INTERVAL,
      frames,
    })
    const firstFacePath = faceFrames.find((frame) => frame.path)?.path ?? fallback!.path
    const firstBodyPath = bodyFrames.find((frame) => frame.path)?.path ?? fallback!.path
    return replaceVideoBeautyLayers(
      { ...createBeautyMaskLayer('face', { ...dimensions, path: firstFacePath }, parameters), enabled, timeline: timeline(faceFrames) },
      { ...createBeautyMaskLayer('body', { ...dimensions, path: firstBodyPath }, parameters), enabled, timeline: timeline(bodyFrames) },
    )
  } catch (error) {
    await Promise.all(createdPaths.map((path) => window.luna.workspace.deleteColorMask(projectId, path).catch(() => undefined)))
    if (!shouldContinue()) return null
    throw error
  }
}
