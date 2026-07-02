import { useCallback, useEffect, useRef, useState } from 'react'

import type { EditPipeline } from '../shared/editPipeline'
import { createDefaultPipeline } from '../shared/editPipeline'
import type { ImageCacheEntry } from '../shared/imageCache'
import { workspaceImageCache } from '../shared/imageCache'
import { checkWebGLSupport } from '../renderer/webglCheck'
import { WebGLRenderer } from '../renderer/webglRenderer'
import { filePathToPreviewUrl } from '../../components/previewModalUtils'

export interface CanvasEngineOptions {
  editorOpen: boolean
  activeMedia: { path: string } | null
  onThumbnailReady?: (entry: ImageCacheEntry) => void
  onBrokenPath?: (path: string) => void
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'])

function isVideoPath(path: string): boolean {
  const segments = path.split('.')
  const ext = segments.length > 1 ? segments[segments.length - 1].toLowerCase() : ''
  return VIDEO_EXTS.has(ext)
}

export function useCanvasEngine(options: CanvasEngineOptions) {
  const { editorOpen, activeMedia, onThumbnailReady, onBrokenPath } = options

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const canceledRef = useRef(false)
  const lutRequestRef = useRef(0)
  const loadedMediaPathRef = useRef<string | null>(null)

  // ── Video state ──
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastPipelineRef = useRef<EditPipeline>(createDefaultPipeline())
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
  const [loadedMediaPath, setLoadedMediaPath] = useState<string | null>(null)

  // ═══════════════════════════════════════════════
  //  RAF 循环（视频 — WebGL shader 实时调色）
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
      return
    }
    if (support.message && !support.message.includes('不支持')) {
      setWebglMessage(support.message)
    }
  }, [])

  // ═══════════════════════════════════════════════
  //  WebGL 渲染器初始化（仅一次）
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
  //  渲染 — WorkspacePage pipeline 变化时触发
  // ═══════════════════════════════════════════════

  const render = useCallback((pipeline: EditPipeline, opts?: { cropMode?: boolean }) => {
    lastPipelineRef.current = pipeline
    if (activeMedia && loadedMediaPathRef.current !== activeMedia.path) return
    rendererRef.current?.render(pipeline, { cropMode: opts?.cropMode ?? false })
    updateImageRect()
  }, [activeMedia, updateImageRect])

  // ═══════════════════════════════════════════════
  //  3D LUT — 用烘焙 LUT 替代 GLSL 颜色计算
  // ═══════════════════════════════════════════════

  // B: 烘焙 LUT 并发送到 WebGL 渲染器
  const bakeAndLoadLut = useCallback(async (colorParams: Record<string, unknown>, key: string) => {
    if (!rendererRef.current) return false
    const requestId = ++lutRequestRef.current
    try {
      const result = await window.luna.workspace.bakeAndGetLut(colorParams)
      if (requestId !== lutRequestRef.current) return false
      const floatArray = new Float32Array(result.lutBuffer)
      rendererRef.current.loadLut(floatArray, result.lutSize, key)
      rendererRef.current.render(lastPipelineRef.current)
      updateImageRect()
      return true
    } catch (err) {
      // LUT 烘焙失败，回退到 GLSL
      if (requestId === lutRequestRef.current) rendererRef.current?.clearLut()
      console.warn('[LUT] 烘焙失败，使用 GLSL 回退:', err)
      return false
    }
  }, [updateImageRect])

  // C: 清除 LUT
  const clearLut = useCallback(() => {
    lutRequestRef.current++
    rendererRef.current?.clearLut()
  }, [])

  // ═══════════════════════════════════════════════
  //  Callback refs
  // ═══════════════════════════════════════════════

  const onThumbnailReadyRef = useRef(onThumbnailReady)
  onThumbnailReadyRef.current = onThumbnailReady
  const onBrokenPathRef = useRef(onBrokenPath)
  onBrokenPathRef.current = onBrokenPath

  // ═══════════════════════════════════════════════
  //  加载媒体文件
  // ═══════════════════════════════════════════════

  useEffect(() => {
    if (!activeMedia || !rendererReady) return
    let canceled = false
    canceledRef.current = false
    setImageLoading(true)
    setImageError(null)

    const filePath = activeMedia.path
    const isVid = isVideoPath(filePath)

    loadedMediaPathRef.current = null
    setLoadedMediaPath(null)
    rendererRef.current?.clearSource()

    if (isVid) {
      setIsVideo(true)

      // 先用 ImageCache 帧占位
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
        rendererRef.current?.render(lastPipelineRef.current)
        loadedMediaPathRef.current = filePath
        setLoadedMediaPath(filePath)
        updateImageRect()
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
        if (!canceled) setVideoCurrentTime(video.currentTime)
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
      // 图片：从 ImageCache 加载 bitmap → WebGL 纹理
      workspaceImageCache.generate(filePath).then((entry) => {
        if (canceled) return
        const renderer = rendererRef.current
        if (!renderer) return
        renderer.loadImage(entry.previewBitmap)
        renderer.render(lastPipelineRef.current)
        loadedMediaPathRef.current = filePath
        setLoadedMediaPath(filePath)
        updateImageRect()
        setRendererReady(true)
        setRenderKey((k) => k + 1)
      }).catch(() => {
        if (canceled) return
        setImageError('加载失败')
      }).finally(() => {
        if (!canceled) setImageLoading(false)
      })
    }

    return () => {
      canceled = true
      canceledRef.current = true
      if (isVid) cleanupVideo()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMedia?.path, rendererReady])

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

  const canRender = Boolean(rendererRef.current && activeMedia && loadedMediaPath === activeMedia.path && !imageLoading && !webglMessage?.includes('不支持'))

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
    updateImageRect: () => updateImageRect(),
    rendererReady,
    renderKey,
    loadedMediaPath,
    isVideo,
    videoPlaying,
    videoDuration,
    videoCurrentTime,
    playVideo,
    pauseVideo,
    seekVideo,
    toggleVideoPlayback,
    bakeAndLoadLut,
    clearLut,
  }
}
