import { useEffect, useRef, useState, forwardRef, memo } from 'react'
import type { PreviewLayer } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { COMPOSITION_RENDER_FPS } from './renderComposition'

const PREVIEW_MAX_SIDE = 1280

const perfLog = (msg: string) => console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] ${msg}`)

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
      // 纹理版本计数器：每次释放纹理时递增，用于检测 renderFrame 中的竞态
      const textureVersionRef = useRef(0)

      // ── 初始化 LRC ──
      useEffect(() => {
        (window as any).__perfStart = (window as any).__perfStart || performance.now()
        const t0 = performance.now()
        perfLog(`MultipleLayerVideoPreviewLrcRender mount layers=${layers.length}`)
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
            perfLog(`LRC init done in ${(t1 - t0).toFixed(0)}ms`)
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
          textureVersionRef.current++
        }
      }, [])

      // ── 管理视频元素 ──
      useEffect(() => {
        if (!readyRef.current) {
          // LRC 尚未就绪，跳过视频创建；依赖有 ready，等 ready 变为 true 后自动重跑
          return
        }
        const t0 = performance.now()
        perfLog(`video management effect start, ${layers.filter(l => l.isVideo).length} video layers`)
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
              const tid = entry.textureId
              entry.textureId = 0 // 先清除，避免并发 renderFrame 读取到已释放的 ID
              lrc.releaseTexture(tid).catch(() => {})
              textureVersionRef.current++
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
            // 同一视频源，仅在时间轴位置变化时同步跳转
            const vt = layer.videoTime ?? 0
            if (Math.abs(existing.prevVideoTime - vt) > 0.01) {
              existing.video.currentTime = vt
              existing.prevVideoTime = vt
            }
            continue
          }

          // 存在旧视频但源变了 → 释放
          if (existing) {
            if (existing.textureId > 0) {
              const tid = existing.textureId
              existing.textureId = 0
              lrc.releaseTexture(tid).catch(() => {})
              textureVersionRef.current++
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
            perfLog(`video loadeddata [${layer.filePath.slice(-30)}] in ${(tLoaded - t0).toFixed(0)}ms offset`)
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
            if (playingRef.current) entry.video.play().catch(() => {})
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
        perfLog(`video management effect done in ${(tEnd - t0).toFixed(0)}ms, ${videoStatesRef.current.size} videos managed`)
      }, [layers, ready])

      // ── 播放/暂停控制 ──
      useEffect(() => {
        if (!readyRef.current) return
        for (const [, entry] of videoStatesRef.current) {
          if (!entry.ready) continue
          if (playing) {
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
        // 快照当前纹理版本，渲染完成后检查是否有纹理在此期间被释放
        const versionAtStart = textureVersionRef.current

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

              // 时间轴位置变化时同步跳转；普通播放不会改变 layer.videoTime
              const vt = layer.videoTime ?? 0
              if (Math.abs(entry.prevVideoTime - vt) > 0.01) {
                entry.video.currentTime = vt
                entry.prevVideoTime = vt
              }

              // 捕获当前帧
              const ctx2d = entry.offscreen?.getContext('2d', { willReadFrequently: true })
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
                // 加载完后验证 entry 在 IPC 期间未被清理（切换素材时的竞态）
                if (videoStatesRef.current.get(key) !== entry) {
                  lrc.releaseTexture(entry.textureId).catch(() => {})
                  entry.textureId = 0
                  continue
                }
              } else {
                await lrc.updateTexture(entry.textureId, rgbaData as unknown as Buffer)
                // 更新完后验证 entry 在 IPC 期间未被清理
                if (videoStatesRef.current.get(key) !== entry) {
                  continue
                }
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
              fit: layer.fit,
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

          // 发送最终 renderFrame IPC 前检查组件是否尚未销毁
          if (destroyRef.current) return
          // 检查纹理版本：若在构建 renderLayers 期间有纹理被释放（如视频管理 effect），
          // 则 renderLayers 中的纹理 ID 可能已失效，放弃本次渲染，等待下次 renderFrame 重试
          if (textureVersionRef.current !== versionAtStart) {
            renderQueuedRef.current = true
            return
          }
          const result = await lrc.renderFrame(outW, outH, renderLayers)
          // render 过程中组件可能已被卸载（tab 切换），此时 textures 可能已被清理
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
            perfLog(`FIRST RENDER at ${(performance.now() - (window as any).__perfStart || performance.now()).toFixed(0)}ms`)
          }
          onRender?.()
        } catch (error) {
          // 组件已卸载（如 tab 切换）时纹理被清理导致 renderFrame IPC 报错属正常，静默忽略
          if (destroyRef.current) return

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
          textureVersionRef.current++
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
        perfLog(`render loop started at ${(performance.now() - (window as any).__perfStart).toFixed(0)}ms`)

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
        perfLog(`layers change trigger at ${(t0 - (window as any).__perfStart).toFixed(0)}ms`)
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
          l.fit === nextProps.layers[i].fit &&
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
