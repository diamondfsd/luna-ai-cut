import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  memo,
} from 'react'
import type { CompositionInput, PreviewLayer } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { logger } from '../lib/rendererLogger'
import { buildCompositionFromPreviewLayers, COMPOSITION_RENDER_FPS } from './renderComposition'
import { useCanvasViewportInteraction } from './useCanvasViewportInteraction'
import { Button } from '../ui'
import './LrcRender.css'

const PREVIEW_TEXTURE_MAX_SIDE = 3840

export interface LrcRenderHandle {
  exportImage(outputPath: string, width: number, height: number, format: string, quality: number): Promise<void>
  exportVideo(
    outputPath: string,
    width: number,
    height: number,
    options?: { fps?: number | null; hardware?: boolean; taskId?: string; qualityPreset?: string },
  ): Promise<void>
}

export type { PreviewLayer }

export interface LrcRenderProps {
  layers: PreviewLayer[]
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
  className?: string
  onError?: (error: string) => void
  onReady?: () => void
  onRender?: () => void
  onMediaSize?: (width: number, height: number) => void
  maxSide?: number
  canvasWidth?: number
  canvasHeight?: number
  onVideoElement?: (el: HTMLVideoElement | null) => void
  /** 允许画布查看交互的图片图层下标；默认包含所有普通图片，传空数组可关闭。 */
  interactiveImageLayerIndexes?: readonly number[]
  /** 最大查看比例，1 表示画布像素与屏幕 CSS 像素 1:1；默认最大 200%。 */
  maxImageScale?: number
  /** 受控查看比例：null 表示适应窗口，1 表示画布像素与屏幕像素 1:1。 */
  imageScale?: number | null
  onImageScaleChange?: (scale: number | null) => void
  /** 画布缩放或平移后通知外部覆盖层同步位置。 */
  onViewportChange?: () => void
}

interface RenderPreviewOutput {
  width: number
  height: number
  data: Uint8Array | ArrayBuffer | { data?: number[] }
}

interface CachedPreviewFrame {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

interface LunaRenderCore {
  init: () => Promise<void>
  resetCompatibilityBlock?: () => Promise<void>
  renderPreview: (input: { maxSide?: number; width?: number; height?: number; layers: PreviewLayer[] }) => Promise<RenderPreviewOutput>
  renderCompositionFrame: (composition: CompositionInput, time: number, maxSide?: number) => Promise<RenderPreviewOutput>
  renderCompositionFrameAsync: (composition: CompositionInput, time: number, maxSide?: number) => Promise<RenderPreviewOutput>
  exportCompositionVideo: (
    outputPath: string,
    composition: CompositionInput,
    fps: number | null,
    duration: number | null,
    hardware: boolean,
    taskId?: string,
    qualityPreset?: string,
  ) => Promise<void>
  exportCompositionImage: (
    outputPath: string,
    composition: CompositionInput,
    format: string,
    quality: number,
  ) => Promise<void>
}

function getLRC(): LunaRenderCore | undefined {
  return (window as unknown as { lunaRenderCore?: LunaRenderCore }).lunaRenderCore
}

function layerKey(layer: PreviewLayer): string {
  return `${layer.isVideo ? 'v' : 's'}:${layer.filePath}`
}

function sortedLayers(layers: PreviewLayer[]): PreviewLayer[] {
  return [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
}

function bytesFromRenderData(data: RenderPreviewOutput['data']): Uint8ClampedArray {
  if (data instanceof Uint8Array) {
    // 直接创建新的 Uint8ClampedArray，避免 SharedArrayBuffer 问题
    const copy = new Uint8ClampedArray(data.byteLength)
    copy.set(data)
    return copy
  }
  if (data instanceof ArrayBuffer) return new Uint8ClampedArray(data)
  if (Array.isArray(data.data)) return new Uint8ClampedArray(data.data)
  return new Uint8ClampedArray(data as ArrayBuffer)
}

// 自定义比较函数：JSON 序列化对比，避免手动维护字段列表
const layersEqual = (prevLayers: PreviewLayer[], nextLayers: PreviewLayer[]): boolean =>
  JSON.stringify(prevLayers) === JSON.stringify(nextLayers)

export const LrcRender = memo(forwardRef<LrcRenderHandle, LrcRenderProps>(function LrcRender(
  {
    layers,
    canvasRef: extRef,
    className,
    onError,
    onReady,
    onRender,
    onMediaSize,
    maxSide,
    canvasWidth,
    canvasHeight,
    onVideoElement,
    interactiveImageLayerIndexes,
    maxImageScale = 2,
    imageScale,
    onImageScaleChange,
    onViewportChange,
  },
  ref,
) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const imageInteraction = useCanvasViewportInteraction({
    layers,
    canvasRef,
    interactiveImageLayerIndexes,
    maxImageScale,
    imageScale,
    onImageScaleChange,
  })
  const layersRef = useRef<PreviewLayer[]>(layers)
  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const videoElementCalledRef = useRef(false)
  const renderingRef = useRef(false)
  const renderQueuedRef = useRef(false)
  const firstRenderTraceRef = useRef(true)
  const lastVideoFrameAtRef = useRef(0)
  const lastMediaSizeRef = useRef<[number, number]>([0, 0])
  const staticFrameCacheRef = useRef(new Map<string, CachedPreviewFrame>())
  const isSeekingRef = useRef(false) // 标记是否正在 seek
  const seekStartTimeRef = useRef<number | null>(null) // 记录 seek 开始时间
  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  layersRef.current = layers

  useLayoutEffect(() => {
    onViewportChange?.()
  }, [imageInteraction.style, onViewportChange])

  async function initializeRenderer(lrc: LunaRenderCore): Promise<void> {
    logger.info('[预览诊断] 渲染引擎初始化开始')
    await lrc.init()
    logger.info('[预览诊断] 渲染引擎初始化完成')
  }

  useEffect(() => {
    const lrc = getLRC()
    if (!lrc) {
      const msg = '渲染引擎未加载'
      setFatalError(msg)
      onError?.(msg)
      return
    }
    destroyRef.current = false
    initializeRenderer(lrc)
      .then(() => {
        if (!destroyRef.current) {
          setReady(true)
          onReady?.()
        }
      })
      .catch((error: Error) => {
        if (destroyRef.current) return
        logger.error('[预览诊断] 渲染引擎初始化失败', { error: error.message })
        const message = '当前显卡驱动无法打开预览，请更新显卡驱动并重启电脑后再试。'
        setFatalError(message)
        onError?.(message)
      })
    return () => {
      destroyRef.current = true
      cancelAnimationFrame(rafRef.current)
      for (const [, video] of videosRef.current) video.pause()
      videosRef.current.clear()
      onVideoElement?.(null)
    }
  }, [])

  async function retryInitialization(): Promise<void> {
    const lrc = getLRC()
    if (!lrc || retrying) return
    setRetrying(true)
    setFatalError(null)
    try {
      await lrc.resetCompatibilityBlock?.()
      await initializeRenderer(lrc)
      setReady(true)
      onReady?.()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      logger.error('[预览诊断] 渲染引擎重新检测失败', { error: detail })
      const message = '仍然无法打开预览，请确认显卡驱动已更新并重启电脑。'
      setFatalError(message)
      onError?.(message)
    } finally {
      setRetrying(false)
    }
  }

  function layersWithVideoTime(): PreviewLayer[] {
    return sortedLayers(layersRef.current).map((layer) => {
      if (!layer.isVideo) return layer
      const video = videosRef.current.get(layerKey(layer))
      return { ...layer, videoTime: video?.currentTime ?? layer.videoTime ?? 0 }
    })
  }

  function staticFrameKey(renderLayers: PreviewLayer[], effectiveMaxSide: number): string | null {
    if (renderLayers.some((layer) => layer.isVideo)) return null
    return JSON.stringify({ canvasWidth, canvasHeight, maxSide: effectiveMaxSide, layers: renderLayers })
  }

  function paintFrame(frame: CachedPreviewFrame): void {
    const canvas = canvasRef.current
    if (!canvas) return
    const sizeChanged = canvas.width !== frame.width || canvas.height !== frame.height
    if (sizeChanged) {
      canvas.width = frame.width
      canvas.height = frame.height
    }
    const context = canvas.getContext('2d')
    if (!context) throw new Error('画布不可用')
    context.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0)
    if (sizeChanged) imageInteraction.syncControlledScale()
    if (frame.width !== lastMediaSizeRef.current[0] || frame.height !== lastMediaSizeRef.current[1]) {
      lastMediaSizeRef.current = [frame.width, frame.height]
      onMediaSize?.(frame.width, frame.height)
    }
    onRender?.()
  }

  async function renderPreviewFrame() {
    const lrc = getLRC()
    const canvas = canvasRef.current
    if (!lrc || !canvas || destroyRef.current) return
    if (renderingRef.current) {
      renderQueuedRef.current = true
      return
    }

    const renderLayers = layersWithVideoTime()
    if (renderLayers.length === 0) return

    const effectiveMaxSide = maxSide ?? PREVIEW_TEXTURE_MAX_SIDE
    const cacheKey = staticFrameKey(renderLayers, effectiveMaxSide)
    const cachedFrame = cacheKey ? staticFrameCacheRef.current.get(cacheKey) : undefined
    if (cachedFrame) {
      paintFrame(cachedFrame)
      return
    }

    renderingRef.current = true
    renderQueuedRef.current = false
    const traceFirstRender = firstRenderTraceRef.current
    firstRenderTraceRef.current = false
    try {
      const composition = buildCompositionFromPreviewLayers(renderLayers, canvasWidth, canvasHeight)
      if (traceFirstRender) {
        logger.info('[预览诊断] 首次画面渲染开始', {
          layerCount: renderLayers.length,
          videoLayerCount: renderLayers.filter((layer) => layer.isVideo).length,
          canvasWidth,
          canvasHeight,
          maxSide: effectiveMaxSide,
        })
      }
      // 使用异步方法，避免阻塞主线程
      const result = await (lrc.renderCompositionFrameAsync ?? lrc.renderCompositionFrame)(composition, 0, effectiveMaxSide)
      if (destroyRef.current) return

      if (traceFirstRender) {
        logger.info('[预览诊断] 首次画面渲染完成', {
          width: result.width,
          height: result.height,
        })
      }

      const pixelData = bytesFromRenderData(result.data)
      const frame = { width: result.width, height: result.height, pixels: pixelData }
      if (cacheKey) {
        staticFrameCacheRef.current.set(cacheKey, frame)
        while (staticFrameCacheRef.current.size > 2) {
          const oldestKey = staticFrameCacheRef.current.keys().next().value
          if (oldestKey === undefined) break
          staticFrameCacheRef.current.delete(oldestKey)
        }
        const currentKey = staticFrameKey(layersWithVideoTime(), effectiveMaxSide)
        if (currentKey !== cacheKey) {
          const currentFrame = currentKey ? staticFrameCacheRef.current.get(currentKey) : undefined
          if (currentFrame) {
            renderQueuedRef.current = false
            paintFrame(currentFrame)
            return
          }
        }
      }
      paintFrame(frame)

      // 计算 seek 到渲染完成的耗时
      if (seekStartTimeRef.current !== null) {
        const elapsed = performance.now() - seekStartTimeRef.current
        console.log(`[LrcRender] seek to render completed in ${elapsed.toFixed(0)}ms`)
        seekStartTimeRef.current = null
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (traceFirstRender) logger.error('[预览诊断] 首次画面渲染失败', { error: msg })
      onError?.(msg)
    } finally {
      renderingRef.current = false
      if (renderQueuedRef.current && !destroyRef.current) {
        renderQueuedRef.current = false
        void renderPreviewFrame()
      }
    }
  }

  useEffect(() => {
    lastMediaSizeRef.current = [0, 0]

    if (!ready) return
    const currentKeys = new Set(layers.filter((layer) => layer.isVideo).map(layerKey))

    for (const [key, video] of videosRef.current) {
      if (!currentKeys.has(key)) {
        video.pause()
        videosRef.current.delete(key)
      }
    }

    if (videosRef.current.size === 0) {
      videoElementCalledRef.current = false
      onVideoElement?.(null)
    }

    for (const layer of layers.filter((item) => item.isVideo)) {
      const key = layerKey(layer)
      if (videosRef.current.has(key)) continue
      const video = document.createElement('video')
      video.muted = false
      video.loop = false
      video.playsInline = true
      video.preload = 'auto'
      video.src = filePathToPreviewUrl(layer.filePath) ?? layer.filePath
      videosRef.current.set(key, video)
      video.addEventListener('loadedmetadata', () => {
        if (destroyRef.current) return
        void renderPreviewFrame()
      })
      video.addEventListener('seeking', () => {
        // seek 开始时设置标志，暂停播放循环的渲染
        isSeekingRef.current = true
        seekStartTimeRef.current = performance.now()
        console.log('[LrcRender] seek started')
      })
      video.addEventListener('seeked', () => {
        if (destroyRef.current) return
        // seek 完成后，清除标志并立即触发渲染
        isSeekingRef.current = false
        // 由于拖动时视频已暂停，不需要节流，直接渲染
        void renderPreviewFrame()
      })
      video.addEventListener('play', () => void renderPreviewFrame())
      video.load()
      if (onVideoElement && !videoElementCalledRef.current) {
        videoElementCalledRef.current = true
        onVideoElement(video)
      }
    }

    void renderPreviewFrame()
  }, [layers, ready])

  useEffect(() => {
    if (!ready || !layers.some((layer) => layer.isVideo)) return

    function loop() {
      const hasPlayingVideo = [...videosRef.current.values()].some((video) => !video.paused && !video.ended)
      // seek 时暂停播放循环的渲染，优先处理 seek 操作
      if (hasPlayingVideo && !isSeekingRef.current) {
        const now = performance.now()
        if (now - lastVideoFrameAtRef.current >= 1000 / COMPOSITION_RENDER_FPS) {
          lastVideoFrameAtRef.current = now
          void renderPreviewFrame()
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [ready, layers])

  useImperativeHandle(ref, () => ({
    async exportImage(outputPath: string, width: number, height: number, format: string, quality: number) {
      const lrc = getLRC()
      if (!lrc) throw new Error('渲染引擎未初始化')
      const composition = buildCompositionFromPreviewLayers(layersRef.current, width, height)
      await lrc.exportCompositionImage(outputPath, composition, format, quality)
    },
    async exportVideo(
      outputPath: string,
      width: number,
      height: number,
      options?: { fps?: number | null; hardware?: boolean; taskId?: string; qualityPreset?: string },
    ) {
      const lrc = getLRC()
      if (!lrc) throw new Error('渲染引擎未初始化')
      const currentLayers = sortedLayers(layersRef.current)
      if (!currentLayers.some((layer) => layer.isVideo)) throw new Error('未找到视频图层')
      const composition = buildCompositionFromPreviewLayers(currentLayers, width, height, { fps: options?.fps ?? COMPOSITION_RENDER_FPS })
      await lrc.exportCompositionVideo(
        outputPath,
        composition,
        options?.fps ?? null,
        null,
        options?.hardware ?? true,
        options?.taskId,
        options?.qualityPreset,
      )
    },
  }), [])

  if (fatalError) {
    return (
      <div className={[className, 'lrc-render-error'].filter(Boolean).join(' ')}>
        <p>{fatalError}</p>
        <Button variant="secondary" disabled={retrying} onClick={() => void retryInitialization()}>
          {retrying ? '正在检测...' : '更新驱动后重新检测'}
        </Button>
      </div>
    )
  }

  const canvasClassName = [
    className,
    imageInteraction.interactive && 'lrc-render-interactive',
    imageInteraction.dragging && 'is-dragging',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <canvas
      ref={canvasRef as React.Ref<HTMLCanvasElement>}
      className={canvasClassName}
      style={imageInteraction.style}
      onPointerDown={imageInteraction.onPointerDown}
      onPointerMove={imageInteraction.onPointerMove}
      onPointerUp={imageInteraction.onPointerEnd}
      onPointerCancel={imageInteraction.onPointerEnd}
      onWheel={imageInteraction.onWheel}
      onDoubleClick={imageInteraction.onDoubleClick}
    />
  )
}), (prevProps, nextProps) => {
  // 使用自定义比较函数，只在 layers 内容真正变化时才重新渲染
  return (
    prevProps.canvasWidth === nextProps.canvasWidth &&
    prevProps.canvasHeight === nextProps.canvasHeight &&
    prevProps.maxSide === nextProps.maxSide &&
    prevProps.className === nextProps.className &&
    prevProps.maxImageScale === nextProps.maxImageScale &&
    prevProps.imageScale === nextProps.imageScale &&
    prevProps.onImageScaleChange === nextProps.onImageScaleChange &&
    prevProps.onViewportChange === nextProps.onViewportChange &&
    JSON.stringify(prevProps.interactiveImageLayerIndexes) === JSON.stringify(nextProps.interactiveImageLayerIndexes) &&
    layersEqual(prevProps.layers, nextProps.layers)
  )
})
