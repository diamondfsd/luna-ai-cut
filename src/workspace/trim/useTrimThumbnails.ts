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

export function useTrimThumbnails({
  videoPath,
  duration,
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

    const genId = ++genRef.current
    let aborted = false
    const results: ImageData[] = []
    let processedCount = 0

    setLoading(true)
    // 固定所有胶片格的位置，后续只替换对应格子，避免每张出现时整条胶片重新缩放。
    setThumbnails(Array.from({ length: THUMB_COUNT }, () => EMPTY_THUMBNAIL))

    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true

    // 隐藏（不使用 display:none，保持可渲染）
    Object.assign(video.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      left: '-10px',
      top: '-10px',
    })
    document.body.appendChild(video)

    // 计算采样时间点（均匀分布，从 0.05s 开始避免黑帧）
    const times = Array.from({ length: THUMB_COUNT }, (_, i) => {
      const pct = THUMB_COUNT > 1 ? i / (THUMB_COUNT - 1) : 0
      return pct * (duration - 0.1) + 0.05
    })

    function drawFrame(): void {
      if (aborted || genRef.current !== genId) return cleanup()

      const idx = processedCount
      const thumbW = Math.round(THUMB_HEIGHT * (16 / 9))
      const canvas = document.createElement('canvas')
      canvas.width = thumbW
      canvas.height = THUMB_HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) { advance(); return }

      try {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          const srcAspect = video.videoWidth / video.videoHeight
          const dstAspect = thumbW / THUMB_HEIGHT
          let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight
          if (srcAspect > dstAspect) {
            sw = video.videoHeight * dstAspect
            sx = (video.videoWidth - sw) / 2
          } else {
            sh = video.videoWidth / dstAspect
            sy = (video.videoHeight - sh) / 2
          }
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, thumbW, THUMB_HEIGHT)
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
      video.currentTime = times[processedCount]
    }

    function onSeeked(): void {
      if (aborted) return
      // 留一帧给浏览器提交解码结果；连续 seek 时不额外等待一帧。
      requestAnimationFrame(drawFrame)
    }

    function onError(): void {
      results[processedCount] = new ImageData(1, 1)
      advance()
    }

    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)

    // 视频源加载完成后，开始采样
    function onLoaded(): void {
      if (aborted) return
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const target = times[0]
        // 如果已经定位到目标位置，直接绘制
        if (Math.abs(video.currentTime - target) < 0.01) {
          drawFrame()
        } else {
          video.currentTime = target
        }
      } else {
        finish()
      }
    }

    let loadedCleanup: (() => void) | null = null

    function startLoading(): void {
      video.addEventListener('loadedmetadata', onLoaded, { once: true })
      const timeout = window.setTimeout(() => {
        if (processedCount === 0 && !aborted) finish()
      }, 5000)
      loadedCleanup = () => { window.clearTimeout(timeout) }
      video.src = fileUrl(videoPath)
      video.load()
    }

    startLoading()

    function finish(): void {
      if (aborted) return
      for (let i = results.length; i < THUMB_COUNT; i++) {
        results[i] = new ImageData(1, 1)
      }
      if (genRef.current === genId) {
        setThumbnails(results.filter(Boolean))
        setLoading(false)
      }
      cleanup()
    }

    function cleanup(): void {
      aborted = true
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      video.removeEventListener('loadedmetadata', onLoaded)
      video.pause()
      video.removeAttribute('src')
      video.load()
      if (video.parentNode) video.parentNode.removeChild(video)
      loadedCleanup?.()
    }

    return cleanup
  }, [videoPath, duration, refreshKey, signal])

  return { thumbnails, loading, refresh }
}
