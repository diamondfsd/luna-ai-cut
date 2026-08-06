import { useCallback, useEffect, useRef, useState } from 'react'

import { toast } from '../../ui'
import type { EditPipeline } from '../shared/editPipeline'
import { analyzeAutoColor } from './autoColorAnalysis'

const ANALYSIS_MAX_SIDE = 384
const VIDEO_SAMPLE_POSITIONS = [0.12, 0.31, 0.5, 0.69, 0.88]

interface UseAutoColorOptions {
  filePath: string | null
  mediaKind: 'image' | 'video' | null
  enabled: boolean
  onApply: (patch: Partial<EditPipeline['color']>) => void
}

function previewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function fileUrl(filePath: string): string {
  if (filePath.startsWith('file://')) return filePath
  const normalized = filePath.replace(/\\/g, '/')
  return encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
}

function waitForVideoEvent(video: HTMLVideoElement, successEvent: 'loadedmetadata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('视频画面读取超时')), 10000)
    const finish = (error?: Error): void => {
      window.clearTimeout(timeout)
      video.removeEventListener(successEvent, handleSuccess)
      video.removeEventListener('error', handleError)
      if (error) reject(error)
      else resolve()
    }
    const handleSuccess = (): void => finish()
    const handleError = (): void => finish(new Error('无法读取视频画面'))
    video.addEventListener(successEvent, handleSuccess, { once: true })
    video.addEventListener('error', handleError, { once: true })
  })
}

async function analyzeImagePreview(filePath: string): Promise<ReturnType<typeof analyzeAutoColor>> {
  const preview = await window.luna.workspace.loadPreview(filePath)
  const bitmap = await createImageBitmap(new Blob([preview.buffer], { type: preview.mimeType }))
  try {
    const { width, height } = previewSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前设备无法分析图片颜色')
    context.drawImage(bitmap, 0, 0, width, height)
    return analyzeAutoColor(context.getImageData(0, 0, width, height))
  } finally {
    bitmap.close()
  }
}

async function analyzeVideoPreview(filePath: string): Promise<ReturnType<typeof analyzeAutoColor>> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  const metadataReady = waitForVideoEvent(video, 'loadedmetadata')
  video.src = fileUrl(filePath)
  try {
    await metadataReady
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error('无法读取视频时长或画面尺寸')
    }
    const { width, height } = previewSize(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前设备无法分析视频颜色')
    const frames: Uint8ClampedArray[] = []
    for (const position of VIDEO_SAMPLE_POSITIONS) {
      const frameReady = waitForVideoEvent(video, 'seeked')
      video.currentTime = Math.max(0, Math.min(video.duration * position, video.duration - 0.01))
      await frameReady
      context.drawImage(video, 0, 0, width, height)
      frames.push(context.getImageData(0, 0, width, height).data)
    }
    const data = new Uint8ClampedArray(frames.reduce((total, frame) => total + frame.length, 0))
    let offset = 0
    for (const frame of frames) {
      data.set(frame, offset)
      offset += frame.length
    }
    return analyzeAutoColor({ data, width, height: height * frames.length })
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
}

export function useAutoColor(options: UseAutoColorOptions) {
  const [loading, setLoading] = useState(false)
  const requestRef = useRef<string | null>(null)

  useEffect(() => {
    requestRef.current = null
    setLoading(false)
    return () => { requestRef.current = null }
  }, [options.filePath])

  const apply = useCallback(async (): Promise<void> => {
    if (!options.enabled || !options.filePath || loading) return
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setLoading(true)
    try {
      const patch = options.mediaKind === 'video'
        ? await analyzeVideoPreview(options.filePath)
        : await analyzeImagePreview(options.filePath)
      if (requestRef.current !== requestId) return
      if (!patch) {
        toast.error('这张照片暂时无法稳定完成 AI 调色')
        return
      }
      options.onApply(patch)
      toast.success('已完成 AI 调色')
    } catch (error) {
      if (requestRef.current === requestId) {
        toast.error(error instanceof Error ? error.message : 'AI 调色失败，请重试')
      }
    } finally {
      if (requestRef.current === requestId) {
        requestRef.current = null
        setLoading(false)
      }
    }
  }, [loading, options])

  return { loading, apply }
}
