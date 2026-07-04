import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
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

/** LrcRender 暴露给父组件的方法 */
export interface LrcRenderHandle {
  /** 以指定分辨率导出当前帧图片到文件（Rust 直接渲染+编码+写入） */
  exportImage(
    outputPath: string,
    width: number,
    height: number,
    format: string,
    quality: number,
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
  /** 有视频层时，向外暴露第一个 video 元素用于外部控制 */
  onVideoElement?: (el: HTMLVideoElement | null) => void
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
  exportImage: (outputPath: string, width: number, height: number, layers: LrcTextureLayer[], format: string, quality: number) => Promise<void>
}

function getLRC(): LunaRenderCore | undefined {
  return (window as any).lunaRenderCore
}

/**
 * 从当前图层和纹理映射构建渲染层列表，供 compositeRender 和 exportImage 共用。
 * 包含 contain 适配计算。
 */
function buildExportLayers(
  layers: PreviewLayer[],
  renderW: number,
  renderH: number,
  texMap: Map<string, { texId: number | null; width: number; height: number }>,
): LrcTextureLayer[] {
  const sorted = [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
  const result: LrcTextureLayer[] = []

  for (const layer of sorted) {
    const key = layerKey(layer)
    const info = texMap.get(key)
    if (!info || info.texId == null) continue

    let { dstX, dstY, dstW, dstH } = layer

    if (info.height > info.width && layer.fit === 'contain') {
      const pxW = (dstW * renderW).toFixed(0)
      const pxH = (dstH * renderH).toFixed(0)
      console.log(`[LrcRender] portrait tex=${info.width}x${info.height} dst=${dstW.toFixed(3)}x${dstH.toFixed(3)} → ${pxW}x${pxH}`)
    }

    if (layer.fit === 'contain') {
      const mediaAspect = info.width / info.height
      const framePixelW = dstW * renderW
      const framePixelH = dstH * renderH
      const frameAspect = framePixelW / framePixelH
      let w = dstW; let h = dstH
      if (frameAspect > mediaAspect) {
        w = (framePixelH * mediaAspect) / renderW
      } else {
        h = (framePixelW / mediaAspect) / renderH
      }
      dstX += (dstW - w) / 2
      dstY += (dstH - h) / 2
      dstW = w; dstH = h
    }

    result.push({
      textureId: info.texId,
      dstX, dstY, dstW, dstH,
      srcX: layer.srcX ?? 0, srcY: layer.srcY ?? 0,
      srcW: layer.srcW ?? 1, srcH: layer.srcH ?? 1,
      opacity: layer.opacity ?? 1,
      zIndex: layer.zIndex ?? 0,
    })
  }

  return result
}

// ── LrcRender ──

export const LrcRender = forwardRef<LrcRenderHandle, LrcRenderProps>(function LrcRender(
  { layers, canvasRef: extRef, className, onError, onReady, onRender, onVideoElement },
  ref,
) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const layersRef = useRef<PreviewLayer[]>(layers)
  layersRef.current = layers

  const texMapRef = useRef<Map<string, { texId: number | null; width: number; height: number }>>(new Map())
  const videoMapRef = useRef<Map<string, { video: HTMLVideoElement; offscreen: HTMLCanvasElement }>>(new Map())
  const videoElementCalledRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [renderKey, setRenderKey] = useState(0)

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
    // 清除残留的旧 texMapRef 条目（来自上次挂载周期，texId 已失效）
    texMapRef.current.clear()
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
  async function compositeRender() {
    const lrc = getLRC()
    const cvs = canvasRef.current
    if (!lrc || !cvs) return

    const dpr = window.devicePixelRatio || 1
    const cw = cvs.parentElement?.clientWidth ?? cvs.width
    const ch = cvs.parentElement?.clientHeight ?? cvs.height
    let pw = Math.round(cw * dpr)
    let ph = Math.round(ch * dpr)
    const MAX_RENDER_PX = 1440
    if (pw > MAX_RENDER_PX) { const s = MAX_RENDER_PX / pw; pw = MAX_RENDER_PX; ph = Math.round(ph * s) }
    if (ph > MAX_RENDER_PX) { const s = MAX_RENDER_PX / ph; ph = MAX_RENDER_PX; pw = Math.round(pw * s) }
    if (pw <= 0 || ph <= 0) return

    const currentLayers = layersRef.current
    const resultLayers = buildExportLayers(currentLayers, pw, ph, texMapRef.current)
    if (resultLayers.length === 0) return

    try {
      console.log(`[LrcRender] renderFrame: canvas=${pw}x${ph} layers=${resultLayers.length} [${resultLayers.map(l => `${l.textureId}:${l.dstW.toFixed(3)}x${l.dstH.toFixed(3)}`).join(', ')}]`)
      const result = await lrc.renderFrame(pw, ph, resultLayers)
      cvs.width = pw; cvs.height = ph
      cvs.style.width = `${cw}px`
      cvs.style.height = `${ch}px`
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result), pw, ph), 0, 0,
      )
      onRender?.()
    } catch {
      // 纹理被 Rust LRU 淘汰 → 清理失效条目，通知 effect 重载
      const failed = new Set(resultLayers.map((l) => l.textureId))
      for (const [k, v] of texMapRef.current) {
        if (v.texId != null && failed.has(v.texId)) {
          texMapRef.current.delete(k)
        }
      }
      setRenderKey((k) => k + 1)
    }
  }

  // ═══════════════════════════════════════
  //  加载图层 / 启动视频
  // ═══════════════════════════════════════
  useEffect(() => {
    if (!ready) return
    const lrc = getLRC()
    if (!lrc) return

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

    // 被暴露的 video 元素已被移除，通知外部
    if (videoMapRef.current.size === 0) {
      videoElementCalledRef.current = false
      onVideoElement?.(null)
    }

    // ── 静态图片层 ──
    // 估算画布像素宽度用于计算纹理加载尺寸
    const estCanvasW = Math.round((canvasRef.current?.parentElement?.clientWidth ?? 960) * (window.devicePixelRatio || 1))
    for (const layer of layers.filter((l) => !l.isVideo)) {
      const key = layerKey(layer)
      if (texMapRef.current.has(key)) continue
      texMapRef.current.set(key, { texId: null, width: 0, height: 0 })

      // 精确按渲染尺寸加载，ffmpeg Lanczos 一步到位，wgpu 1:1 无缩放
      const renderPx = Math.round(Math.max(layer.dstW * estCanvasW, layer.dstH * estCanvasW))
      const maxSize = Math.min(Math.max(renderPx, 16), PREVIEW_TEXTURE_MAX_SIZE)
      lrc.loadTextureFromPath(layer.filePath, maxSize)
        .then(({ textureId, width, height }) => {
          if (destroyRef.current) return
          const current = texMapRef.current.get(key)
          if (current) { current.texId = textureId; current.width = width; current.height = height }
          console.log(`[LrcRender] texture loaded: key=${key} ${width}x${height} dstW=${layer.dstW.toFixed(3)} dstH=${layer.dstH.toFixed(3)} fit=${layer.fit}`)
          compositeRender()
        })
        .catch((e) => console.error('[LrcRender] 图片加载失败:', layer.filePath, e))
    }

    // 静态纹理全部已缓存时触发一次合成（如水印位置变化）
    const allCached = layers.filter((l) => !l.isVideo).every((l) => texMapRef.current.get(layerKey(l))?.texId != null)
    if (allCached) compositeRender()

    // ── 视频层：浏览器 <video> 硬件解码 ──
    for (const layer of layers.filter((l) => l.isVideo)) {
      const key = layerKey(layer)
      if (videoMapRef.current.has(key)) continue
      if (!texMapRef.current.has(key)) texMapRef.current.set(key, { texId: null, width: 0, height: 0 })

      const video = document.createElement('video')
      video.muted = true; video.loop = true; video.playsInline = true
      const offscreen = document.createElement('canvas')
      videoMapRef.current.set(key, { video, offscreen })

      // 对外暴露第一个 video 元素用于外部控制器
      if (onVideoElement && !videoElementCalledRef.current) {
        videoElementCalledRef.current = true
        onVideoElement(video)
      }

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

  }, [layers, ready, renderKey])

  // 暴露导出方法
  useImperativeHandle(ref, () => ({
    async exportImage(
      outputPath: string,
      width: number,
      height: number,
      format: string,
      quality: number,
    ): Promise<void> {
      const lrc = getLRC()
      if (!lrc) throw new Error('渲染引擎未初始化')

      const currentLayers = layersRef.current
      // 与预览使用完全相同的算法和层数据
      const renderLayers = buildExportLayers(currentLayers, width, height, texMapRef.current)
      if (renderLayers.length === 0) throw new Error('无可用图层')

      await lrc.exportImage(outputPath, width, height, renderLayers, format, quality)
    },
  }), [])

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
})
