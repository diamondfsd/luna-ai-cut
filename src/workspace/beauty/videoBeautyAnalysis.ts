import type { ColorMaskTimeline, EditPipeline } from '../shared/editPipeline'
import type { WorkspaceBeautyAnalysisResult } from '../../shared/types'
import {
  createBeautyMaskLayer,
  replaceVideoBeautyLayers,
  type BeautyParameters,
} from './beautyLayers'

const FULL_REFRESH_INTERVAL = 1
const FLOW_SAMPLE_INTERVAL = 1 / 8
const ACTIVE_MASK_THRESHOLD = 16
const VIDEO_END_MARGIN = 0.05

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
  onTrackingStart: (requestId: string) => void
  onTrackingEnd: (requestId: string) => void
  onProgress?: (completed: number, total: number) => void
  onPartial?: (layers: EditPipeline['beautyMasks'], completed: number, total: number) => void
}

function hasActivePixels(bytes: Uint8Array): boolean {
  return bytes.some((value) => value >= ACTIVE_MASK_THRESHOLD)
}

function upsertFrame(frames: ColorMaskTimeline['frames'], frame: ColorMaskTimeline['frames'][number]): void {
  const existing = frames.findIndex((candidate) => Math.abs(candidate.time - frame.time) < 0.000_1)
  if (existing >= 0) frames[existing] = frame
  else frames.push(frame)
  frames.sort((left, right) => left.time - right.time)
}

export async function analyzeVideoBeauty(options: AnalyzeVideoBeautyOptions): Promise<EditPipeline['beautyMasks'] | null> {
  const {
    operationId, projectId, assetId, filePath, duration, parameters, enabled,
    shouldContinue, onRequestStart, onRequestEnd, onTrackingStart, onTrackingEnd,
    onProgress, onPartial,
  } = options
  const faceFrames: ColorMaskTimeline['frames'] = []
  const bodyFrames: ColorMaskTimeline['frames'] = []
  const createdPaths: string[] = []
  const lastSafeTime = Math.max(0, duration - VIDEO_END_MARGIN)
  const total = Math.max(1, Math.ceil(duration / FLOW_SAMPLE_INTERVAL))
  let dimensions = { width: 512, height: 512 }
  let fallbackPath: string | null = null
  let published = false
  let taskIndex = 0

  const timeline = (frames: ColorMaskTimeline['frames'], endTime: number): ColorMaskTimeline => ({
    version: 1,
    startTime: 0,
    endTime,
    sampleInterval: FLOW_SAMPLE_INTERVAL,
    frames: [...frames],
  })
  const buildLayers = (endTime: number): EditPipeline['beautyMasks'] => {
    const firstFacePath = faceFrames.find((frame) => frame.path)?.path ?? fallbackPath!
    const firstBodyPath = bodyFrames.find((frame) => frame.path)?.path ?? fallbackPath!
    return replaceVideoBeautyLayers(
      { ...createBeautyMaskLayer('face', { ...dimensions, path: firstFacePath }, parameters), enabled, timeline: timeline(faceFrames, endTime) },
      { ...createBeautyMaskLayer('body', { ...dimensions, path: firstBodyPath }, parameters), enabled, timeline: timeline(bodyFrames, endTime) },
    )
  }
  const publish = (coverageEnd: number) => {
    const completed = Math.min(total, Math.max(1, Math.round(coverageEnd / Math.max(duration, FLOW_SAMPLE_INTERVAL) * total)))
    const partial = buildLayers(coverageEnd)
    onPartial?.(partial, completed, total)
    published = Boolean(onPartial) || published
    onProgress?.(completed, total)
  }

  try {
    onProgress?.(0, total)
    let currentTime = 0
    while (currentTime <= lastSafeTime + 0.000_1) {
      if (!shouldContinue()) throw new Error('美颜识别已取消')
      const requestId = `${operationId}-segment-${taskIndex++}`
      onRequestStart(requestId)
      let result: WorkspaceBeautyAnalysisResult
      try {
        result = await window.luna.workspace.analyzeBeauty({ requestId, filePath, frameTime: currentTime, videoFrame: true })
      } finally {
        onRequestEnd(requestId)
      }
      if (!shouldContinue()) throw new Error('美颜识别已取消')

      dimensions = { width: result.width, height: result.height }
      const faceBytes = new Uint8Array(result.faceMask)
      const bodyBytes = new Uint8Array(result.skinMask)
      const faceActive = hasActivePixels(faceBytes)
      const bodyActive = hasActivePixels(bodyBytes)
      const [face, body] = await Promise.all([
        faceActive ? window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.faceMask, 0) : null,
        bodyActive ? window.luna.workspace.saveColorMask(projectId, assetId, result.width, result.height, result.skinMask, 0) : null,
      ])
      if (face) createdPaths.push(face.path)
      if (body) createdPaths.push(body.path)
      if (!fallbackPath) {
        const fallback = await window.luna.workspace.saveColorMask(
          projectId, assetId, result.width, result.height,
          new Uint8Array(result.width * result.height).buffer, 0,
        )
        fallbackPath = fallback.path
        createdPaths.push(fallback.path)
      }
      upsertFrame(faceFrames, { time: currentTime, path: face?.path })
      upsertFrame(bodyFrames, { time: currentTime, path: body?.path })

      const refreshEnd = Math.min(lastSafeTime, currentTime + FULL_REFRESH_INTERVAL)
      let nextTime = Math.min(lastSafeTime + FLOW_SAMPLE_INTERVAL, currentTime + FLOW_SAMPLE_INTERVAL)
      let coverageEnd = Math.min(duration, currentTime + FLOW_SAMPLE_INTERVAL / 2)
      // If either model is empty, the next frame is sampled immediately. Running a full
      // tracking segment for the other layer would be discarded by that earlier refresh.
      if (refreshEnd > currentTime + 0.000_1 && faceActive && bodyActive) {
        const runTracking = async (kind: 'face' | 'body') => {
          const trackingId = `${operationId}-track-${kind}-${taskIndex++}`
          onTrackingStart(trackingId)
          try {
            return await window.luna.workspace.trackMask({
              requestId: trackingId,
              filePath,
              direction: 'forward',
              anchorTime: currentTime,
              endTime: refreshEnd,
              maskWidth: result.width,
              maskHeight: result.height,
              maskBytes: kind === 'face' ? result.faceMask : result.skinMask,
              mode: kind === 'body' ? 'dense-mask' : 'similarity',
              guideMaskBytes: kind === 'body' ? result.trackingGuideMask : undefined,
              guideMaskWidth: kind === 'body' ? result.width : undefined,
              guideMaskHeight: kind === 'body' ? result.height : undefined,
            })
          } catch (error) {
            if (!shouldContinue()) throw error
            return null
          } finally {
            onTrackingEnd(trackingId)
          }
        }
        const [faceTracked, bodyTracked] = await Promise.all([
          faceActive ? runTracking('face') : null,
          bodyActive ? runTracking('body') : null,
        ])
        if (!shouldContinue()) throw new Error('美颜识别已取消')

        const faceLastTime = faceTracked?.keyframes[faceTracked.keyframes.length - 1]?.time ?? currentTime
        const bodyMasks = bodyTracked?.masks ?? []
        const bodyLastTime = bodyMasks[bodyMasks.length - 1]?.time ?? currentTime
        const faceNextTime = faceActive && faceTracked?.completed
          ? refreshEnd
          : Math.min(lastSafeTime + FLOW_SAMPLE_INTERVAL, faceLastTime + FLOW_SAMPLE_INTERVAL)
        const bodyNextTime = bodyActive && bodyTracked?.completed
          ? refreshEnd
          : Math.min(lastSafeTime + FLOW_SAMPLE_INTERVAL, bodyLastTime + FLOW_SAMPLE_INTERVAL)
        nextTime = Math.min(faceNextTime, bodyNextTime)

        for (const keyframe of faceTracked?.keyframes ?? []) {
          if (keyframe.time > nextTime + 0.000_1) continue
          upsertFrame(faceFrames, {
            time: keyframe.time,
            path: face?.path,
            transform: {
              translateX: keyframe.translateX,
              translateY: keyframe.translateY,
              scale: keyframe.scale,
              rotation: keyframe.rotation,
              confidence: keyframe.confidence,
            },
          })
        }
        const bodySamples = (bodyTracked?.masks ?? []).filter((sample) => sample.time <= nextTime + 0.000_1)
        for (const sample of bodySamples) {
          if (!shouldContinue()) throw new Error('美颜识别已取消')
          const saved = await window.luna.workspace.saveColorMask(
            projectId, assetId, sample.width, sample.height, sample.bytes, 0,
          )
          createdPaths.push(saved.path)
          upsertFrame(bodyFrames, { time: sample.time, path: saved.path })
        }
        const faceCoverage = faceActive ? Math.min(nextTime, faceLastTime) : currentTime
        const bodyCoverage = bodyActive ? Math.min(nextTime, bodyLastTime) : currentTime
        coverageEnd = Math.min(duration, Math.min(faceCoverage, bodyCoverage) + FLOW_SAMPLE_INTERVAL / 2)
      }

      publish(coverageEnd)
      if (nextTime > lastSafeTime + 0.000_1) break
      currentTime = Math.max(currentTime + FLOW_SAMPLE_INTERVAL, nextTime)
    }
    if (!shouldContinue()) throw new Error('美颜识别已取消')
    onPartial?.(buildLayers(duration), total, total)
    onProgress?.(total, total)
    return buildLayers(duration)
  } catch (error) {
    if (!published) {
      await Promise.all(createdPaths.map((maskPath) => window.luna.workspace.deleteColorMask(projectId, maskPath).catch(() => undefined)))
    }
    if (!shouldContinue()) return null
    throw error
  }
}
