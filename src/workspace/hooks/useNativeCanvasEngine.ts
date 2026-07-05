/**
 * useNativeCanvasEngine — Native Core (wgpu) 驱动的 Canvas 引擎
 *
 * 提供和 useCanvasEngine 相同的接口，内部使用 lunaRenderCore (Rust/wgpu)
 * 替代 WebGL。ImagePreview 可无缝切换。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditPipeline } from '../shared/editPipeline'
import { createDefaultPipeline } from '../shared/editPipeline'
import type { ImageCacheEntry } from '../shared/imageCache'
import { workspaceImageCache } from '../shared/imageCache'
import { filePathToPreviewUrl } from '../../lib/fileUtils'

interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
}

function getLunaRC() {
  return (window as any).lunaRenderCore as {
    init: () => Promise<void>
    loadTexture: (data: Uint8Array, w: number, h: number) => Promise<number>
    updateTexture: (id: number, data: Uint8Array) => Promise<void>
    releaseTexture: (id: number) => Promise<void>
    renderFrame: (w: number, h: number, layers: RenderLayer[]) => Promise<Uint8Array>
    destroy: () => Promise<void>
  } | undefined
}

export interface CanvasEngineOptions {
  editorOpen: boolean
  activeMedia: { path: string } | null
  onThumbnailReady?: (entry: ImageCacheEntry) => void
  onBrokenPath?: (path: string) => void
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'])
function isVideoPath(path: string): boolean {
  return VIDEO_EXTS.has(path.split('.').pop()?.toLowerCase() ?? '')
}

export function useNativeCanvasEngine(options: CanvasEngineOptions) {
  const { editorOpen, activeMedia } = options

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const mediaTexIdRef = useRef<number | null>(null)
  const canceledRef = useRef(false)
  const loadedMediaPathRef = useRef<string | null>(null)
  const lastPipelineRef = useRef<EditPipeline>(createDefaultPipeline())

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)
  const [isVideo, setIsVideo] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [isLivePlayback, setIsLivePlayback] = useState(false)
  const [videoDuration] = useState(0)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)

  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [webglMessage, setWebglMessage] = useState<string | null>(null)
  const [imageRect, setImageRect] = useState({ x: 0, y: 0, width: 1, height: 1 })
  const [sourceAspect, setSourceAspect] = useState(1)
  const [rendererReady, setRendererReady] = useState(false)
  const [loadedMediaPath, setLoadedMediaPath] = useState('')

  const canRender = rendererReady && !imageLoading && !webglMessage

  // ═══════════════════════════════════════
  //  init Native Core
  // ═══════════════════════════════════════
  useEffect(() => {
    const lrc = getLunaRC()
    if (!lrc) { setWebglMessage('Native render core 未加载'); return }
    lrc.init().then(() => setRendererReady(true)).catch((e: Error) => setWebglMessage(e.message))
    return () => {
      if (mediaTexIdRef.current != null) lrc.releaseTexture(mediaTexIdRef.current).catch(() => {})
    }
  }, [])

  // ═══════════════════════════════════════
  //  渲染一帧到 Canvas
  // ═══════════════════════════════════════
  const renderFrameToCanvas = useCallback(async (): Promise<void> => {
    const lrc = getLunaRC()
    const cvs = canvasRef.current
    if (!lrc || !cvs || mediaTexIdRef.current == null) return

    const rect = computeImageRect()
    setImageRect(rect)
    const pw = cvs.parentElement?.clientWidth ?? 400
    const ph = cvs.parentElement?.clientHeight ?? 300
    if (pw <= 0 || ph <= 0) return

    try {
      const result = await lrc.renderFrame(pw, ph, [{
        textureId: mediaTexIdRef.current,
        dstX: rect.x / pw, dstY: rect.y / ph,
        dstW: rect.width / pw, dstH: rect.height / ph,
        srcX: 0, srcY: 0, srcW: 1, srcH: 1,
        opacity: 1, zIndex: 0,
      }])
      cvs.width = pw; cvs.height = ph
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)), pw, ph),
        0, 0,
      )
    } catch { /* ignore */ }
  }, [])

  // ═══════════════════════════════════════
  //  加载媒体
  // ═══════════════════════════════════════
  const loadMedia = useCallback(async (filePath: string) => {
    const lrc = getLunaRC()
    if (!lrc || !canvasRef.current) return

    setImageLoading(true); setImageError(null)
    canceledRef.current = false

    try {
      const entry = await workspaceImageCache.generate(filePath)
      if (canceledRef.current) return

      // 用 ImageBitmap 转 Canvas（ImageBitmap 不能直接读像素）
      const c = document.createElement('canvas')
      c.width = entry.width; c.height = entry.height
      c.getContext('2d')!.drawImage(entry.previewBitmap, 0, 0)
      const idata = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
      const rgba = new Uint8Array(idata.data.buffer)

      if (mediaTexIdRef.current != null) {
        await lrc.updateTexture(mediaTexIdRef.current, rgba)
      } else {
        mediaTexIdRef.current = await lrc.loadTexture(rgba, c.width, c.height)
      }

      setSourceAspect(entry.width / entry.height)
      loadedMediaPathRef.current = filePath
      setLoadedMediaPath(filePath)
      await renderFrameToCanvas()

      if (isVideoPath(filePath)) {
        setIsVideo(true)
        if (!videoRef.current) { const v = document.createElement('video'); v.muted = true; v.loop = true; videoRef.current = v }
        videoRef.current.src = filePathToPreviewUrl(filePath) ?? ''
        videoRef.current.load()
      }
    } catch (err) {
      if (!canceledRef.current) setImageError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!canceledRef.current) setImageLoading(false)
    }
  }, [renderFrameToCanvas])

  useEffect(() => {
    if (!editorOpen || !activeMedia?.path || !rendererReady) return
    if (activeMedia.path === loadedMediaPathRef.current) return
    canceledRef.current = false
    loadMedia(activeMedia.path)
    return () => { canceledRef.current = true }
  }, [editorOpen, activeMedia?.path, rendererReady, loadMedia])

  // ═══════════════════════════════════════
  //  public render
  // ═══════════════════════════════════════
  const render = useCallback((pipeline: EditPipeline, _opts?: { cropMode?: boolean; allowStaleLut?: boolean }) => {
    lastPipelineRef.current = pipeline
    renderFrameToCanvas()
  }, [renderFrameToCanvas])

  // ═══════════════════════════════════════
  //  视频
  // ═══════════════════════════════════════
  const grabAndRenderVideoFrame = useCallback(() => {
    const v = videoRef.current; if (!v || v.readyState < 2) return
    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas')
    const c = offscreenRef.current
    const pw = Math.min(v.videoWidth, 720), ph = Math.round(pw / (v.videoWidth / v.videoHeight))
    c.width = pw; c.height = ph
    c.getContext('2d')!.drawImage(v, 0, 0, pw, ph)
    const idata = c.getContext('2d')!.getImageData(0, 0, pw, ph)

    const lrc = getLunaRC(); const cvs = canvasRef.current
    if (!lrc || !cvs || mediaTexIdRef.current == null) return
    lrc.updateTexture(mediaTexIdRef.current, new Uint8Array(idata.data.buffer)).then(() =>
      lrc!.renderFrame(pw, ph, [{ textureId: mediaTexIdRef.current!, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 }])
    ).then((result) => {
      cvs.width = pw; cvs.height = ph
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)), pw, ph),
        0, 0,
      )
    }).catch(() => {})
  }, [])

  const startRafLoop = useCallback(() => {
    function frame(): void {
      if (!videoRef.current || videoRef.current.paused) return
      grabAndRenderVideoFrame()
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [grabAndRenderVideoFrame])

  const playVideo = useCallback(() => {
    const v = videoRef.current; if (!v) return
    v.play().then(() => { setVideoPlaying(true); startRafLoop() }).catch(() => {})
  }, [startRafLoop])

  const pauseVideo = useCallback(() => { videoRef.current?.pause(); setVideoPlaying(false); cancelAnimationFrame(rafRef.current) }, [])
  const toggleVideoPlayback = useCallback(() => { if (videoPlaying) pauseVideo(); else playVideo() }, [videoPlaying, pauseVideo, playVideo])
  const seekVideo = useCallback((time: number) => {
    const v = videoRef.current; if (!v) return
    v.currentTime = time; setVideoCurrentTime(time)
    v.onseeked = () => { grabAndRenderVideoFrame() }
  }, [grabAndRenderVideoFrame])
  const loadLiveVideo = useCallback(async (_source: string) => {}, [])
  const stopLiveVideo = useCallback(() => { setIsLivePlayback(false) }, [])

  // ═══════════════════════════════════════
  //  LUT（占位）
  // ═══════════════════════════════════════
  const bakeAndLoadLut = useCallback(async (_params: any, _key: string) => {}, [])
  const clearLut = useCallback(() => {}, [])

  // ═══════════════════════════════════════
  //  image rect
  // ═══════════════════════════════════════
  const computeImageRect = useCallback(() => {
    const cvs = canvasRef.current
    if (!cvs?.parentElement) return { x: 0, y: 0, width: 1, height: 1 }
    const pw = cvs.parentElement.clientWidth
    const ph = cvs.parentElement.clientHeight
    if (pw <= 0 || ph <= 0) return { x: 0, y: 0, width: 1, height: 1 }
    const ar = sourceAspect || 1
    let w = pw, h = pw / ar
    if (h > ph) { h = ph; w = ph * ar }
    return { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h }
  }, [sourceAspect])

  const updateImageRect = useCallback(() => { setImageRect(computeImageRect()) }, [computeImageRect])

  useEffect(() => {
    const onResize = () => { updateImageRect(); renderFrameToCanvas() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [updateImageRect, renderFrameToCanvas])

  return {
    canvasRef, stageRef,
    imageLoading, imageError, webglMessage,
    imageRect, sourceAspect,
    canRender, rendererReady, renderKey: 0,
    loadedMediaPath,
    isVideo, isLivePlayback,
    videoPlaying, videoDuration, videoCurrentTime,
    render, updateImageRect,
    playVideo, pauseVideo, seekVideo, toggleVideoPlayback,
    loadLiveVideo, stopLiveVideo,
    bakeAndLoadLut, clearLut,
  }
}
