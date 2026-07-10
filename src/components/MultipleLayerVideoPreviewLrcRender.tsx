import { useEffect, useRef, useState, forwardRef, memo } from 'react'
import type { PreviewLayer } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { COMPOSITION_RENDER_FPS } from './renderComposition'

const PREVIEW_MAX_SIDE = 1280

function calcRenderSize(vw: number, vh: number, maxSide: number): [number, number] {
  const maxEdge = Math.max(vw, vh)
  if (maxEdge <= maxSide) return [vw, vh]
  const scale = maxSide / maxEdge
  return [Math.round(vw * scale), Math.round(vh * scale)]
}

/**
 * 计算视频层的解码最大边长。
 * 根据该层在预览画布上的实际显示尺寸 × quality 系数。
 */
function computeLayerDecodeMaxSide(
  layer: PreviewLayer,
  canvasW: number | undefined,
  canvasH: number | undefined,
  quality: number,
): number {
  if (quality <= 0 || !canvasW || !canvasH) return PREVIEW_MAX_SIDE
  const [pw, ph] = calcOutputSize(canvasW, canvasH)
  const displayW = pw * (layer.dstW || 1)
  const displayH = ph * (layer.dstH || 1)
  const maxDisplay = Math.max(displayW, displayH, 1)
  return Math.min(Math.round(maxDisplay * quality), PREVIEW_MAX_SIDE)
}

/**
 * 将画布尺寸等比缩放到 PREVIEW_MAX_SIDE 以内
 */
function calcOutputSize(cw: number, ch: number): [number, number] {
  const maxEdge = Math.max(cw, ch)
  if (maxEdge <= PREVIEW_MAX_SIDE) return [cw, ch]
  const scale = PREVIEW_MAX_SIDE / maxEdge
  return [Math.round(cw * scale), Math.round(ch * scale)]
}

// ── 类型 ──

interface LunaRenderCore {
  init: () => Promise<void>
  loadTexture: (data: Buffer, width: number, height: number) => Promise<number>
  updateTexture: (textureId: number, data: Buffer) => Promise<void>
  renderFrame: (canvasWidth: number, canvasHeight: number, layers: unknown[]) => Promise<Buffer>
  releaseTexture: (textureId: number) => Promise<void>
}

function getLRC(): LunaRenderCore | undefined {
  return (window as unknown as { lunaRenderCore?: LunaRenderCore }).lunaRenderCore
}

/** 视频层稳定标识（同 index + 同文件路径视为同一视频源） */
function videoLayerKey(layer: PreviewLayer, index: number): string {
  return `v${index}_${layer.filePath}`
}

interface VideoStateEntry {
  key: string
  video: HTMLVideoElement
  textureId: number
  offscreen: OffscreenCanvas | null
  renderW: number
  renderH: number
  prevVideoTime: number
  ready: boolean
}

export interface MultipleLayerVideoPreviewLrcRenderProps {
  /** 所有合成层（视频 + 图片） */
  layers: PreviewLayer[]
  className?: string
  /** 输出画布宽度（不传则自动计算） */
  canvasWidth?: number
  /** 输出画布高度（不传则自动计算） */
  canvasHeight?: number
  /** 是否正在播放（true=视频播放中，false=暂停） */
  playing?: boolean
  /**
   * 视频解码质量系数。
   * 每个视频层的解码分辨率 = 该层在预览画布上的显示尺寸 × decodeQuality。
   * 1.0 = 匹配显示尺寸，1.5 = 1.5× 余量，2.0 = 2×。
   * 设为 0 使用全局 PREVIEW_MAX_SIDE。
   */
  decodeQuality?: number
  onError?: (error: string) => void
  onReady?: () => void
  onRender?: () => void
}

/**
 * MultipleLayerVideoPreviewLrcRender
 *
 * 支持任意数量视频层的前端 `<video>` 解码预览组件。
 * - 每个视频层对应一个独立的 `<video>` 元素
 * - 每帧从所有 `<video>` 捕获当前画面 → 上传 GPU 纹理 → 调用 `renderFrame` 合成
 * - 图片层走纹理缓存（同 VideoDomPreviewLrcRender）
 * - 适合多视频层合成场景（如创意工厂三拼/多拼预览）
 */
export const MultipleLayerVideoPreviewLrcRender = memo(
  forwardRef<unknown, MultipleLayerVideoPreviewLrcRenderProps>(
    function MultipleLayerVideoPreviewLrcRender(
      { layers, className, canvasWidth, canvasHeight, playing = false, decodeQuality = 1.5, onError, onReady, onRender },
      _ref,
    ) {
      const outputCanvasRef = useRef<HTMLCanvasElement>(null)
      const lrcRef = useRef<LunaRenderCore | null>(null)
      const destroyRef = useRef(false)
      const readyRef = useRef(false)
      const rafRef = useRef(0)
      const renderingRef = useRef(false)
      const renderQueuedRef = useRef(false)
      const lastFrameAtRef = useRef(0)
      const [ready, setReady] = useState(false)
      const [fatalError, setFatalError] = useState<string | null>(null)

      // 用 ref 持 latest props，避免闭包过期
      const layersRef = useRef(layers)
      layersRef.current = layers
      const playingRef = useRef(playing)
      playingRef.current = playing
      const canvasWidthRef = useRef(canvasWidth)
      canvasWidthRef.current = canvasWidth
      const canvasHeightRef = useRef(canvasHeight)
      canvasHeightRef.current = canvasHeight
      const decodeQualityRef = useRef(decodeQuality)
      decodeQualityRef.current = decodeQuality

      // 视频层状态：key → VideoStateEntry
      const videoStatesRef = useRef<Map<string, VideoStateEntry>>(new Map())
      // 图片纹理缓存：filePath → textureId
      const imageTextureCacheRef = useRef<Map<string, number>>(new Map())

      // ── 初始化 LRC ──
      useEffect(() => {
        (window as any).__perfStart = (window as any).__perfStart || performance.now()
        const t0 = performance.now()
        console.log('[Perf] MultipleLayerVideoPreviewLrcRender mount', { layers: layers.length })
        const lrc = getLRC()
        if (!lrc) {
          const msg = '渲染引擎未加载'
          setFatalError(msg)
          onError?.(msg)
          return
        }
        destroyRef.current = false
        lrcRef.current = lrc
        lrc.init()
          .then(() => {
            const t1 = performance.now()
            console.log(`[Perf] LRC init done in ${(t1 - t0).toFixed(0)}ms`)
            if (!destroyRef.current) {
              setReady(true)
              readyRef.current = true
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
          // 释放所有视频纹理
          for (const [, entry] of videoStatesRef.current) {
            if (entry.textureId > 0) {
              lrc.releaseTexture(entry.textureId).catch(() => {})
            }
          }
          videoStatesRef.current.clear()
          // 释放所有图片纹理
          for (const [, texId] of imageTextureCacheRef.current) {
            lrc.releaseTexture(texId).catch(() => {})
          }
          imageTextureCacheRef.current.clear()
        }
      }, [])

      // ── 管理视频元素 ──
      useEffect(() => {
        if (!readyRef.current) return
        const t0 = performance.now()
        console.log(`[Perf] video management effect start, ${layers.filter(l => l.isVideo).length} video layers`)
        const lrc = lrcRef.current
        if (!lrc) return

        // 收集当前需要的视频层
        const requiredKeys = new Set<string>()
        const videoLayerInfos: Array<{ layer: PreviewLayer; index: number; key: string }> = []

        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i]
          if (layer.isVideo) {
            const key = videoLayerKey(layer, i)
            requiredKeys.add(key)
            videoLayerInfos.push({ layer, index: i, key })
          }
        }

        // 移除不再需要的视频状态
        for (const [existingKey, entry] of videoStatesRef.current) {
          if (!requiredKeys.has(existingKey)) {
            if (entry.textureId > 0) {
              lrc.releaseTexture(entry.textureId).catch(() => {})
            }
            entry.video.pause()
            entry.video.src = ''
            videoStatesRef.current.delete(existingKey)
          }
        }

        // 创建 / 复用视频元素
        for (const { layer, key } of videoLayerInfos) {
          const existing = videoStatesRef.current.get(key)
          const src = filePathToPreviewUrl(layer.filePath) ?? layer.filePath

          if (existing && existing.video.src.endsWith(layer.filePath)) {
            // 同一视频源，仅更新时间（播放中不 seek）
            const vt = layer.videoTime ?? 0
            if (Math.abs(existing.prevVideoTime - vt) > 0.01) {
              if (!playingRef.current) {
                existing.video.currentTime = vt
              }
              existing.prevVideoTime = vt
            }
            continue
          }

          // 存在旧视频但源变了 → 释放
          if (existing) {
            if (existing.textureId > 0) {
              lrc.releaseTexture(existing.textureId).catch(() => {})
            }
            existing.video.pause()
            existing.video.src = ''
          }

          // 创建新 video 元素
          const video = document.createElement('video')
          video.muted = true
          video.loop = false
          video.playsInline = true
          video.preload = 'auto'
          video.crossOrigin = 'anonymous'
          video.src = src

          const entry: VideoStateEntry = {
            key,
            video,
            textureId: 0,
            offscreen: null,
            renderW: 0,
            renderH: 0,
            prevVideoTime: layer.videoTime ?? 0,
            ready: false,
          }

          video.addEventListener('loadeddata', () => {
            if (destroyRef.current) return
            const tLoaded = performance.now()
            console.log(`[Perf] video loadeddata [${layer.filePath.slice(-30)}] in ${(tLoaded - t0).toFixed(0)}ms offset`)
            // 根据该层的显示尺寸 + 质量系数计算解码上限
            const layerMaxSide = computeLayerDecodeMaxSide(
              layer,
              canvasWidthRef.current,
              canvasHeightRef.current,
              decodeQualityRef.current,
            )
            const srcMax = Math.max(video.videoWidth || 1280, video.videoHeight || 720)
            const effectiveMaxSide = Math.min(srcMax, layerMaxSide)
            const [rw, rh] = calcRenderSize(
              video.videoWidth || 1280,
              video.videoHeight || 720,
              effectiveMaxSide,
            )
            entry.offscreen = new OffscreenCanvas(rw, rh)
            entry.renderW = rw
            entry.renderH = rh
            entry.ready = true
            entry.video.currentTime = layer.videoTime ?? 0
            void renderFrame()
          })

          video.addEventListener('seeked', () => {
            if (destroyRef.current) return
            void renderFrame()
          })

          video.addEventListener('timeupdate', () => {
            if (destroyRef.current || !entry.ready) return
            void renderFrame()
          })

          video.addEventListener('error', () => {
            console.error('[MultipleLayerVideoPreviewLrcRender] video error', {
              file: layer.filePath,
              code: video.error?.code,
              message: video.error?.message,
            })
          })

          video.load()
          videoStatesRef.current.set(key, entry)
        }
        const tEnd = performance.now()
        console.log(`[Perf] video management effect done in ${(tEnd - t0).toFixed(0)}ms, ${videoStatesRef.current.size} videos managed`)
      }, [layers])

      // ── 播放/暂停控制 ──
      useEffect(() => {
        if (!readyRef.current) return
        if (playing) {
          console.log(`[Perf] play start — seeking videos to startTime at ${(performance.now() - (window as any).__perfStart).toFixed(0)}ms`)
        }
        for (const [, entry] of videoStatesRef.current) {
          if (!entry.ready) continue
          if (playing) {
            // seek 到各视频层的起始时间
            const currentLayers = layersRef.current
            for (let i = 0; i < currentLayers.length; i++) {
              if (currentLayers[i].isVideo) {
                const k = videoLayerKey(currentLayers[i], i)
                const ve = videoStatesRef.current.get(k)
                if (ve && ve.ready) {
                  ve.video.currentTime = currentLayers[i].videoTime ?? 0
                  ve.prevVideoTime = currentLayers[i].videoTime ?? 0
                }
              }
            }
            entry.video.play().catch(() => {})
          } else {
            entry.video.pause()
          }
        }
        void renderFrame()
      }, [ready, playing])

      // ── 加载图片纹理 ──
      async function loadImageTexture(filePath: string): Promise<number> {
        const lrc = lrcRef.current
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
        const rgbaData = new Uint8Array(
          imageData.data.buffer,
          imageData.data.byteOffset,
          imageData.data.byteLength,
        )
        const texId = await lrc.loadTexture(rgbaData as unknown as Buffer, w, h)
        imageTextureCacheRef.current.set(filePath, texId)
        return texId
      }

      // ── 渲染帧 ──
      async function renderFrame() {
        const lrc = lrcRef.current
        const canvas = outputCanvasRef.current
        const currentLayers = layersRef.current
        if (!lrc || !canvas || destroyRef.current) return

        if (renderingRef.current) {
          renderQueuedRef.current = true
          return
        }

        renderingRef.current = true
        renderQueuedRef.current = false

        try {
          const renderLayers: unknown[] = []
          const usedImageTextures = new Set<string>()

          for (let i = 0; i < currentLayers.length; i++) {
            const layer = currentLayers[i]
            let textureId: number

            if (layer.isVideo) {
              const key = videoLayerKey(layer, i)
              const entry = videoStatesRef.current.get(key)

              if (!entry || !entry.ready) continue // 视频未就绪，跳过

              // 需要 seek 到新的时间点（播放中不主动 seek）
              const vt = layer.videoTime ?? 0
              if (Math.abs(entry.prevVideoTime - vt) > 0.01) {
                if (!playingRef.current) {
                  entry.video.currentTime = vt
                }
                entry.prevVideoTime = vt
              }

              // 捕获当前帧
              const ctx2d = entry.offscreen?.getContext('2d')
              if (!ctx2d || !entry.offscreen) continue

              ctx2d.clearRect(0, 0, entry.renderW, entry.renderH)
              ctx2d.drawImage(entry.video, 0, 0, entry.renderW, entry.renderH)

              const imageData = ctx2d.getImageData(0, 0, entry.renderW, entry.renderH)
              const rgbaData = new Uint8Array(
                imageData.data.buffer,
                imageData.data.byteOffset,
                imageData.data.byteLength,
              )

              if (entry.textureId === 0) {
                entry.textureId = await lrc.loadTexture(
                  rgbaData as unknown as Buffer,
                  entry.renderW,
                  entry.renderH,
                )
              } else {
                await lrc.updateTexture(entry.textureId, rgbaData as unknown as Buffer)
              }

              textureId = entry.textureId
            } else {
              // 图片层
              usedImageTextures.add(layer.filePath)
              try {
                textureId = await loadImageTexture(layer.filePath)
              } catch {
                console.error(
                  '[MultipleLayerVideoPreviewLrcRender] failed to load image:',
                  layer.filePath,
                )
                continue
              }
            }

            // ── positioning ──
            let positioning: unknown = undefined
            if (
              layer.positioning &&
              typeof layer.positioning === 'object' &&
              'anchor' in layer.positioning
            ) {
              const p = layer.positioning as unknown as Record<string, unknown>
              positioning = {
                anchor: String(p.anchor ?? ''),
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
              color: layer.color,
              transform: layer.transform,
              positioning,
              lutId: layer.lutId,
              lutIntensity: layer.lutIntensity,
            })
          }

          // 清理不再引用的图片纹理
          for (const [filePath, texId] of imageTextureCacheRef.current) {
            if (!usedImageTextures.has(filePath)) {
              lrc.releaseTexture(texId).catch(() => {})
              imageTextureCacheRef.current.delete(filePath)
            }
          }

          if (renderLayers.length === 0) return

          // 按 zIndex 排序
          renderLayers.sort(
            (a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
          )

          // 计算输出尺寸（等比缩放到 PREVIEW_MAX_SIDE）
          const [outW, outH] =
            canvasWidth && canvasHeight
              ? calcOutputSize(canvasWidth, canvasHeight)
              : [PREVIEW_MAX_SIDE, Math.round(PREVIEW_MAX_SIDE * 0.75)]

          const result = await lrc.renderFrame(outW, outH, renderLayers)
          if (destroyRef.current) return

          canvas.width = outW
          canvas.height = outH
          const displayCtx = canvas.getContext('2d')
          if (displayCtx) {
            const pixelData = new Uint8ClampedArray(result)
            displayCtx.putImageData(new ImageData(pixelData, outW, outH), 0, 0)
          }

          const firstRender = (window as any).__firstRenderDone === undefined
          if (firstRender) {
            (window as any).__firstRenderDone = true
            console.log(`[Perf] FIRST RENDER at ${(performance.now() - (window as any).__perfStart || performance.now()).toFixed(0)}ms`)
          }
          onRender?.()
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          console.error('[MultipleLayerVideoPreviewLrcRender] render error:', error)
          // 出错时释放所有纹理，避免泄漏
          const lrcCleanup = lrcRef.current
          if (lrcCleanup) {
            for (const [, entry] of videoStatesRef.current) {
              if (entry.textureId > 0) {
                lrcCleanup.releaseTexture(entry.textureId).catch(() => {})
                entry.textureId = 0
              }
            }
            for (const [fp, tid] of imageTextureCacheRef.current) {
              lrcCleanup.releaseTexture(tid).catch(() => {})
              imageTextureCacheRef.current.delete(fp)
            }
          }
          onError?.(msg)
        } finally {
          renderingRef.current = false
          if (renderQueuedRef.current && !destroyRef.current) {
            renderQueuedRef.current = false
            void renderFrame()
          }
        }
      }

      // ── 渲染循环（覆盖 renderFrame） ──
      useEffect(() => {
        if (!ready) return
        console.log(`[Perf] render loop started at ${(performance.now() - (window as any).__perfStart).toFixed(0)}ms`)

        function loop() {
          const now = performance.now()
          if (now - lastFrameAtRef.current >= 1000 / COMPOSITION_RENDER_FPS) {
            lastFrameAtRef.current = now
            void renderFrame()
          }
          rafRef.current = requestAnimationFrame(loop)
        }

        rafRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(rafRef.current)
      }, [ready])

      // ── layers 变化时立即触发一次渲染 ──
      useEffect(() => {
        if (!ready) return
        const t0 = performance.now()
        console.log(`[Perf] layers change trigger at ${(t0 - (window as any).__perfStart).toFixed(0)}ms`)
        const timer = setTimeout(() => void renderFrame(), 16)
        return () => clearTimeout(timer)
      }, [ready, layers])

      // ── 错误状态 UI ──
      if (fatalError) {
        return (
          <div
            className={className}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <p
              style={{
                color: 'var(--red, #e53e3e)',
                fontSize: 14,
                textAlign: 'center',
                padding: 16,
              }}
            >
              {fatalError}
            </p>
          </div>
        )
      }

      return <canvas ref={outputCanvasRef} className={className} />
    },
  ),
  (
    prevProps: MultipleLayerVideoPreviewLrcRenderProps,
    nextProps: MultipleLayerVideoPreviewLrcRenderProps,
  ) => {
    const layersEqual =
      prevProps.layers.length === nextProps.layers.length &&
      prevProps.layers.every(
        (l, i) =>
          l.filePath === nextProps.layers[i].filePath &&
          l.isVideo === nextProps.layers[i].isVideo &&
          l.videoTime === nextProps.layers[i].videoTime &&
          l.dstX === nextProps.layers[i].dstX &&
          l.dstY === nextProps.layers[i].dstY &&
          l.dstW === nextProps.layers[i].dstW &&
          l.dstH === nextProps.layers[i].dstH &&
          l.zIndex === nextProps.layers[i].zIndex &&
          l.opacity === nextProps.layers[i].opacity &&
          JSON.stringify(l.color) === JSON.stringify(nextProps.layers[i].color) &&
          JSON.stringify(l.transform) === JSON.stringify(nextProps.layers[i].transform) &&
          JSON.stringify(l.positioning) === JSON.stringify(nextProps.layers[i].positioning) &&
          l.lutId === nextProps.layers[i].lutId &&
          l.lutIntensity === nextProps.layers[i].lutIntensity
      )

    return (
      prevProps.playing === nextProps.playing &&
      prevProps.decodeQuality === nextProps.decodeQuality &&
      prevProps.canvasWidth === nextProps.canvasWidth &&
      prevProps.canvasHeight === nextProps.canvasHeight &&
      prevProps.className === nextProps.className &&
      layersEqual
    )
  },
)
