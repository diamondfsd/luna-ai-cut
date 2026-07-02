import { useCallback, useEffect, useRef, useState } from 'react'

import type { EditPipeline } from '../shared/editPipeline'
import { DEFAULT_PIPELINE } from '../shared/editPipeline'
import type { ImageCacheEntry } from '../shared/imageCache'
import { workspaceImageCache } from '../shared/imageCache'
import { checkWebGLSupport } from '../renderer/webglCheck'
import { WebGLRenderer } from '../renderer/webglRenderer'
import { filePathToPreviewUrl } from '../../components/previewModalUtils'

export interface CanvasEngineOptions {
  editorOpen: boolean
  activeMedia: { path: string } | null
  /** Called after an image loads successfully, to update thumbnail URL */
  onThumbnailReady?: (entry: ImageCacheEntry) => void
  /** Called when image loading fails with a broken-path error */
  onBrokenPath?: (path: string) => void
  /** Called when WebGL fails */
  onWebglError?: (message: string) => void
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'])

function isVideoPath(path: string): boolean {
  const segments = path.split('.')
  const ext = segments.length > 1 ? segments[segments.length - 1].toLowerCase() : ''
  return VIDEO_EXTS.has(ext)
}

export function useCanvasEngine(options: CanvasEngineOptions) {
  const { editorOpen, activeMedia, onThumbnailReady, onBrokenPath, onWebglError } = options

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const canceledRef = useRef(false)

  // ── Video state ──
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const rafRef = useRef<number | null>(null)
  // 存储最近一次渲染的 pipeline，供 RAF 循环使用
  const lastPipelineRef = useRef<EditPipeline>(DEFAULT_PIPELINE)
  const [isVideo, setIsVideo] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)

  // ── Core state ──
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [webglMessage, setWebglMessage] = useState<string | null>(null)
  const [imageRect, setImageRect] = useState({ x: 0, y: 0, width: 1, height: 1 })
  const [sourceAspect, setSourceAspect] = useState(1)
  const [rendererReady, setRendererReady] = useState(false)
  const [renderKey, setRenderKey] = useState(0)

  // ═══════════════════════════════════════════════
  //  RAF 循环
  // ═══════════════════════════════════════════════

  const startRafLoop = useCallback(() => {
    if (rafRef.current !== null) return
    function frame(): void {
      rendererRef.current?.render(lastPipelineRef.current, { cropMode: false })
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
  //  WebGL 检测
  // ═══════════════════════════════════════════════

  useEffect(() => {
    const support = checkWebGLSupport()
    if (!support.supported) {
      setWebglMessage(support.message ?? '当前设备不支持工作台渲染')
      onWebglError?.(support.message ?? '当前设备不支持工作台渲染')
      return
    }
    if (support.message && !support.message.includes('不支持')) {
      setWebglMessage(support.message)
    }
  }, [onWebglError])

  // ═══════════════════════════════════════════════
  //  WebGL 渲染器初始化
  // ═══════════════════════════════════════════════

  useEffect(() => {
    if (!editorOpen || !canvasRef.current || rendererRef.current || webglMessage?.includes('不支持')) {
      return
    }
    try {
      rendererRef.current = new WebGLRenderer(canvasRef.current)
      const bounds = canvasRef.current.getBoundingClientRect()
      rendererRef.current.resize(bounds.width, bounds.height)
      updateImageRect()
      setRendererReady(true)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setWebglMessage(msg)
      onWebglError?.(msg)
    }
    const renderer = rendererRef.current
    return () => {
      cleanupVideo()
      renderer?.destroy()
      rendererRef.current = null
      setRendererReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, webglMessage])

  // ═══════════════════════════════════════════════
  //  更新显示区域
  // ═══════════════════════════════════════════════

  const updateImageRect = useCallback(() => {
    const rect = rendererRef.current?.getDisplayRect()
    if (rect) setImageRect(rect)
    const aspect = rendererRef.current?.getSourceAspect()
    if (aspect) setSourceAspect(aspect)
  }, [])

  // ═══════════════════════════════════════════════
  //  渲染 — 外部调用（page 层 pipeline 变化时触发）
  // ═══════════════════════════════════════════════

  const render = useCallback((pipeline: EditPipeline, opts?: { cropMode?: boolean }) => {
    lastPipelineRef.current = pipeline
    rendererRef.current?.render(pipeline, { cropMode: opts?.cropMode ?? false })
    // 每次渲染后更新裁剪区域坐标，确保 CropOverlay 跟随图片
    updateImageRect()
  }, [updateImageRect])

  // ═══════════════════════════════════════════════
  //  Callback refs（避免 effect 重复触发）
  // ═══════════════════════════════════════════════

  const onThumbnailReadyRef = useRef(onThumbnailReady)
  onThumbnailReadyRef.current = onThumbnailReady
  const onBrokenPathRef = useRef(onBrokenPath)
  onBrokenPathRef.current = onBrokenPath

  // ═══════════════════════════════════════════════
  //  加载媒体文件（图片 → ImageCache； 视频 → ImageCache + video element）
  // ═══════════════════════════════════════════════

  useEffect(() => {
    if (!activeMedia || !rendererReady) return
    let canceled = false
    canceledRef.current = false
    setImageLoading(true)
    setImageError(null)

    const filePath = activeMedia.path
    const isVid = isVideoPath(filePath)

    if (isVid) {
      // ── 视频：创建隐藏 <video> 元素 ──
      setIsVideo(true)

      // 先用 ImageCache 帧快速占位，避免黑屏
      workspaceImageCache.generate(filePath).then((entry) => {
        if (!canceled && rendererRef.current && !rendererRef.current.hasVideoSource()) {
          rendererRef.current?.loadImage(entry.previewBitmap)
          updateImageRect()
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
        rendererRef.current?.loadVideo(video)
        updateImageRect()
        setImageLoading(false)
        setRenderKey((k) => k + 1)
      }

      // loadedmetadata 是最关键的就绪信号（宽度/高度已确定）
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timeoutId)
        onVideoReady()
      }, { once: true })
      // canplay 作为后备
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
          setRenderKey((k) => k + 1)
          setVideoCurrentTime(video.currentTime)
        }
      })

      // 视频加载失败 — 保留 isVideo=true（控件可见），用 ImageCache 帧垫底
      video.addEventListener('error', () => {
        if (canceled) return
        clearTimeout(timeoutId)
        setImageLoading(false)
        // 尝试用 ImageCache 帧触发渲染
        setRenderKey((k) => k + 1)
      })

      // 10 秒超时 — 仍未就绪时 fallback 到 ImageCache 帧
      const timeoutId = window.setTimeout(() => {
        if (canceled || videoReady) return
        setImageLoading(false)
        setRenderKey((k) => k + 1)
      }, 10000)

      const url = filePathToPreviewUrl(filePath)
      if (url) video.src = url
      videoRef.current = video
    } else {
      // ── 图片：走 ImageCache ──
      workspaceImageCache.generate(filePath)
        .then((entry) => {
          if (canceled) return
          rendererRef.current?.loadImage(entry.previewBitmap)
          updateImageRect()
          onThumbnailReadyRef.current?.(entry)
          setRenderKey((k) => k + 1)
        })
        .catch((error) => {
          if (canceled) return
          const msg = error instanceof Error ? error.message : String(error)
          setImageError(msg)
          if (
            msg.includes('Input file is missing') ||
            msg.includes('文件不存在') ||
            msg.includes('no such file') ||
            msg.includes('ENOENT')
          ) {
            onBrokenPathRef.current?.(filePath)
          }
        })
        .finally(() => {
          if (!canceled) setImageLoading(false)
        })
    }

    return () => {
      canceled = true
      canceledRef.current = true
      if (isVid) {
        cleanupVideo()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMedia?.path, rendererReady, updateImageRect])

  // ═══════════════════════════════════════════════
  //  窗口尺寸变化
  // ═══════════════════════════════════════════════

  useEffect(() => {
    if (!stageRef.current || !rendererRef.current) return
    const observer = new ResizeObserver(() => {
      const bounds = stageRef.current?.getBoundingClientRect()
      if (!bounds) return
      rendererRef.current?.resize(bounds.width, bounds.height)
      updateImageRect()
      setRenderKey((k) => k + 1)
    })
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [updateImageRect])

  // ═══════════════════════════════════════════════
  //  视频播放控制（暴露给外部）
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

  // ── 当 activeMedia 从视频切换到其他时清理视频 ──
  useEffect(() => {
    if (isVideoPath(activeMedia?.path ?? '')) return
    cleanupVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMedia?.path])

  const canRender = Boolean(rendererRef.current && activeMedia && !webglMessage?.includes('不支持'))

  return {
    canvasRef,
    stageRef,
    imageLoading,
    imageError,
    webglMessage,
    imageRect,
    sourceAspect,
    canRender,
    render,
    updateImageRect,
    rendererReady,
    renderKey,
    // Video
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
