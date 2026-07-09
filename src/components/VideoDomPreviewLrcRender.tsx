import { useEffect, useRef, useState, forwardRef, useImperativeHandle, memo } from 'react'
import type { CompositionInput, PreviewLayer } from '../shared/types'
import { buildCompositionFromPreviewLayers, COMPOSITION_RENDER_FPS } from './renderComposition'
import { filePathToPreviewUrl } from '../lib/fileUtils'

const PREVIEW_WIDTH = 1280
const PREVIEW_HEIGHT = 720

export interface VideoDomPreviewLrcRenderHandle {
  exportImage(outputPath: string, width: number, height: number, format: string, quality: number): Promise<void>
  exportVideo(
    outputPath: string,
    width: number,
    height: number,
    options?: { fps?: number | null; hardware?: boolean; taskId?: string; qualityPreset?: string },
  ): Promise<void>
}

export type { PreviewLayer }

interface VideoDomPreviewLrcRenderProps {
  layers: PreviewLayer[]
  className?: string
  onError?: (error: string) => void
  onReady?: () => void
  onRender?: () => void
  onMediaSize?: (width: number, height: number) => void
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
  loadTexture: (data: Buffer, width: number, height: number) => Promise<number>
  updateTexture: (textureId: number, data: Buffer) => Promise<void>
  renderFrame: (canvasWidth: number, canvasHeight: number, layers: any[]) => Promise<Buffer>
  releaseTexture: (textureId: number) => Promise<void>
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

function bytesFromRenderData(data: RenderPreviewOutput['data']): Uint8ClampedArray {
  if (data instanceof Uint8Array) {
    const copy = new Uint8ClampedArray(data.byteLength)
    copy.set(data)
    return copy
  }
  if (data instanceof ArrayBuffer) return new Uint8ClampedArray(data)
  if (Array.isArray(data.data)) return new Uint8ClampedArray(data.data)
  return new Uint8ClampedArray(data as ArrayBuffer)
}

// 自定义比较函数
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
      prev.videoTime !== next.videoTime
    ) {
      return false
    }
    if (JSON.stringify(prev.color) !== JSON.stringify(next.color)) return false
    if (JSON.stringify(prev.transform) !== JSON.stringify(next.transform)) return false
  }
  return true
}

export const VideoDomPreviewLrcRender = memo(forwardRef<VideoDomPreviewLrcRenderHandle, VideoDomPreviewLrcRenderProps>(
  function VideoDomPreviewLrcRender(
    { layers, className, onError, onReady, onRender, onMediaSize, canvasWidth, canvasHeight, onVideoElement },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null)
    const destroyRef = useRef(false)
    const rafRef = useRef(0)
    const layersRef = useRef<PreviewLayer[]>(layers)
    const renderingRef = useRef(false)
    const renderQueuedRef = useRef(false)
    const lastFrameAtRef = useRef(0)
    const lastMediaSizeRef = useRef<[number, number]>([0, 0])
    const textureIdRef = useRef<number>(0) // 视频帧 texture ID，0 表示未创建
    const imageTextureCacheRef = useRef<Map<string, number>>(new Map()) // 图片纹理缓存
    const [ready, setReady] = useState(false)
    const [fatalError, setFatalError] = useState<string | null>(null)
    layersRef.current = layers

    // 初始化
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
        // 释放视频纹理
        const lrcCleanup = getLRC()
        if (textureIdRef.current > 0 && lrcCleanup) {
          lrcCleanup.releaseTexture(textureIdRef.current).catch(() => {})
          textureIdRef.current = 0
        }
        // 释放所有图片纹理
        if (lrcCleanup) {
          for (const [, texId] of imageTextureCacheRef.current) {
            lrcCleanup.releaseTexture(texId).catch(() => {})
          }
        }
        imageTextureCacheRef.current.clear()
      }
    }, [])

    // 创建视频元素
    useEffect(() => {
      if (!ready) return

      console.log('[VideoDomPreviewLrcRender] layers changed', {
        layersCount: layers.length,
        layers: layers.map(l => ({
          filePath: l.filePath,
          isVideo: l.isVideo
        }))
      })

      const videoLayer = layers.find((layer) => layer.isVideo)
      if (!videoLayer) {
        console.log('[VideoDomPreviewLrcRender] no video layer found')
        if (videoRef.current) {
          videoRef.current.pause()
          videoRef.current = null
          onVideoElement?.(null)
        }
        return
      }

      console.log('[VideoDomPreviewLrcRender] video layer found', {
        filePath: videoLayer.filePath,
        previewUrl: filePathToPreviewUrl(videoLayer.filePath)
      })

      // 创建视频元素
      const video = document.createElement('video')
      video.muted = false
      video.loop = false
      video.playsInline = true
      video.preload = 'auto'
      video.src = filePathToPreviewUrl(videoLayer.filePath) ?? videoLayer.filePath
      video.crossOrigin = 'anonymous'

      console.log('[VideoDomPreviewLrcRender] creating video element', {
        filePath: videoLayer.filePath,
        src: video.src,
        videoRef: videoRef.current
      })

      // 使用 loadeddata 而非 loadedmetadata：
      // loadedmetadata 时 video.readyState=1(HAVE_METADATA)，视频尚未解码首帧，
      // 此时 drawImage 只能画出透明/空白帧，导致首帧渲染为纯色。
      // loadeddata 确保 readyState >= HAVE_CURRENT_DATA，首帧已可用。
      video.addEventListener('loadeddata', () => {
        if (destroyRef.current) return
        console.log('[VideoDomPreviewLrcRender] video data loaded', {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          readyState: video.readyState,
        })
        // 创建 OffscreenCanvas（首帧已可用，drawImage 能获取有效帧）
        offscreenCanvasRef.current = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT)
        void renderFrame()
      })

      video.addEventListener('seeked', () => {
        if (destroyRef.current) return
        console.log('[VideoDomPreviewLrcRender] video seeked', { currentTime: video.currentTime })
        void renderFrame()
      })

      video.addEventListener('play', () => {
        console.log('[VideoDomPreviewLrcRender] video play event', {
          currentTime: video.currentTime,
          duration: video.duration
        })
        // 延迟一下再渲染，让视频播放到有内容的帧
        setTimeout(() => void renderFrame(), 500)
      })

      video.addEventListener('error', (e) => {
        console.error('[VideoDomPreviewLrcRender] video error', {
          error: e,
          errorCode: video.error?.code,
          errorMessage: video.error?.message,
          src: video.src,
          readyState: video.readyState,
          networkState: video.networkState
        })
      })

      video.load()

      videoRef.current = video
      onVideoElement?.(video)

      return () => {
        video.pause()
        video.src = ''
        videoRef.current = null
        onVideoElement?.(null)
      }
    }, [ready, layers])

    // 加载图片纹理（水印/覆盖层）
    async function loadImageTexture(filePath: string): Promise<number> {
      const lrc = getLRC()
      if (!lrc) throw new Error('渲染引擎未加载')
      const cached = imageTextureCacheRef.current.get(filePath)
      if (cached !== undefined) return cached

      const img = new Image()
      img.src = filePathToPreviewUrl(filePath) ?? filePath
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('图片加载失败: ' + filePath))
      })
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('OffscreenCanvas 2D context 不可用')
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, w, h)
      const rgbaData = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength)
      const texId = await lrc.loadTexture(rgbaData as any, w, h)
      imageTextureCacheRef.current.set(filePath, texId)
      console.log('[VideoDomPreviewLrcRender] image texture loaded', { filePath, texId, w, h })
      return texId
    }

    // 渲染帧 - 接入 Rust 渲染逻辑
    async function renderFrame() {
      const lrc = getLRC()
      const canvas = canvasRef.current
      const video = videoRef.current
      const offscreenCanvas = offscreenCanvasRef.current

      if (!lrc || !canvas || !video || !offscreenCanvas || destroyRef.current) return

      if (renderingRef.current) {
        renderQueuedRef.current = true
        return
      }

      renderingRef.current = true
      renderQueuedRef.current = false

      try {
        // 从视频取帧并缩放
        const ctx = offscreenCanvas.getContext('2d')
        if (!ctx) throw new Error('OffscreenCanvas 不可用')

        // 清空 canvas（避免残留数据）
        ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)

        // 绘制视频（保持宽高比）
        const videoAspect = video.videoWidth / video.videoHeight
        const canvasAspect = PREVIEW_WIDTH / PREVIEW_HEIGHT

        let drawWidth = PREVIEW_WIDTH
        let drawHeight = PREVIEW_HEIGHT
        let drawX = 0
        let drawY = 0

        if (videoAspect > canvasAspect) {
          drawHeight = PREVIEW_WIDTH / videoAspect
          drawY = (PREVIEW_HEIGHT - drawHeight) / 2
        } else {
          drawWidth = PREVIEW_HEIGHT * videoAspect
          drawX = (PREVIEW_WIDTH - drawWidth) / 2
        }

        ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight)

        const imageData = ctx.getImageData(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        const rgbaData = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength)

        // 首次加载视频纹理，后续更新
        if (textureIdRef.current === 0) {
          textureIdRef.current = await lrc.loadTexture(rgbaData as any, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        } else {
          await lrc.updateTexture(textureIdRef.current, rgbaData as any)
        }

        // 构建 renderLayers：遍历所有层（视频 + 图片水印/覆盖层）
        // 注意：Rust 的 RenderLayer.dst 使用归一化坐标(0-1)，
        // compositor.render() 内部会乘以 canvas_width/height 转成像素坐标。
        const allLayers = layersRef.current
        const renderLayers: any[] = []
        const usedImageTextures = new Set<string>()

        for (const layer of allLayers) {
          let textureId: number

          if (layer.isVideo) {
            textureId = textureIdRef.current
          } else {
            // 非视频层（水印等）：加载为 GPU 纹理
            usedImageTextures.add(layer.filePath)
            try {
              textureId = await loadImageTexture(layer.filePath)
            } catch (err) {
              console.error('[VideoDomPreviewLrcRender] failed to load image layer:', layer.filePath, err)
              continue // 跳过加载失败的层
            }
          }

        // ── color 校验：Rust RenderColorAdjustments 要求 curve + hslChannels 必填，缺则跳过 ──
          const validColor = layer.color && typeof layer.color === "object"
            && "curve" in layer.color && "hslChannels" in layer.color
            ? layer.color
            : undefined

          // ── transform 校验 ──
          const validTransform = layer.transform && typeof layer.transform === "object"
            && "orientation" in layer.transform
            ? layer.transform
            : undefined

          // ── positioning 校验：必须是平面对象（含 anchor 字段）──
          let positioning: any = undefined
          if (layer.positioning && typeof layer.positioning === "object" && "anchor" in layer.positioning) {
            const p = layer.positioning as any
            positioning = {
              anchor: String(p.anchor ?? ""),
              targetWidth: Number(p.targetWidth) || 0,
              marginX: p.marginX ?? 0,
              marginY: p.marginY ?? 0,
            }
          }

          renderLayers.push({
            textureId,
            dstX: layer.dstX ?? 0,
            dstY: layer.dstY ?? 0,
            dstW: layer.dstW ?? 1,
            dstH: layer.dstH ?? 1,
            srcX: layer.srcX ?? 0,
            srcY: layer.srcY ?? 0,
            srcW: layer.srcW ?? 1,
            srcH: layer.srcH ?? 1,
            opacity: layer.opacity ?? 1,
            zIndex: layer.zIndex ?? 0,
            color: validColor,
            transform: validTransform,
            positioning,
            lutId: layer.lutId,
            lutIntensity: layer.lutIntensity,
          })
        }

        // 清理不再需要的图片纹理
        for (const [filePath, texId] of imageTextureCacheRef.current) {
          if (!usedImageTextures.has(filePath)) {
            lrc.releaseTexture(texId).catch(() => {})
            imageTextureCacheRef.current.delete(filePath)
          }
        }

        // 按 zIndex 排序后调用 Rust 渲染
        renderLayers.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

        const result = await lrc.renderFrame(PREVIEW_WIDTH, PREVIEW_HEIGHT, renderLayers)

        if (destroyRef.current) return

        // 更新 canvas
        canvas.width = PREVIEW_WIDTH
        canvas.height = PREVIEW_HEIGHT
        const displayCtx = canvas.getContext('2d')
        if (!displayCtx) throw new Error('Canvas 不可用')

        const pixelData = new Uint8ClampedArray(result)
        displayCtx.putImageData(new ImageData(pixelData, PREVIEW_WIDTH, PREVIEW_HEIGHT), 0, 0)

        onRender?.()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[VideoDomPreviewLrcRender] render error:', error)
        onError?.(msg)
      } finally {
        renderingRef.current = false
        if (renderQueuedRef.current && !destroyRef.current) {
          renderQueuedRef.current = false
          void renderFrame()
        }
      }
    }

    // 播放循环
    useEffect(() => {
      if (!ready || !videoRef.current) return

      function loop() {
        const video = videoRef.current
        if (video && !video.paused && !video.ended) {
          const now = performance.now()
          if (now - lastFrameAtRef.current >= 1000 / COMPOSITION_RENDER_FPS) {
            lastFrameAtRef.current = now
            void renderFrame()
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
        const composition = buildCompositionFromPreviewLayers(layersRef.current, width, height, { fps: options?.fps ?? COMPOSITION_RENDER_FPS })
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

    return <canvas ref={canvasRef} className={className} />
  }
), (prevProps: VideoDomPreviewLrcRenderProps, nextProps: VideoDomPreviewLrcRenderProps) => {
  return (
    prevProps.canvasWidth === nextProps.canvasWidth &&
    prevProps.canvasHeight === nextProps.canvasHeight &&
    prevProps.className === nextProps.className &&
    layersEqual(prevProps.layers, nextProps.layers)
  )
})
