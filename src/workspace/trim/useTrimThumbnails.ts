import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 从视频文件抽取胶片缩略图。
 *
 * 使用隐藏的 HTMLVideoElement 逐帧 seek → drawImage 到 offscreen canvas。
 * 不干扰主预览 video 的播放状态。
 * 每拿到一帧就立即提交，避免等待全部缩略图完成期间出现黑屏。
 */

const THUMB_COUNT = 12
const THUMB_HEIGHT = 144 // 2x 分辨率，对应 track canvas 72px 高度
const EMPTY_THUMBNAIL = new ImageData(1, 1)

interface UseTrimThumbnailsOptions {
  videoPath: string | null
  duration: number
  startTime?: number
  signal?: unknown
}

interface UseTrimThumbnailsResult {
  thumbnails: ImageData[]
  loading: boolean
  refresh: () => void
}

function fileUrl(path: string | null): string {
  if (!path) return ''
  if (path.startsWith('file://')) return path
  return `file://${path.startsWith('/') ? '' : '/'}${path}`
}

function seekThumbnailFrame(video: HTMLVideoElement, time: number): void {
  // 胶片预览不要求逐帧精确，优先跳到邻近关键帧可以显著减少长 GOP 视频的解码等待。
  const fastSeek = (video as HTMLVideoElement & { fastSeek?: (target: number) => void }).fastSeek
  if (typeof fastSeek === 'function') {
    fastSeek.call(video, time)
  } else {
    video.currentTime = time
  }
}

async function loadCachedFrames(videoPath: string, duration: number): Promise<ImageData[] | null> {
  const bytes = await window.luna.workspace.loadTrimThumbnailCache(videoPath, duration)
  if (!bytes) return null

  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
  try {
    if (bitmap.width % THUMB_COUNT !== 0 || bitmap.height !== THUMB_HEIGHT) return null
    const frameWidth = bitmap.width / THUMB_COUNT
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    return Array.from({ length: THUMB_COUNT }, (_, index) => (
      ctx.getImageData(index * frameWidth, 0, frameWidth, THUMB_HEIGHT)
    ))
  } finally {
    bitmap.close()
  }
}

async function saveCachedFrames(videoPath: string, duration: number, frames: ImageData[]): Promise<void> {
  const firstFrame = frames.find((frame) => frame.width > 1 && frame.height > 1)
  if (!firstFrame || frames.length !== THUMB_COUNT) return

  const canvas = document.createElement('canvas')
  canvas.width = firstFrame.width * THUMB_COUNT
  canvas.height = THUMB_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  frames.forEach((frame, index) => {
    if (frame.width > 1 && frame.height > 1) ctx.putImageData(frame, index * firstFrame.width, 0)
  })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) return
  await window.luna.workspace.saveTrimThumbnailCache(videoPath, duration, await blob.arrayBuffer())
}

export function useTrimThumbnails({
  videoPath,
  duration,
  startTime = 0,
  signal,
}: UseTrimThumbnailsOptions): UseTrimThumbnailsResult {
  const [thumbnails, setThumbnails] = useState<ImageData[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const genRef = useRef(0)

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    if (!videoPath || duration <= 0) {
      setThumbnails([])
      return
    }
    const sourcePath = videoPath

    const genId = ++genRef.current
    let aborted = false
    const results: ImageData[] = []
    let processedCount = 0

    setLoading(true)
    setThumbnails([])
    let video: HTMLVideoElement | null = null

    // 计算采样时间点（均匀分布，从 0.05s 开始避免黑帧）
    const times = Array.from({ length: THUMB_COUNT }, (_, i) => {
      const pct = THUMB_COUNT > 1 ? i / (THUMB_COUNT - 1) : 0
      return startTime + pct * (duration - 0.1) + 0.05
    })

    function drawFrame(): void {
      if (aborted || genRef.current !== genId) return cleanup()
      const activeVideo = video
      if (!activeVideo) return

      const idx = processedCount
      const thumbW = Math.round(THUMB_HEIGHT * (16 / 9))
      const canvas = document.createElement('canvas')
      canvas.width = thumbW
      canvas.height = THUMB_HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) { advance(); return }

      try {
        if (activeVideo.videoWidth > 0 && activeVideo.videoHeight > 0) {
          const srcAspect = activeVideo.videoWidth / activeVideo.videoHeight
          const dstAspect = thumbW / THUMB_HEIGHT
          let sx = 0, sy = 0, sw = activeVideo.videoWidth, sh = activeVideo.videoHeight
          if (srcAspect > dstAspect) {
            sw = activeVideo.videoHeight * dstAspect
            sx = (activeVideo.videoWidth - sw) / 2
          } else {
            sh = activeVideo.videoWidth / dstAspect
            sy = (activeVideo.videoHeight - sh) / 2
          }
          ctx.drawImage(activeVideo, sx, sy, sw, sh, 0, 0, thumbW, THUMB_HEIGHT)
          results[idx] = ctx.getImageData(0, 0, thumbW, THUMB_HEIGHT)
        } else {
          results[idx] = new ImageData(1, 1)
        }
      } catch {
        results[idx] = new ImageData(1, 1)
      }

      // 逐张从左到右替换固定位置的空白格，不移动已经显示的缩略图。
      if (genRef.current === genId) {
        setThumbnails(Array.from({ length: THUMB_COUNT }, (_, index) => results[index] ?? EMPTY_THUMBNAIL))
      }
      advance()
    }

    function advance(): void {
      if (aborted || genRef.current !== genId) return cleanup()
      processedCount++
      if (processedCount >= THUMB_COUNT) {
        finish()
        return
      }
      if (video) seekThumbnailFrame(video, times[processedCount])
    }

    function onSeeked(): void {
      if (aborted) return
      // seeked 已表示目标帧可用，立即绘制，避免每张额外等待一个动画帧。
      drawFrame()
    }

    function onError(): void {
      results[processedCount] = new ImageData(1, 1)
      advance()
    }

    // 视频源加载完成后，开始采样
    function onLoaded(): void {
      if (aborted) return
      const activeVideo = video
      if (!activeVideo) return
      if (activeVideo.videoWidth > 0 && activeVideo.videoHeight > 0) {
        const target = times[0]
        // 如果已经定位到目标位置，直接绘制
        if (Math.abs(activeVideo.currentTime - target) < 0.01) {
          drawFrame()
        } else {
          seekThumbnailFrame(activeVideo, target)
        }
      } else {
        finish()
      }
    }

    let loadedCleanup: (() => void) | null = null

    function startLoading(): void {
      if (aborted || video) return
      // 只有缓存未命中时才创建空胶片格和隐藏视频，严格避免与缓存读取并行。
      setThumbnails(Array.from({ length: THUMB_COUNT }, () => EMPTY_THUMBNAIL))
      const nextVideo = document.createElement('video')
      video = nextVideo
      nextVideo.muted = true
      nextVideo.preload = 'auto'
      nextVideo.playsInline = true
      Object.assign(nextVideo.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
        left: '-10px',
        top: '-10px',
      })
      document.body.appendChild(nextVideo)
      nextVideo.addEventListener('seeked', onSeeked)
      nextVideo.addEventListener('error', onError)
      nextVideo.addEventListener('loadedmetadata', onLoaded, { once: true })
      const timeout = window.setTimeout(() => {
        if (processedCount === 0 && !aborted) finish()
      }, 5000)
      loadedCleanup = () => { window.clearTimeout(timeout) }
      nextVideo.src = fileUrl(sourcePath)
      nextVideo.load()
    }

    const cachedFrames = startTime === 0 ? loadCachedFrames(sourcePath, duration) : Promise.resolve(null)
    void cachedFrames
      .then((cachedFrames) => {
        if (aborted || genRef.current !== genId) return
        if (!cachedFrames) {
          startLoading()
          return
        }
        setThumbnails(cachedFrames)
        setLoading(false)
        cleanup()
      })
      .catch(() => {
        if (!aborted && genRef.current === genId) startLoading()
      })

    function finish(): void {
      if (aborted) return
      for (let i = results.length; i < THUMB_COUNT; i++) {
        results[i] = new ImageData(1, 1)
      }
      if (genRef.current === genId) {
        setThumbnails(results.filter(Boolean))
        setLoading(false)
        if (processedCount >= THUMB_COUNT) {
          if (startTime === 0) void saveCachedFrames(sourcePath, duration, results).catch(() => undefined)
        }
      }
      cleanup()
    }

    function cleanup(): void {
      aborted = true
      const activeVideo = video
      video = null
      activeVideo?.removeEventListener('seeked', onSeeked)
      activeVideo?.removeEventListener('error', onError)
      activeVideo?.removeEventListener('loadedmetadata', onLoaded)
      activeVideo?.pause()
      activeVideo?.removeAttribute('src')
      activeVideo?.load()
      if (activeVideo?.parentNode) activeVideo.parentNode.removeChild(activeVideo)
      loadedCleanup?.()
    }

    return cleanup
  }, [videoPath, duration, startTime, refreshKey, signal])

  return { thumbnails, loading, refresh }
}
