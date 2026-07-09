import { useEffect, useImperativeHandle, useRef, useState, forwardRef, memo } from 'react'
import type { CompositionInput, PreviewLayer } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { buildCompositionFromPreviewLayers, COMPOSITION_RENDER_FPS } from './renderComposition'

const PREVIEW_TEXTURE_MAX_SIDE = 1280 // 从 1920 降低到 1280，减少 56% 数据量

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

interface LrcRenderProps {
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
}

interface RenderPreviewOutput {
  width: number
  height: number
  data: Uint8Array | ArrayBuffer | { data?: number[] }
}

interface LunaRenderCore {
  init: () => Promise<void>
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

// 自定义比较函数：只在 layers 内容真正变化时才重新渲染
const layersEqual = (prevLayers: PreviewLayer[], nextLayers: PreviewLayer[]): boolean => {
  if (prevLayers.length !== nextLayers.length) return false
  for (let i = 0; i < prevLayers.length; i++) {
    const prev = prevLayers[i]
    const next = nextLayers[i]
    if (
      prev.filePath !== next.filePath ||
      prev.isVideo !== next.isVideo ||
      prev.opacity !== next.opacity ||
      prev.zIndex !== next.zIndex ||
      prev.dstX !== next.dstX ||
      prev.dstY !== next.dstY ||
      prev.dstW !== next.dstW ||
      prev.dstH !== next.dstH ||
      prev.srcX !== next.srcX ||
      prev.srcY !== next.srcY ||
      prev.srcW !== next.srcW ||
      prev.srcH !== next.srcH ||
      prev.videoTime !== next.videoTime ||
      prev.lutId !== next.lutId ||
      prev.lutIntensity !== next.lutIntensity
    ) {
      return false
    }
    // 比较 color 对象
    if (JSON.stringify(prev.color) !== JSON.stringify(next.color)) return false
    // 比较 transform 对象
    if (JSON.stringify(prev.transform) !== JSON.stringify(next.transform)) return false
  }
  return true
}

export const LrcRender = memo(forwardRef<LrcRenderHandle, LrcRenderProps>(function LrcRender(
  { layers, canvasRef: extRef, className, onError, onReady, onRender, onMediaSize, maxSide, canvasWidth, canvasHeight, onVideoElement },
  ref,
) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const layersRef = useRef<PreviewLayer[]>(layers)
  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const videoElementCalledRef = useRef(false)
  const renderingRef = useRef(false)
  const renderQueuedRef = useRef(false)
  const lastVideoFrameAtRef = useRef(0)
  const lastMediaSizeRef = useRef<[number, number]>([0, 0])
  const isSeekingRef = useRef(false) // 标记是否正在 seek
  const seekStartTimeRef = useRef<number | null>(null) // 记录 seek 开始时间
  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  layersRef.current = layers

  useEffect(() => {
    const lrc = getLRC()
    if (!lrc) {
      const msg = '渲染引擎未加载'
      setFatalError(msg)
      onError?.(msg)
      return
    }
    destroyRef.current = false
    lrc.init()
      .then(() => {
        if (!destroyRef.current) {
          setReady(true)
          onReady?.()
        }
      })
      .catch((error: Error) => {
        if (destroyRef.current) return
        const msg = `渲染引擎初始化失败: ${error.message}`
        setFatalError(msg)
        onError?.(msg)
      })
    return () => {
      destroyRef.current = true
      cancelAnimationFrame(rafRef.current)
      for (const [, video] of videosRef.current) video.pause()
      videosRef.current.clear()
      onVideoElement?.(null)
    }
  }, [])

  function layersWithVideoTime(): PreviewLayer[] {
    return sortedLayers(layersRef.current).map((layer) => {
      if (!layer.isVideo) return layer
      const video = videosRef.current.get(layerKey(layer))
      return { ...layer, videoTime: video?.currentTime ?? layer.videoTime ?? 0 }
    })
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

    renderingRef.current = true
    renderQueuedRef.current = false
    try {
      const effectiveMaxSide = maxSide ?? PREVIEW_TEXTURE_MAX_SIDE
      const composition = buildCompositionFromPreviewLayers(renderLayers, canvasWidth, canvasHeight)
      // 使用异步方法，避免阻塞主线程
      const result = await (lrc.renderCompositionFrameAsync ?? lrc.renderCompositionFrame)(composition, 0, effectiveMaxSide)
      if (destroyRef.current) return

      if (result.width !== lastMediaSizeRef.current[0] || result.height !== lastMediaSizeRef.current[1]) {
        lastMediaSizeRef.current = [result.width, result.height]
        onMediaSize?.(result.width, result.height)
      }

      canvas.width = result.width
      canvas.height = result.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('画布不可用')
      const pixelData = bytesFromRenderData(result.data)
      context.putImageData(new ImageData(pixelData as unknown as Uint8ClampedArray<ArrayBuffer>, result.width, result.height), 0, 0)

      // 计算 seek 到渲染完成的耗时
      if (seekStartTimeRef.current !== null) {
        const elapsed = performance.now() - seekStartTimeRef.current
        console.log(`[LrcRender] seek to render completed in ${elapsed.toFixed(0)}ms`)
        seekStartTimeRef.current = null
      }

      onRender?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
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
      <div className={className} style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <p style={{ color: 'var(--red, #e53e3e)', fontSize: 14, textAlign: 'center', padding: 16 }}>
          {fatalError}
        </p>
      </div>
    )
  }

  return <canvas ref={canvasRef as React.Ref<HTMLCanvasElement>} className={className} />
}), (prevProps, nextProps) => {
  // 使用自定义比较函数，只在 layers 内容真正变化时才重新渲染
  return (
    prevProps.canvasWidth === nextProps.canvasWidth &&
    prevProps.canvasHeight === nextProps.canvasHeight &&
    prevProps.maxSide === nextProps.maxSide &&
    prevProps.className === nextProps.className &&
    layersEqual(prevProps.layers, nextProps.layers)
  )
})
