import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import type { PreviewLayer } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'

const PREVIEW_TEXTURE_MAX_SIDE = 1080
const VIDEO_RENDER_FPS = 30

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
  onVideoElement?: (el: HTMLVideoElement | null) => void
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

interface TextureInfo {
  textureId: number | null
  width: number
  height: number
}

interface VideoInfo {
  video: HTMLVideoElement
  offscreen: HTMLCanvasElement
}

interface PlanPreviewInput {
  width?: number
  height?: number
  maxSide?: number
  layers: Array<{ layer: PreviewLayer; texture: { textureId: number; width: number; height: number } }>
}

interface PlanPreviewOutput {
  width: number
  height: number
  layers: RenderLayer[]
}

interface LunaRenderCore {
  init: () => Promise<void>
  loadTexture: (data: Uint8Array, width: number, height: number) => Promise<number>
  loadTextureFromPath: (path: string, maxSize: number) => Promise<{ textureId: number; width: number; height: number }>
  updateTexture: (textureId: number, data: Uint8Array) => Promise<void>
  releaseTexture: (textureId: number) => Promise<void>
  renderFrame: (canvasWidth: number, canvasHeight: number, layers: RenderLayer[]) => Promise<Uint8Array>
  planPreview: (input: PlanPreviewInput) => Promise<PlanPreviewOutput>
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

function layerKey(layer: PreviewLayer): string {
  return `${layer.isVideo ? 'v' : 's'}:${layer.filePath}`
}

function sortedLayers(layers: PreviewLayer[]): PreviewLayer[] {
  return [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
}

function fitTextureSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_TEXTURE_MAX_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function drawVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): { data: Uint8Array; width: number; height: number } | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null
  const { width, height } = fitTextureSize(video.videoWidth, video.videoHeight)
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(video, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  return { data: new Uint8Array(imageData.data.buffer), width, height }
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
  { layers, canvasRef: extRef, className, onError, onReady, onRender, onMediaSize, maxSide, onVideoElement },
  ref,
) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const layersRef = useRef<PreviewLayer[]>(layers)
  const texturesRef = useRef<Map<string, TextureInfo>>(new Map())
  const videosRef = useRef<Map<string, VideoInfo>>(new Map())
  const videoElementCalledRef = useRef(false)
  const renderingRef = useRef(false)
  const lastVideoFrameAtRef = useRef(0)
  const lastDebugAtRef = useRef(0)
  const lastMediaSizeRef = useRef<[number, number]>([0, 0])
  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [renderKey, setRenderKey] = useState(0)
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
    texturesRef.current.clear()
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
      const currentLrc = getLRC()
      for (const [, texture] of texturesRef.current) {
        if (texture.textureId != null) currentLrc?.releaseTexture(texture.textureId).catch(() => {})
      }
      for (const [, video] of videosRef.current) video.video.pause()
      texturesRef.current.clear()
      videosRef.current.clear()
      onVideoElement?.(null)
    }
  }, [])

  async function compositeRender() {
    const lrc = getLRC()
    const canvas = canvasRef.current
    if (!lrc || !canvas || renderingRef.current || destroyRef.current) return
    const renderLayers = sortedLayers(layersRef.current)
    const plannedLayers = renderLayers.flatMap((layer) => {
      const texture = texturesRef.current.get(layerKey(layer))
      if (!texture || texture.textureId == null) return []
      return [{
        layer,
        texture: {
          textureId: texture.textureId,
          width: texture.width,
          height: texture.height,
        },
      }]
    })
    if (plannedLayers.length === 0) return
    renderingRef.current = true
    try {
      const effectiveMaxSide = maxSide ?? PREVIEW_TEXTURE_MAX_SIDE
      const plan = await lrc.planPreview({ maxSide: effectiveMaxSide, layers: plannedLayers })
      if (destroyRef.current) return
      // 通知外部素材的实际渲染尺寸
      if (plan.width !== lastMediaSizeRef.current[0] || plan.height !== lastMediaSizeRef.current[1]) {
        lastMediaSizeRef.current = [plan.width, plan.height]
        onMediaSize?.(plan.width, plan.height)
      }
      const result = await lrc.renderFrame(plan.width, plan.height, plan.layers)
      if (destroyRef.current) return
      canvas.width = plan.width
      canvas.height = plan.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('画布不可用')
      context.putImageData(new ImageData(new Uint8ClampedArray(result), plan.width, plan.height), 0, 0)
      const now = performance.now()
      if (now - lastDebugAtRef.current > 1000) {
        lastDebugAtRef.current = now
        console.log('[LrcRender:plan]', {
          maxSide: effectiveMaxSide,
          output: `${plan.width}x${plan.height}`,
          layers: plan.layers.length,
          canvasCss: `${canvas.clientWidth}x${canvas.clientHeight}`,
          parent: canvas.parentElement ? `${canvas.parentElement.clientWidth}x${canvas.parentElement.clientHeight}` : null,
        })
      }
      onRender?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      onError?.(msg)
      setRenderKey((key) => key + 1)
    } finally {
      renderingRef.current = false
    }
  }

  async function upsertVideoTexture(layer: PreviewLayer, info: VideoInfo, allowPaused = false): Promise<boolean> {
    const lrc = getLRC()
    if (!lrc || (!allowPaused && info.video.paused) || info.video.readyState < 2) return false
    const frame = drawVideoFrame(info.video, info.offscreen)
    if (!frame) return false
    const key = layerKey(layer)
    const current = texturesRef.current.get(key)
    if (current?.textureId != null && current.width === frame.width && current.height === frame.height) {
      await lrc.updateTexture(current.textureId, frame.data)
      return true
    }
    if (current?.textureId != null) await lrc.releaseTexture(current.textureId).catch(() => {})
    const textureId = await lrc.loadTexture(frame.data, frame.width, frame.height)
    texturesRef.current.set(key, { textureId, width: frame.width, height: frame.height })
    return true
  }

  useEffect(() => {
    if (!ready) return
    const lrc = getLRC()
    if (!lrc) return
    let canceled = false
    const currentKeys = new Set(layers.map(layerKey))

    for (const [key, texture] of texturesRef.current) {
      if (!currentKeys.has(key)) {
        if (texture.textureId != null) lrc.releaseTexture(texture.textureId).catch(() => {})
        texturesRef.current.delete(key)
      }
    }
    for (const [key, video] of videosRef.current) {
      if (!currentKeys.has(key)) {
        video.video.pause()
        videosRef.current.delete(key)
      }
    }

    if (videosRef.current.size === 0) {
      videoElementCalledRef.current = false
      onVideoElement?.(null)
    }

    for (const layer of layers.filter((item) => !item.isVideo)) {
      const key = layerKey(layer)
      if (texturesRef.current.has(key)) continue
      texturesRef.current.set(key, { textureId: null, width: 0, height: 0 })
      lrc.loadTextureFromPath(layer.filePath, PREVIEW_TEXTURE_MAX_SIDE)
        .then((texture) => {
          if (canceled || destroyRef.current) return
          texturesRef.current.set(key, texture)
          void compositeRender()
        })
        .catch((error) => {
          if (!canceled) onError?.(error instanceof Error ? error.message : String(error))
        })
    }

    for (const layer of layers.filter((item) => item.isVideo)) {
      const key = layerKey(layer)
      if (videosRef.current.has(key)) continue
      const video = document.createElement('video')
      video.muted = true
      video.loop = false
      video.playsInline = true
      video.preload = 'auto'
      video.src = filePathToPreviewUrl(layer.filePath) ?? layer.filePath
      const offscreen = document.createElement('canvas')
      videosRef.current.set(key, { video, offscreen })
      if (onVideoElement && !videoElementCalledRef.current) {
        videoElementCalledRef.current = true
        onVideoElement(video)
      }
      // 元数据加载完成后，seek 到 0.001s 强制解码第一帧
      video.onloadedmetadata = () => {
        if (canceled || destroyRef.current) return
        video.currentTime = 0.001
      }
      video.onseeked = () => {
        const info = videosRef.current.get(key)
        if (!info || canceled || destroyRef.current) return
        void upsertVideoTexture(layer, info, true).then((updated) => {
          if (updated) void compositeRender()
        })
      }
      video.onloadeddata = video.onseeked
      video.load()
    }

    const staticReady = layers
      .filter((item) => !item.isVideo)
      .every((layer) => texturesRef.current.get(layerKey(layer))?.textureId != null)
    if (staticReady) void compositeRender()

    return () => {
      canceled = true
    }
  }, [layers, ready, renderKey])

  useEffect(() => {
    if (!ready || !layers.some((layer) => layer.isVideo)) return

    function loop() {
      const now = performance.now()
      if (now - lastVideoFrameAtRef.current >= 1000 / VIDEO_RENDER_FPS) {
        lastVideoFrameAtRef.current = now
        const pending = layersRef.current
          .filter((layer) => layer.isVideo)
          .map((layer) => {
            const info = videosRef.current.get(layerKey(layer))
            return info ? upsertVideoTexture(layer, info) : Promise.resolve(false)
          })
        Promise.all(pending)
          .then((updated) => {
            if (updated.some(Boolean)) void compositeRender()
          })
          .catch(() => {})
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
