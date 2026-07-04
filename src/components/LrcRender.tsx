import { useEffect, useRef, useState } from 'react'
import type { PreviewLayer } from '../shared/types'

const PREVIEW_TEXTURE_MAX_SIZE = 1920

// ── 导出类型 ──

/** 纹理层（已加载的 textureId）— 供外部直接使用 LRC API 时参考 */
export interface LrcTextureLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

export type { PreviewLayer }

interface LrcRenderProps {
  layers: PreviewLayer[]
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
  className?: string
  onError?: (error: string) => void
  onReady?: () => void
  onRender?: () => void
}

// ── 工具 ──

function layerKey(l: PreviewLayer): string {
  return l.isVideo ? `v:${l.filePath}` : `s:${l.filePath}`
}

function fitPreviewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_TEXTURE_MAX_SIZE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function drawVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8Array | null {
  const sourceWidth = video.videoWidth
  const sourceHeight = video.videoHeight
  if (sourceWidth <= 0 || sourceHeight <= 0) return null
  const { width, height } = fitPreviewSize(sourceWidth, sourceHeight)
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, width, height)
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer)
}

// ── LunaRenderCore 接口 ──

interface LunaRenderCore {
  init: () => Promise<void>
  loadTexture: (data: Uint8Array, w: number, h: number) => Promise<number>
  loadTextureFromPath: (path: string, maxSize: number) => Promise<{ textureId: number; width: number; height: number }>
  updateTexture: (id: number, data: Uint8Array) => Promise<void>
  releaseTexture: (id: number) => Promise<void>
  renderFrame: (w: number, h: number, layers: LrcTextureLayer[]) => Promise<Uint8Array>
}

function getLRC(): LunaRenderCore | undefined {
  return (window as any).lunaRenderCore
}

// ── LrcRender ──

export function LrcRender({ layers, canvasRef: extRef, className, onError, onReady, onRender }: LrcRenderProps) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const layersRef = useRef<PreviewLayer[]>(layers)
  layersRef.current = layers

  const texMapRef = useRef<Map<string, { texId: number | null; width: number; height: number }>>(new Map())
  const videoMapRef = useRef<Map<string, { video: HTMLVideoElement; offscreen: HTMLCanvasElement }>>(new Map())

  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  // ═══════════════════════════════════════
  //  初始化
  // ═══════════════════════════════════════
  useEffect(() => {
    const lrc = getLRC()
    if (!lrc) {
      const msg = 'lunaRenderCore 未加载'
      setFatalError(msg); onError?.(msg)
      return
    }
    destroyRef.current = false
    lrc.init()
      .then(() => { if (!destroyRef.current) { setReady(true); onReady?.() } })
      .catch((e: Error) => {
        if (destroyRef.current) return
        const msg = `渲染引擎初始化失败: ${e.message}`
        setFatalError(msg); onError?.(msg)
      })

    return () => {
      destroyRef.current = true
      cancelAnimationFrame(rafRef.current)
      const lrc2 = getLRC()
      if (!lrc2) return
      // 组件卸载：释放所有纹理（包括 Rust 缓存中的）
      for (const [, t] of texMapRef.current) { if (t.texId != null) lrc2.releaseTexture(t.texId).catch(() => {}) }
      texMapRef.current.clear()
      for (const [, v] of videoMapRef.current) v.video.pause()
      videoMapRef.current.clear()
    }
  }, [])

  // ═══════════════════════════════════════
  //  合成渲染
  // ═══════════════════════════════════════
  let _renderCount = 0
  async function compositeRender() {
    const lrc = getLRC()
    const cvs = canvasRef.current
    if (!lrc || !cvs) return

    const pw = cvs.parentElement?.clientWidth ?? cvs.width
    const ph = cvs.parentElement?.clientHeight ?? cvs.height
    if (pw <= 0 || ph <= 0) return

    const currentLayers = layersRef.current
    const sorted = [...currentLayers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    _renderCount++
    const watermarkLayer = sorted.find(l => !l.isVideo && l.zIndex === 1)
    console.log(`[LrcRender] compositeRender #${_renderCount} ${pw}x${ph} layers=${sorted.length}` +
      (watermarkLayer ? ` wm={dstX:${watermarkLayer.dstX.toFixed(3)} dstY:${watermarkLayer.dstY.toFixed(3)} dstW:${watermarkLayer.dstW.toFixed(3)} dstH:${watermarkLayer.dstH.toFixed(3)} fit:${watermarkLayer.fit}}` : ''))

    const resultLayers: LrcTextureLayer[] = []

    for (const layer of sorted) {
      const key = layerKey(layer)
      const info = texMapRef.current.get(key)
      if (!info || info.texId == null) {
        console.log(`[LrcRender]   skip ${key}: no texture loaded`)
        continue
      }
      let { dstX, dstY, dstW, dstH } = layer

      if (layer.fit === 'contain') {
        const mediaAspect = info.width / info.height
        const framePixelW = dstW * pw
        const framePixelH = dstH * ph
        const frameAspect = framePixelW / framePixelH
        let w = dstW, h = dstH
        if (frameAspect > mediaAspect) {
          w = (framePixelH * mediaAspect) / pw
        } else {
          h = (framePixelW / mediaAspect) / ph
        }
        dstX += (dstW - w) / 2
        dstY += (dstH - h) / 2
        dstW = w; dstH = h
      }

      resultLayers.push({
        textureId: info.texId,
        dstX, dstY, dstW, dstH,
        srcX: layer.srcX ?? 0, srcY: layer.srcY ?? 0,
        srcW: layer.srcW ?? 1, srcH: layer.srcH ?? 1,
        opacity: layer.opacity ?? 1,
        zIndex: layer.zIndex ?? 0,
      })
    }

    if (resultLayers.length === 0) return

    try {
      const result = await lrc.renderFrame(pw, ph, resultLayers)
      cvs.width = pw; cvs.height = ph
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result), pw, ph), 0, 0,
      )
      onRender?.()
    } catch { /* 静默 */ }
  }

  // ═══════════════════════════════════════
  //  加载图层 / 启动视频
  // ═══════════════════════════════════════
  useEffect(() => {
    if (!ready) return
    const lrc = getLRC()
    if (!lrc) return
    console.log('[LrcRender] layers effect fired', layers.map(l => l.filePath?.slice(-25)))

    // ── 清理已移除的层 ──
    // 注意：静态图纹理不在此 release，由 Rust 侧 LRU 缓存自动管理；
    // 只有视频纹理（帧内容实时变化）才需要主动释放。
    const currentKeys = new Set(layers.map(layerKey))
    for (const [key, t] of texMapRef.current) {
      if (!currentKeys.has(key) && t.texId != null && key.startsWith('v:')) {
        lrc.releaseTexture(t.texId).catch(() => {})
        texMapRef.current.delete(key)
      } else if (!currentKeys.has(key)) {
        texMapRef.current.delete(key)
      }
    }
    for (const [key, v] of videoMapRef.current) {
      if (!currentKeys.has(key)) { v.video.pause(); videoMapRef.current.delete(key) }
    }

    // ── 静态图片层 ──
    for (const layer of layers.filter((l) => !l.isVideo)) {
      const key = layerKey(layer)
      if (texMapRef.current.has(key)) continue
      texMapRef.current.set(key, { texId: null, width: 0, height: 0 })

      // loadTextureFromPath 内部使用 ffmpeg 解码 + LRU 缓存（已在 Rust 侧实现）
      lrc.loadTextureFromPath(layer.filePath, PREVIEW_TEXTURE_MAX_SIZE)
        .then(({ textureId, width, height }) => {
          if (destroyRef.current) return
          const current = texMapRef.current.get(key)
          if (current) { current.texId = textureId; current.width = width; current.height = height }
          compositeRender()
        })
        .catch((e) => console.error('[LrcRender] 图片加载失败:', layer.filePath, e))
    }

    // 无论是否有新纹理加载，都触发一次合成（层参数可能变了，如水印位置）
    // 如果有新纹理在加载中，它们各自的 .then() 会再触发合成
    compositeRender()

    // ── 视频层：浏览器 <video> 硬件解码 ──
    for (const layer of layers.filter((l) => l.isVideo)) {
      const key = layerKey(layer)
      if (videoMapRef.current.has(key)) continue
      if (!texMapRef.current.has(key)) texMapRef.current.set(key, { texId: null, width: 0, height: 0 })

      const video = document.createElement('video')
      video.muted = true; video.loop = true; video.playsInline = true
      const offscreen = document.createElement('canvas')
      videoMapRef.current.set(key, { video, offscreen })

      video.src = layer.filePath
      video.load()

      video.oncanplay = () => {
        const rgba = drawVideoFrame(video, offscreen)
        if (!rgba || destroyRef.current) return
        const { width, height } = fitPreviewSize(video.videoWidth, video.videoHeight)
        lrc.loadTexture(rgba, width, height)
          .then((texId) => {
            const t = texMapRef.current.get(key)
            if (t) { t.texId = texId; t.width = width; t.height = height }
            compositeRender()
          })
          .catch(() => {})
      }

      video.play().catch(() => {})
    }

    // ── RAF 循环（有视频层时）──
    if (layers.some((l) => l.isVideo)) {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)

      function videoLoop() {
        const lrc2 = getLRC()
        const pending: Promise<void>[] = []

        for (const layer of layersRef.current.filter((l) => l.isVideo)) {
          const key = layerKey(layer)
          const info = texMapRef.current.get(key)
          const v = videoMapRef.current.get(key)
          if (!info || !v || info.texId == null || v.video.paused || v.video.readyState < 2) continue

          const rgba = drawVideoFrame(v.video, v.offscreen)
          if (!rgba) continue

          if (lrc2) {
            pending.push(lrc2.updateTexture(info.texId, rgba))
          }
        }

        if (pending.length > 0) {
          Promise.all(pending).then(() => compositeRender()).catch(() => {})
        }
        rafRef.current = requestAnimationFrame(videoLoop)
      }

      rafRef.current = requestAnimationFrame(videoLoop)
    }

  }, [layers, ready])

  // ═══════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════
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
}
