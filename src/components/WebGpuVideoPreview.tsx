import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PreviewLayer } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { WebGpuCompositionRenderer } from '../lib/webgpu/composition'
import { readWebGpuLut } from '../lib/webgpu/lut-source'
import { compositionSourceKey, buildCompositionFromPreviewLayers } from './renderComposition'
import { compositionTimeForVideoLayer } from './previewLayerTiming'
import { useCanvasViewportInteraction } from './useCanvasViewportInteraction'
import './WebGpuVideoPreview.css'

interface WebGpuVideoPreviewProps {
  layers: PreviewLayer[]
  canvasWidth: number
  canvasHeight: number
  maxSide?: number
  playing?: boolean
  className?: string
  onError?: (error: string) => void
  onReady?: () => void
  onRender?: () => void
  onVideoElement?: (element: HTMLMediaElement | null) => void
  interactiveImageLayerIndexes?: readonly number[]
  viewportKey?: string
  maxImageScale?: number
  imageScale?: number | null
  onImageScaleChange?: (scale: number | null) => void
  onViewportChange?: () => void
}

interface VideoSourceDescriptor {
  key: string
  filePath: string
  url: string
}

function loadImage(path: string): Promise<HTMLImageElement> {
  const url = filePathToPreviewUrl(path) ?? path
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`图片加载失败: ${path}`))
    image.src = url
  })
}

function videoSourcesForLayers(layers: PreviewLayer[]): VideoSourceDescriptor[] {
  const sources = new Map<string, VideoSourceDescriptor>()
  for (const layer of layers) {
    if (!layer.isVideo) continue
    const key = compositionSourceKey(layer)
    if (!sources.has(key)) {
      sources.set(key, {
        key,
        filePath: layer.filePath,
        url: filePathToPreviewUrl(layer.filePath) ?? layer.filePath,
      })
    }
  }
  return [...sources.values()]
}

function compositionForPreview(
  layers: PreviewLayer[],
  width: number,
  height: number,
  maxSide?: number,
) {
  const composition = buildCompositionFromPreviewLayers(layers, width, height)
  if (maxSide && Math.max(composition.canvas.width, composition.canvas.height) > maxSide) {
    const scale = maxSide / Math.max(composition.canvas.width, composition.canvas.height)
    composition.canvas.width = Math.max(1, Math.round(composition.canvas.width * scale))
    composition.canvas.height = Math.max(1, Math.round(composition.canvas.height * scale))
  }
  return composition
}

export function WebGpuVideoPreview({
  layers,
  canvasWidth,
  canvasHeight,
  maxSide,
  playing = false,
  className,
  onError,
  onReady,
  onRender,
  onVideoElement,
  interactiveImageLayerIndexes,
  viewportKey,
  maxImageScale = 5,
  imageScale,
  onImageScaleChange,
  onViewportChange,
}: WebGpuVideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoElementsRef = useRef(new Map<string, HTMLVideoElement>())
  const videoRefCallbacksRef = useRef(new Map<string, (element: HTMLVideoElement | null) => void>())
  const rendererRef = useRef<WebGpuCompositionRenderer | null>(null)
  const compositionRef = useRef(compositionForPreview(layers, canvasWidth, canvasHeight, maxSide))
  const layersRef = useRef(layers)
  const videoSourcesRef = useRef<VideoSourceDescriptor[]>([])
  const renderRevisionRef = useRef(0)
  const renderingRef = useRef(false)
  const queuedRenderRef = useRef(false)
  const destroyedRef = useRef(false)
  const callbacksRef = useRef({ onError, onReady, onRender, onVideoElement, onViewportChange })
  const primarySourceKeyRef = useRef<string | null>(null)
  const [videoElementRevision, setVideoElementRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  const videoSources = useMemo(() => videoSourcesForLayers(layers), [layers])
  const videoSourceSignature = videoSources.map((source) => `${source.key}\u0000${source.url}`).join('\u0001')
  const primaryLayer = layers.find((layer) => layer.isVideo)
  const primarySourceKey = primaryLayer ? compositionSourceKey(primaryLayer) : null

  callbacksRef.current = { onError, onReady, onRender, onVideoElement, onViewportChange }
  layersRef.current = layers
  videoSourcesRef.current = videoSources
  primarySourceKeyRef.current = primarySourceKey
  compositionRef.current = compositionForPreview(layers, canvasWidth, canvasHeight, maxSide)

  const imageInteraction = useCanvasViewportInteraction({
    layers,
    canvasRef,
    interactiveImageLayerIndexes,
    viewportKey,
    maxImageScale,
    imageScale,
    onImageScaleChange,
  })

  const getVideoRef = useCallback((key: string) => {
    const existing = videoRefCallbacksRef.current.get(key)
    if (existing) return existing
    const callback = (element: HTMLVideoElement | null) => {
      const current = videoElementsRef.current.get(key)
      if (current === element) return
      if (element) videoElementsRef.current.set(key, element)
      else videoElementsRef.current.delete(key)
      setVideoElementRevision((revision) => revision + 1)
      if (key === primarySourceKeyRef.current) {
        callbacksRef.current.onVideoElement?.(element)
      }
    }
    videoRefCallbacksRef.current.set(key, callback)
    return callback
  }, [])

  const compositionTimeForCurrentFrame = useCallback(() => {
    const primary = layersRef.current.find((layer) => layer.isVideo)
    if (!primary) return null
    const primaryKey = compositionSourceKey(primary)
    const primaryVideo = videoElementsRef.current.get(primaryKey)
    if (!primaryVideo || !Number.isFinite(primaryVideo.currentTime)) return null
    return compositionTimeForVideoLayer(primary, primaryVideo.currentTime)
  }, [])

  const syncVideoTimes = useCallback(() => {
    const primary = layersRef.current.find((layer) => layer.isVideo)
    if (!primary) return
    const primaryKey = compositionSourceKey(primary)
    const compositionTime = compositionTimeForCurrentFrame()
    if (compositionTime == null) return

    const targetByKey = new Map<string, number>()
    for (const layer of layersRef.current) {
      if (!layer.isVideo) continue
      const key = compositionSourceKey(layer)
      if (targetByKey.has(key)) continue
      const start = layer.videoTime ?? 0
      const offset = layer.videoOffset ?? 0
      let target = start + Math.max(0, compositionTime - offset)
      if (layer.videoDuration != null && Number.isFinite(layer.videoDuration)) {
        target = Math.min(target, start + Math.max(0, layer.videoDuration - 0.001))
      }
      targetByKey.set(key, Math.max(0, target))
    }

    for (const [key, target] of targetByKey) {
      if (key === primaryKey) continue
      const video = videoElementsRef.current.get(key)
      if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA || video.seeking) continue
      if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target
    }
  }, [compositionTimeForCurrentFrame])

  const renderFrame = useCallback(async () => {
    const renderer = rendererRef.current
    if (!renderer || destroyedRef.current) return
    const videoLayers = layersRef.current.filter((layer) => layer.isVideo)
    if (videoLayers.length === 0) return
    const requiredKeys = new Set(videoLayers.map(compositionSourceKey))
    for (const key of requiredKeys) {
      const video = videoElementsRef.current.get(key)
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    }
    const compositionTime = compositionTimeForCurrentFrame()
    if (compositionTime == null) return
    if (renderingRef.current) {
      queuedRenderRef.current = true
      return
    }

    syncVideoTimes()
    renderingRef.current = true
    queuedRenderRef.current = false
    const revision = renderRevisionRef.current
    try {
      await renderer.render(compositionRef.current, compositionTime)
      await renderer.waitForGpu()
      if (!destroyedRef.current && revision === renderRevisionRef.current) {
        callbacksRef.current.onRender?.()
      }
    } catch (error: unknown) {
      if (!destroyedRef.current && revision === renderRevisionRef.current) {
        const message = error instanceof Error ? error.message : String(error)
        setFatalError(message)
        callbacksRef.current.onError?.(message)
      }
    } finally {
      renderingRef.current = false
      if (queuedRenderRef.current && !destroyedRef.current) {
        queuedRenderRef.current = false
        void renderFrame()
      }
    }
  }, [compositionTimeForCurrentFrame, syncVideoTimes])

  useEffect(() => {
    const canvas = canvasRef.current
    const primaryVideo = primarySourceKey ? videoElementsRef.current.get(primarySourceKey) : null
    if (!canvas || !primaryVideo) return
    destroyedRef.current = false
    const renderer = new WebGpuCompositionRenderer(canvas)
    rendererRef.current = renderer
    const videoElements = videoElementsRef.current
    const imageCache = new Map<string, HTMLImageElement>()
    void renderer.initialize({
      resolveImage: async (path) => {
        const cached = imageCache.get(path)
        if (cached) return cached
        const image = await loadImage(path)
        imageCache.set(path, image)
        return image
      },
      resolveLut: readWebGpuLut,
      resolveSource: async (layer) => {
        if (layer.source.sourceType !== 'video' || !layer.source.key) {
          throw new Error('WebGPU 视频源尚未准备好')
        }
        const video = videoElementsRef.current.get(layer.source.key)
        if (!video) throw new Error(`视频源尚未准备好: ${layer.source.path}`)
        return video
      },
      onDeviceLost: (message) => callbacksRef.current.onError?.(message),
      onError: (message) => callbacksRef.current.onError?.(message),
    }).then(() => {
      if (destroyedRef.current) return
      setReady(true)
      callbacksRef.current.onReady?.()
    }).catch((error: unknown) => {
      if (destroyedRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setFatalError(message)
      callbacksRef.current.onError?.(message)
    })

    return () => {
      destroyedRef.current = true
      renderRevisionRef.current += 1
      renderer.destroy()
      rendererRef.current = null
      imageCache.clear()
      for (const video of videoElements.values()) video.pause()
      callbacksRef.current.onVideoElement?.(null)
    }
    // The first render already has video refs attached. Additional source changes
    // are handled by the source and event effects below without recreating the GPU device.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    for (const source of videoSourcesRef.current) {
      const video = videoElementsRef.current.get(source.key)
      if (!video || video.dataset.webgpuSource === source.url) continue
      video.dataset.webgpuSource = source.url
      video.src = source.url
      video.load()
    }
  }, [videoElementRevision, videoSourceSignature])

  useEffect(() => {
    const listeners: Array<{ video: HTMLVideoElement; type: string; listener: EventListener }> = []
    for (const source of videoSourcesRef.current) {
      const video = videoElementsRef.current.get(source.key)
      if (!video) continue
      const layerForSource = () => layersRef.current.find((layer) => layer.isVideo && compositionSourceKey(layer) === source.key)
      const render = () => { void renderFrame() }
      const initializeTime = () => {
        const layer = layerForSource()
        if (layer && source.key === primarySourceKeyRef.current) {
          const initialTime = layer.videoTime ?? 0
          if (Math.abs(video.currentTime - initialTime) > 0.01) video.currentTime = initialTime
        }
        syncVideoTimes()
        render()
      }
      const onVideoError = () => callbacksRef.current.onError?.(`视频加载失败: ${source.filePath}`)
      for (const [type, listener] of [
        ['loadedmetadata', initializeTime],
        ['loadeddata', initializeTime],
        ['seeked', render],
        ['timeupdate', render],
        ['error', onVideoError],
      ] as const) {
        video.addEventListener(type, listener)
        listeners.push({ video, type, listener })
      }
    }
    callbacksRef.current.onVideoElement?.(
      primarySourceKeyRef.current ? videoElementsRef.current.get(primarySourceKeyRef.current) ?? null : null,
    )
    return () => {
      for (const { video, type, listener } of listeners) video.removeEventListener(type, listener)
    }
  }, [renderFrame, syncVideoTimes, videoElementRevision, videoSourceSignature])

  useEffect(() => {
    if (!ready || fatalError) return
    syncVideoTimes()
    const videos = [...new Set(videoElementsRef.current.values())]
    for (const video of videos) {
      if (playing) {
        video.play().catch((error: unknown) => {
          callbacksRef.current.onError?.(error instanceof Error ? error.message : String(error))
        })
      } else {
        video.pause()
      }
    }
    void renderFrame()
  }, [fatalError, playing, ready, renderFrame, syncVideoTimes])

  useEffect(() => {
    if (!ready || fatalError) return
    let frame = 0
    const tick = () => {
      const primary = primarySourceKeyRef.current
        ? videoElementsRef.current.get(primarySourceKeyRef.current)
        : null
      if (primary && !primary.paused) {
        syncVideoTimes()
        void renderFrame()
      }
      if (!destroyedRef.current && playing) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [fatalError, playing, ready, renderFrame, syncVideoTimes])

  useEffect(() => {
    renderRevisionRef.current += 1
    if (ready && !fatalError) void renderFrame()
  }, [canvasHeight, canvasWidth, fatalError, layers, maxSide, ready, renderFrame])

  useEffect(() => {
    callbacksRef.current.onViewportChange?.()
  }, [imageInteraction.style])

  if (fatalError) return null

  return (
    <>
      <canvas
        ref={canvasRef}
        className={[className, imageInteraction.interactive && 'lrc-render-interactive', imageInteraction.dragging && 'is-dragging'].filter(Boolean).join(' ')}
        style={imageInteraction.style}
        onPointerDown={imageInteraction.onPointerDown}
        onPointerMove={imageInteraction.onPointerMove}
        onPointerUp={imageInteraction.onPointerEnd}
        onPointerCancel={imageInteraction.onPointerEnd}
        onWheel={imageInteraction.onWheel}
        onDoubleClick={imageInteraction.onDoubleClick}
      />
      {videoSources.map((source, index) => (
        <video
          key={source.key}
          ref={getVideoRef(source.key)}
          className="webgpu-video-source"
          preload="auto"
          playsInline
          muted={videoSources.length > 1 || index > 0}
          crossOrigin="anonymous"
          aria-hidden="true"
        />
      ))}
    </>
  )
}
