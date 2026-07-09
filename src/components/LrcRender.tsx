import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import type { CompositionInput, PreviewLayer } from '../shared/types/render'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { buildCompositionFromPreviewLayers, COMPOSITION_RENDER_FPS } from './renderComposition'
import {
  initPreviewEngine,
  updatePreviewState,
  getLatestPreviewFrame,
  destroyPreviewEngine,
} from '../hooks/usePreviewEngine'

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

// ── 用于导出功能的旧 API ──
interface LunaRenderExportApi {
  exportCompositionVideo(
    outputPath: string,
    composition: CompositionInput,
    fps: number | null,
    duration: number | null,
    hardware: boolean,
    taskId?: string,
    qualityPreset?: string,
  ): Promise<void>
  exportCompositionImage(
    outputPath: string,
    composition: CompositionInput,
    format: string,
    quality: number,
  ): Promise<void>
}

function getLRC(): LunaRenderExportApi | undefined {
  return (window as unknown as { lunaRenderCore?: LunaRenderExportApi }).lunaRenderCore
}

function layerKey(layer: PreviewLayer): string {
  return `${layer.isVideo ? 'v' : 's'}:${layer.filePath}`
}

function sortedLayers(layers: PreviewLayer[]): PreviewLayer[] {
  return [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
}

export const LrcRender = forwardRef<LrcRenderHandle, LrcRenderProps>(function LrcRender(
  { layers, canvasRef: extRef, className, onError, onReady, onRender, onMediaSize, maxSide, canvasWidth, canvasHeight, onVideoElement }: LrcRenderProps,
  ref,
) {
  void maxSide // 保留 API 兼容，新引擎内部处理分辨率
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const layersRef = useRef<PreviewLayer[]>(layers)
  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const videoElementCalledRef = useRef(false)
  const lastVideoKeyRef = useRef<string | null>(null)
  const lastMediaSizeRef = useRef<[number, number]>([0, 0])
  const engineReadyRef = useRef(false)
  const lastFrameIdRef = useRef(-1)
  const compositionRef = useRef<CompositionInput | null>(null)
  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  layersRef.current = layers

  // ── 初始化 ──
  useEffect(() => {
    destroyRef.current = false
    initPreviewEngine()
      .then(() => {
        if (!destroyRef.current) {
          engineReadyRef.current = true
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
      void destroyPreviewEngine()
    }
  }, [])

  // ── 构建 composition 并发送到引擎 ──
  function pushToEngine(time: number, mode: 'idle' | 'playing' | 'dragging' | 'final-seek') {
    if (!engineReadyRef.current || destroyRef.current) return
    const layers = sortedLayers(layersRef.current)
    if (layers.length === 0) return
    const composition = buildCompositionFromPreviewLayers(layers, canvasWidth, canvasHeight)
    compositionRef.current = composition
    updatePreviewState(mode, time, composition)
  }

  // ── 画布渲染循环：持续拉取引擎的最新帧 ──
  useEffect(() => {
    if (!ready) return
    console.log('[LrcRender] pull loop started, engineReadyRef.current=', engineReadyRef.current)

    function loop() {
      if (!destroyRef.current) {
        getLatestPreviewFrame().then((frame) => {
          if (!frame || destroyRef.current) {
            if (!frame) console.log('[LrcRender] pull: no frame yet')
            return
          }
          if (frame.frameId === lastFrameIdRef.current) return
          lastFrameIdRef.current = frame.frameId
          console.log('[LrcRender] pull: got frame', frame.frameId, frame.width, frame.height, frame.data.length)

          const canvas = canvasRef.current
          if (!canvas) return

          if (frame.width !== lastMediaSizeRef.current[0] || frame.height !== lastMediaSizeRef.current[1]) {
            lastMediaSizeRef.current = [frame.width, frame.height]
            onMediaSize?.(frame.width, frame.height)
          }

          canvas.width = frame.width
          canvas.height = frame.height
          const context = canvas.getContext('2d')
          if (context) {
            context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0)
            onRender?.()
          }
        }).catch((err) => {
          console.error('[LrcRender] pull error:', err)
        })
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [ready])

  // ── 视频层管理（隐藏 video 用于音频同步） ──
  useEffect(() => {
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
        pushToEngine(0, 'final-seek')
      })
      video.addEventListener('seeked', () => {
        if (destroyRef.current) return
        pushToEngine(video.currentTime, 'final-seek')
      })
      video.addEventListener('pause', () => {
        if (destroyRef.current) return
        pushToEngine(video.currentTime, 'idle')
      })
      video.addEventListener('play', () => {
        if (destroyRef.current) return
        pushToEngine(video.currentTime, 'playing')
      })
      video.load()
      if (onVideoElement && key !== lastVideoKeyRef.current) {
        videoElementCalledRef.current = true
        onVideoElement(video)
      }
    }

    // 初始渲染
    pushToEngine(0, 'final-seek')
  }, [layers, ready])

  // ── 播放循环（节流到 ~10fps，不淹了引擎） ──
  useEffect(() => {
    if (!ready || !layers.some((layer) => layer.isVideo)) return
    const lastPushRef = { current: 0 }

    function loop() {
      if (!destroyRef.current) {
        const hasPlayingVideo = [...videosRef.current.values()].some((v) => !v.paused && !v.ended)
        if (hasPlayingVideo && engineReadyRef.current) {
          const firstVideo = [...videosRef.current.values()].find((v) => !v.paused)
          if (firstVideo) {
            const now = performance.now()
            if (now - lastPushRef.current >= 100) { // max 10fps
              lastPushRef.current = now
              pushToEngine(firstVideo.currentTime, 'playing')
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [ready, layers])

  // ── 暴露 handle ──
  useImperativeHandle(ref, () => ({
    async exportImage(outputPath: string, width: number, height: number, format: string, quality: number) {
      const lrc = getLRC()
      if (!lrc) throw new Error('渲染引擎未初始化')
      const composition = compositionRef.current ?? buildCompositionFromPreviewLayers(layersRef.current, width, height)
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
})
