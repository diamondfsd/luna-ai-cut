import { useEffect, useRef, useState } from 'react'

// ── 导出类型 ──

/** 纹理层（已加载的 textureId）— 供外部直接使用 LRC API 时参考 */
export interface LrcTextureLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

interface LrcLayerBase {
  dstX: number; dstY: number; dstW: number; dstH: number
  /** 源裁剪归一化坐标，默认 {x:0, y:0, w:1, h:1} */
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number
  zIndex?: number
  /** 适配方式，默认 'fill' */
  fit?: 'fill' | 'contain'
}

/**
 * 静态图片层 — LrcRender 内部自动加载为纹理
 */
export interface LrcStaticLayer extends LrcLayerBase {
  imagePath: string
}

/**
 * 视频层 — LrcRender 内部创建隐藏 video + RAF 循环推送帧
 */
export interface LrcVideoLayer extends LrcLayerBase {
  videoPath: string
}

export type LrcLayer = LrcStaticLayer | LrcVideoLayer

interface LrcRenderProps {
  layers: LrcLayer[]
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
  className?: string
  onError?: (error: string) => void
  onReady?: () => void
}

// ── lunaRenderCore 类型 ──

interface LunaRenderCore {
  init: () => Promise<void>
  loadTexture: (data: Uint8Array, w: number, h: number) => Promise<number>
  updateTexture: (id: number, data: Uint8Array) => Promise<void>
  releaseTexture: (id: number) => Promise<void>
  renderFrame: (w: number, h: number, layers: LrcTextureLayer[]) => Promise<Uint8Array>
  destroy: () => Promise<void>
}

function getLRC(): LunaRenderCore | undefined {
  return (window as any).lunaRenderCore
}

// ── 工具 ──

function isStatic(l: LrcLayer): l is LrcStaticLayer {
  return 'imagePath' in l
}
function isVideo(l: LrcLayer): l is LrcVideoLayer {
  return 'videoPath' in l
}
function layerKey(l: LrcLayer): string {
  return isStatic(l) ? `s:${l.imagePath}` : `v:${l.videoPath}`
}

async function loadImageAsRGBA(path: string): Promise<{
  rgba: Uint8Array; width: number; height: number
}> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`图片加载失败: ${path}`))
    img.src = path
  })
  const w = img.naturalWidth; const h = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  const idata = c.getContext('2d')!.getImageData(0, 0, w, h)
  return { rgba: new Uint8Array(idata.data.buffer), width: w, height: h }
}

// ── LrcRender ──

export function LrcRender({ layers, canvasRef: extRef, className, onError, onReady }: LrcRenderProps) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const layersRef = useRef<LrcLayer[]>(layers)
  layersRef.current = layers

  // key → { texId, width, height }
  const texMapRef = useRef<Map<string, { texId: number | null; width: number; height: number }>>(new Map())
  // key → { video, offscreen }
  const videoMapRef = useRef<Map<string, { video: HTMLVideoElement; offscreen: HTMLCanvasElement }>>(new Map())

  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  // ═══════════════════════════════════════
  //  初始化 lunaRenderCore
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
      for (const [, t] of texMapRef.current) { if (t.texId != null) lrc2.releaseTexture(t.texId).catch(() => {}) }
      texMapRef.current.clear()
      for (const [, v] of videoMapRef.current) v.video.pause()
      videoMapRef.current.clear()
      lrc2.destroy().catch(() => {})
    }
  }, [])

  // ═══════════════════════════════════════
  //  合成渲染（读 layersRef 做最终合成）
  // ═══════════════════════════════════════
  async function compositeRender() {
    const lrc = getLRC()
    const cvs = canvasRef.current
    if (!lrc || !cvs) return

    const pw = cvs.parentElement?.clientWidth ?? cvs.width
    const ph = cvs.parentElement?.clientHeight ?? cvs.height
    if (pw <= 0 || ph <= 0) return

    const currentLayers = layersRef.current
    const sorted = [...currentLayers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    const resultLayers: LrcTextureLayer[] = []

    for (const layer of sorted) {
      const key = layerKey(layer)
      const info = texMapRef.current.get(key)
      if (!info || info.texId == null) continue

      let { dstX, dstY, dstW, dstH } = layer

      if (layer.fit === 'contain') {
        const ar = info.width / info.height
        let w = dstW, h = dstW / ar
        if (h > dstH) { h = dstH; w = dstH * ar }
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
    } catch { /* 渲染错误静默 */ }
  }

  // ═══════════════════════════════════════
  //  加载图层 / 启动视频
  // ═══════════════════════════════════════
  useEffect(() => {
    if (!ready) return
    const lrc = getLRC()
    if (!lrc) return

    // ── 清理已移除的层 ──
    const currentKeys = new Set(layers.map(layerKey))
    for (const [key, t] of texMapRef.current) {
      if (!currentKeys.has(key) && t.texId != null) {
        lrc.releaseTexture(t.texId).catch(() => {})
        texMapRef.current.delete(key)
      }
    }
    for (const [key, v] of videoMapRef.current) {
      if (!currentKeys.has(key)) { v.video.pause(); videoMapRef.current.delete(key) }
    }

    // ── 静态图片层 ──
    for (const layer of layers.filter(isStatic)) {
      const key = layerKey(layer)
      if (texMapRef.current.has(key)) continue
      texMapRef.current.set(key, { texId: null, width: 0, height: 0 })

      loadImageAsRGBA(layer.imagePath)
        .then(async ({ rgba, width, height }) => {
          if (destroyRef.current) return
          const texId = await lrc.loadTexture(rgba, width, height)
          const current = texMapRef.current.get(key)
          if (current) { current.texId = texId; current.width = width; current.height = height }
          compositeRender()
        })
        .catch((e) => console.error('[LrcRender] 图片加载失败:', layer.imagePath, e))
    }

    // ── 视频层 ──
    for (const layer of layers.filter(isVideo)) {
      const key = layerKey(layer)
      if (videoMapRef.current.has(key)) continue
      if (!texMapRef.current.has(key)) texMapRef.current.set(key, { texId: null, width: 0, height: 0 })

      const video = document.createElement('video')
      video.muted = true; video.loop = true; video.playsInline = true
      const offscreen = document.createElement('canvas')
      videoMapRef.current.set(key, { video, offscreen })

      video.src = layer.videoPath
      video.load()

      video.oncanplay = () => {
        const vw = video.videoWidth; const vh = video.videoHeight
        if (vw <= 0 || vh <= 0) return
        offscreen.width = vw; offscreen.height = vh
        offscreen.getContext('2d')!.drawImage(video, 0, 0, vw, vh)
        const idata = offscreen.getContext('2d')!.getImageData(0, 0, vw, vh)
        if (destroyRef.current) return
        lrc.loadTexture(new Uint8Array(idata.data.buffer), vw, vh)
          .then((texId) => {
            const t = texMapRef.current.get(key)
            if (t) { t.texId = texId; t.width = vw; t.height = vh }
            compositeRender()
          })
          .catch(() => {})
      }

      video.play().catch(() => {})
    }

    // ── 启动 RAF 循环（有视频层时） ──
    if (layers.some(isVideo)) {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)

      function videoLoop() {
        const lrc2 = getLRC()
        const pending: Promise<void>[] = []

        for (const layer of layersRef.current.filter(isVideo)) {
          const key = layerKey(layer)
          const info = texMapRef.current.get(key)
          const v = videoMapRef.current.get(key)
          if (!info || !v || info.texId == null || v.video.paused || v.video.readyState < 2) continue

          const vw = v.video.videoWidth; const vh = v.video.videoHeight
          if (vw <= 0 || vh <= 0) continue
          v.offscreen.width = vw; v.offscreen.height = vh
          v.offscreen.getContext('2d')!.drawImage(v.video, 0, 0, vw, vh)
          const idata = v.offscreen.getContext('2d')!.getImageData(0, 0, vw, vh)

          if (lrc2) {
            pending.push(lrc2.updateTexture(info.texId, new Uint8Array(idata.data.buffer)))
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
