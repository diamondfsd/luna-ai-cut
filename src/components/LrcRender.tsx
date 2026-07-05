import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import type { PreviewLayer } from '../shared/types'

export interface LrcRenderHandle {
  exportImage(
    outputPath: string,
    width: number,
    height: number,
    format: string,
    quality: number,
  ): Promise<void>
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
  maxSide?: number
  /** @deprecated 预览不再暴露浏览器 video 元素，视频帧由 native 渲染层读取。 */
  onVideoElement?: (el: HTMLVideoElement | null) => void
}

interface RenderPreviewInput {
  width?: number
  height?: number
  maxSide?: number
  layers: PreviewLayer[]
}

interface RenderPreviewOutput {
  width: number
  height: number
  data: Uint8Array
}

interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
  color?: unknown
  transform?: unknown
}

interface StaticLayer {
  imagePath: string
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
  color?: unknown
  transform?: unknown
}

interface LunaRenderCore {
  init: () => Promise<void>
  renderPreview: (input: RenderPreviewInput) => Promise<RenderPreviewOutput>
  exportImageFromSources: (outputPath: string, width: number, height: number, layers: PreviewLayer[], format: string, quality: number) => Promise<void>
  exportVideo: (
    inputPath: string,
    outputPath: string,
    canvasWidth: number,
    canvasHeight: number,
    fps: number | null,
    hardware: boolean,
    videoLayer: RenderLayer,
    overlayLayers: StaticLayer[],
    taskId?: string,
    qualityPreset?: string,
  ) => Promise<void>
}

function getLRC(): LunaRenderCore | undefined {
  return (window as unknown as { lunaRenderCore?: LunaRenderCore }).lunaRenderCore
}

function sortedLayers(layers: PreviewLayer[]): PreviewLayer[] {
  return [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
}

function staticLayers(layers: PreviewLayer[]): StaticLayer[] {
  return sortedLayers(layers)
    .filter((layer) => !layer.isVideo)
    .map((layer) => ({
      imagePath: layer.filePath,
      dstX: layer.dstX,
      dstY: layer.dstY,
      dstW: layer.dstW,
      dstH: layer.dstH,
      srcX: layer.srcX ?? 0,
      srcY: layer.srcY ?? 0,
      srcW: layer.srcW ?? 1,
      srcH: layer.srcH ?? 1,
      opacity: layer.opacity ?? 1,
      zIndex: layer.zIndex ?? 0,
      color: layer.color,
      transform: layer.transform,
    }))
}

function videoRenderLayer(layer: PreviewLayer): RenderLayer {
  return {
    textureId: 0,
    dstX: layer.dstX,
    dstY: layer.dstY,
    dstW: layer.dstW,
    dstH: layer.dstH,
    srcX: layer.srcX ?? 0,
    srcY: layer.srcY ?? 0,
    srcW: layer.srcW ?? 1,
    srcH: layer.srcH ?? 1,
    opacity: layer.opacity ?? 1,
    zIndex: layer.zIndex ?? 0,
    color: layer.color,
    transform: layer.transform,
  }
}

export const LrcRender = forwardRef<LrcRenderHandle, LrcRenderProps>(function LrcRender(
  { layers, canvasRef: extRef, className, onError, onReady, onRender, maxSide = 1920, onVideoElement },
  ref,
) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const layersRef = useRef<PreviewLayer[]>(layers)
  const lastDebugLogRef = useRef(0)
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
    onVideoElement?.(null)
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
      onVideoElement?.(null)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const currentCanvas = canvasRef.current
    const renderCore = getLRC()
    if (!currentCanvas || !renderCore || layers.length === 0) return
    const renderCanvas: HTMLCanvasElement = currentCanvas
    const lrc: LunaRenderCore = renderCore

    let canceled = false
    let rendering = false
    const hasVideo = layers.some((layer) => layer.isVideo)

    async function renderOnce() {
      if (rendering || canceled || destroyRef.current) return
      rendering = true
      try {
        const renderLayers = sortedLayers(layersRef.current)
        const now = performance.now()
        const shouldLog = now - lastDebugLogRef.current > 1000
        if (shouldLog) {
          lastDebugLogRef.current = now
          console.log('[LrcRender:request]', {
            maxSide,
            layers: renderLayers.map((layer) => ({
              filePath: layer.filePath,
              isVideo: Boolean(layer.isVideo),
              videoTime: layer.videoTime ?? 0,
              dst: `${layer.dstX},${layer.dstY},${layer.dstW},${layer.dstH}`,
              src: `${layer.srcX ?? 0},${layer.srcY ?? 0},${layer.srcW ?? 1},${layer.srcH ?? 1}`,
              opacity: layer.opacity ?? 1,
              zIndex: layer.zIndex ?? 0,
            })),
          })
        }
        const result = await lrc.renderPreview({
          maxSide,
          layers: renderLayers,
        })
        if (canceled || destroyRef.current) return
        renderCanvas.width = result.width
        renderCanvas.height = result.height
        const context = renderCanvas.getContext('2d')
        if (!context) throw new Error('画布不可用')
        context.putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0)
        if (shouldLog) {
          console.log('[LrcRender:response]', {
            resultSize: `${result.width}x${result.height}`,
            dataLength: result.data.length,
            canvasBuffer: `${renderCanvas.width}x${renderCanvas.height}`,
            canvasCss: `${renderCanvas.clientWidth}x${renderCanvas.clientHeight}`,
            parent: renderCanvas.parentElement ? `${renderCanvas.parentElement.clientWidth}x${renderCanvas.parentElement.clientHeight}` : null,
          })
        }
        onRender?.()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        onError?.(msg)
      } finally {
        rendering = false
      }
    }

    function loop() {
      void renderOnce()
      rafRef.current = requestAnimationFrame(loop)
    }

    void renderOnce()
    if (hasVideo) rafRef.current = requestAnimationFrame(loop)
    return () => {
      canceled = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [layers, ready, maxSide])

  useImperativeHandle(ref, () => ({
    async exportImage(outputPath: string, width: number, height: number, format: string, quality: number) {
      const lrc = getLRC()
      if (!lrc) throw new Error('渲染引擎未初始化')
      await lrc.exportImageFromSources(outputPath, width, height, sortedLayers(layersRef.current), format, quality)
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
      const videoLayer = currentLayers.find((layer) => layer.isVideo)
      if (!videoLayer) throw new Error('未找到视频图层')
      await lrc.exportVideo(
        videoLayer.filePath,
        outputPath,
        width,
        height,
        options?.fps ?? null,
        options?.hardware ?? true,
        videoRenderLayer(videoLayer),
        staticLayers(currentLayers),
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
})
