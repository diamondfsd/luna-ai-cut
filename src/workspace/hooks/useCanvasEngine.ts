import { useCallback, useEffect, useRef, useState } from 'react'

import type { EditPipeline } from '../shared/editPipeline'
import type { ImageCacheEntry } from '../shared/imageCache'
import { workspaceImageCache } from '../shared/imageCache'
import { filePathToPreviewUrl } from '../../components/previewModalUtils'
import { logger } from '../../lib/rendererLogger'

export interface CanvasEngineOptions {
  editorOpen: boolean
  activeMedia: { path: string } | null
  onThumbnailReady?: (entry: ImageCacheEntry) => void
  onBrokenPath?: (path: string) => void
  /** Called when ffmpeg preview is unavailable */
  /** Called when preview fails */
  onPreviewError?: (message: string) => void
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'])
const PREVIEW_MAX_SIZE = 480

function isVideoPath(path: string): boolean {
  const segments = path.split('.')
  const ext = segments.length > 1 ? segments[segments.length - 1].toLowerCase() : ''
  return VIDEO_EXTS.has(ext)
}

function colorParamsFromPipeline(color: EditPipeline['color']): Record<string, number> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { whiteBalanceMode, gradeShadowsHue, gradeMidHue, gradeHighlightsHue, curve, ...rest } = color
  return rest as Record<string, number>
}

export function useCanvasEngine(options: CanvasEngineOptions) {
  const { activeMedia, onPreviewError } = options

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canceledRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const onThumbnailReadyRef = useRef(options.onThumbnailReady)
  onThumbnailReadyRef.current = options.onThumbnailReady
  // 防抖定时器
  const debounceRef = useRef<number | null>(null)

  // ── 当前预览图片的 URL（ffmpeg 输出） ──
  const previewUrlRef = useRef<string | null>(null)

  // ── Video state ──
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)

  // ── Core state ──
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [previewMessage, setPreviewMessage] = useState<string | null>(null)
  const [imageRect, setImageRect] = useState({ x: 0, y: 0, width: 1, height: 1 })
  const [sourceAspect, setSourceAspect] = useState(1)
  const [rendererReady, setRendererReady] = useState(false)
  const [renderKey, setRenderKey] = useState(0)

  // ═══════════════════════════════════════════════
  //  渲染 — ffmpeg 预览（替代 WebGL）
  // ═══════════════════════════════════════════════

  const render = useCallback((pipeline: EditPipeline, _opts?: { cropMode?: boolean }) => {
    const colors = colorParamsFromPipeline(pipeline.color)
    const srcPath = activeMedia?.path
    if (!srcPath || !canvasRef.current) return

    // 防抖 150ms，避免滑块拖动时频繁 IPC
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      try {
        const result = await window.luna.workspace.previewColor(srcPath, colors, {
          maxSize: PREVIEW_MAX_SIZE,
          seekSeconds: videoRef.current?.currentTime,
        })
        if (!result?.path || canceledRef.current) return

        // Load the preview image onto canvas
        const img = new Image()
        img.onload = () => {
          if (canceledRef.current) return
          const canvas = canvasRef.current
          if (!canvas) return
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0)

          // Update display rect
          const stage = stageRef.current
          if (stage) {
            const bounds = stage.getBoundingClientRect()
            const containW = Math.min(bounds.width, bounds.height * (img.width / img.height))
            const containH = Math.min(bounds.height, bounds.width / (img.width / img.height))
            setImageRect({
              x: (bounds.width - containW) / 2,
              y: (bounds.height - containH) / 2,
              width: containW,
              height: containH,
            })
            setSourceAspect(img.width / img.height)
          }
          setImageLoading(false)
          setRenderKey((k) => k + 1)
          // Revoke old preview URL
          if (previewUrlRef.current && previewUrlRef.current !== result.path) {
            URL.revokeObjectURL(previewUrlRef.current)
          }
          previewUrlRef.current = result.path
        }
        img.onerror = () => {
          logger.warn('[CanvasEngine] 预览图片加载失败', { path: result.path })
        }
        // Local file path → use file:// URL
        img.src = `file://${result.path}`
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logger.warn('[CanvasEngine] ffmpeg预览失败', { error: msg })
        onPreviewError?.(msg)
      }
    }, 150)
  }, [activeMedia?.path, onPreviewError])

  // ═══════════════════════════════════════════════
  //  RAF 循环（视频专用）
  // ═══════════════════════════════════════════════

  const startRafLoop = useCallback(() => {
    if (rafRef.current !== null) return
    function frame(): void {
      // 视频播放时，定期从 video 元素截帧到 canvas
      const vid = videoRef.current
      const canvas = canvasRef.current
      if (vid && canvas && !vid.paused) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          canvas.width = vid.videoWidth
          canvas.height = vid.videoHeight
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
        }
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [])

  const stopRafLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  // ═══════════════════════════════════════════════
  //  清理视频资源
  // ═══════════════════════════════════════════════

  const cleanupVideo = useCallback(() => {
    stopRafLoop()
    const vid = videoRef.current
    if (vid) {
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
      vid.remove()
      videoRef.current = null
    }
    setIsVideo(false)
    setVideoPlaying(false)
    setVideoDuration(0)
    setVideoCurrentTime(0)
  }, [stopRafLoop])

  // ═══════════════════════════════════════════════
  //  加载媒体文件（图片 → 直接显示；视频 → video element + ffmpeg 帧处理）
  // ═══════════════════════════════════════════════

  useEffect(() => {
    if (!activeMedia) return
    let canceled = false
    canceledRef.current = false
    setImageLoading(true)
    setImageError(null)
    setPreviewMessage(null)

    const filePath = activeMedia.path
    const isVid = isVideoPath(filePath)

    if (isVid) {
      setIsVideo(true)

      // 先用 ImageCache 帧快速占位
      workspaceImageCache.generate(filePath).then((entry) => {
        if (!canceled) {
          const canvas = canvasRef.current
          if (canvas) {
            canvas.width = entry.previewBitmap.width
            canvas.height = entry.previewBitmap.height
            const ctx = canvas.getContext('2d')
            ctx?.drawImage(entry.previewBitmap, 0, 0)
            updateImageRect(entry.previewBitmap.width, entry.previewBitmap.height)
          }
          setRenderKey((k) => k + 1)
        }
        if (!canceled) onThumbnailReadyRef.current?.(entry)
      }).catch(() => {})

      const video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      video.crossOrigin = 'anonymous'
      video.playsInline = true

      let videoReady = false
      const onVideoReady = (): void => {
        if (canceled || videoReady) return
        videoReady = true
        if (Number.isFinite(video.duration)) setVideoDuration(video.duration)
        setImageLoading(false)
        setRenderKey((k) => k + 1)
      }

      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timeoutId)
        if (Number.isFinite(video.duration)) setVideoDuration(video.duration)
      }, { once: true })
      video.addEventListener('canplay', onVideoReady, { once: true })

      video.addEventListener('timeupdate', () => {
        if (!canceled) setVideoCurrentTime(video.currentTime)
      }, { passive: true })

      video.addEventListener('ended', () => {
        if (canceled) return
        setVideoPlaying(false)
        stopRafLoop()
      })

      video.addEventListener('seeked', () => {
        if (!canceled) {
          setVideoCurrentTime(video.currentTime)
        }
      })

      video.addEventListener('error', () => {
        if (canceled) return
        clearTimeout(timeoutId)
        setImageLoading(false)
        setRenderKey((k) => k + 1)
      })

      const timeoutId = window.setTimeout(() => {
        if (canceled || videoReady) return
        setImageLoading(false)
        setRenderKey((k) => k + 1)
      }, 10000)

      const url = filePathToPreviewUrl(filePath)
      if (url) video.src = url
      videoRef.current = video
    } else {
      // 图片：直接加载原始图到 canvas
      const img = new Image()
      img.onload = () => {
        if (canceled) return
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(img, 0, 0)
        updateImageRect(img.width, img.height)
        setImageLoading(false)
        setRendererReady(true)
        setRenderKey((k) => k + 1)
      }
      img.onerror = () => {
        if (canceled) return
        setImageError('加载失败')
        setImageLoading(false)
      }
      img.src = filePathToPreviewUrl(filePath) ?? `file://${filePath}`
    }

    return () => {
      canceled = true
      canceledRef.current = true
      if (isVid) cleanupVideo()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMedia?.path])

  // ═══════════════════════════════════════════════
  //  更新显示区域
  // ═══════════════════════════════════════════════

  const updateImageRect = useCallback((w?: number, h?: number) => {
    const stage = stageRef.current
    if (!stage) return
    const bounds = stage.getBoundingClientRect()
    const aspect = (w && h) ? w / h : (sourceAspect || 1)
    const containW = Math.min(bounds.width, bounds.height * aspect)
    const containH = Math.min(bounds.height, bounds.width / aspect)
    setImageRect({
      x: (bounds.width - containW) / 2,
      y: (bounds.height - containH) / 2,
      width: containW,
      height: containH,
    })
    if (w && h) setSourceAspect(aspect)
  }, [sourceAspect])

  // ═══════════════════════════════════════════════
  //  窗口尺寸变化
  // ═══════════════════════════════════════════════

  useEffect(() => {
    if (!stageRef.current) return
    const observer = new ResizeObserver(() => {
      updateImageRect()
      setRenderKey((k) => k + 1)
    })
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [updateImageRect])

  // ═══════════════════════════════════════════════
  //  视频播放控制
  // ═══════════════════════════════════════════════

  const playVideo = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    vid.play().then(() => {
      setVideoPlaying(true)
      startRafLoop()
    }).catch(() => {})
  }, [startRafLoop])

  const pauseVideo = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    vid.pause()
    setVideoPlaying(false)
    stopRafLoop()
  }, [stopRafLoop])

  const seekVideo = useCallback((time: number) => {
    const vid = videoRef.current
    if (!vid) return
    vid.currentTime = time
  }, [])

  const toggleVideoPlayback = useCallback(() => {
    if (videoPlaying) pauseVideo()
    else playVideo()
  }, [videoPlaying, playVideo, pauseVideo])

  useEffect(() => {
    if (isVideoPath(activeMedia?.path ?? '')) return
    cleanupVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMedia?.path])

  const canRender = Boolean(activeMedia && !imageError)

  return {
    canvasRef,
    stageRef,
    imageLoading,
    imageError,
    previewMessage,
    imageRect,
    sourceAspect,
    canRender,
    render,
    updateImageRect: () => updateImageRect(),
    rendererReady,
    renderKey,
    isVideo,
    videoPlaying,
    videoDuration,
    videoCurrentTime,
    playVideo,
    pauseVideo,
    seekVideo,
    toggleVideoPlayback,
  }
}
