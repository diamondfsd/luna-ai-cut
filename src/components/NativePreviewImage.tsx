/**
 * NativePreviewImage — 基于 Native Core (wgpu) 的图片+水印预览组件
 *
 * 替代原生 <img> + WatermarkOverlay，预览弹窗和工作台统一使用。
 */
import { useEffect, useRef, useCallback, useState } from 'react'

interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
}

interface WatermarkConfig {
  enabled: boolean
  style: string
  position: string
  /** 水印在图片坐标系中的像素布局（调用方计算好传入） */
  layout?: { x: number; y: number; width: number; height: number } | null
}

function getLRC() {
  return (window as any).lunaRenderCore as {
    init: () => Promise<void>
    loadTexture: (data: Uint8Array, w: number, h: number) => Promise<number>
    updateTexture: (id: number, data: Uint8Array) => Promise<void>
    releaseTexture: (id: number) => Promise<void>
    renderFrame: (w: number, h: number, layers: RenderLayer[]) => Promise<Uint8Array>
    destroy: () => Promise<void>
  } | undefined
}

interface Props {
  /** 图片 URL */
  src: string
  /** 图片宽高（加载后填充） */
  naturalWidth?: number
  naturalHeight?: number
  /** 水印 */
  watermark?: WatermarkConfig | null
  /** canvas className */
  className?: string
  /** 图片加载完成回调 */
  onLoad?: (w: number, h: number) => void
  /** canvas ref 供外部使用 */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
}

export function NativePreviewImage({ src, naturalWidth, naturalHeight, watermark, className, onLoad, canvasRef: extCanvasRef }: Props) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extCanvasRef ?? internalRef
  const mediaTexRef = useRef<number | null>(null)
  const wmTexRef = useRef<number | null>(null)
  const loadedSrcRef = useRef('')
  const [ready, setReady] = useState(false)

  // ── init Native Core ──
  useEffect(() => {
    const lrc = getLRC()
    if (!lrc) return
    lrc.init().then(() => setReady(true)).catch(() => {})
    return () => {
      if (mediaTexRef.current != null) lrc.releaseTexture(mediaTexRef.current).catch(() => {})
      if (wmTexRef.current != null) lrc.releaseTexture(wmTexRef.current).catch(() => {})
    }
  }, [])

  // ── 加载水印纹理 ──
  const loadWmTexture = useCallback(async (wmStyle: string) => {
    const lrc = getLRC(); if (!lrc) return
    // 加载水印图片
    try {
      const { WM_SRC } = await import('../shared/watermarkAssets')
      const srcUrl = WM_SRC[wmStyle]?.image
      if (!srcUrl) return
      const img = new Image()
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = srcUrl })
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      const idata = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
      wmTexRef.current = await lrc.loadTexture(new Uint8Array(idata.data.buffer), c.width, c.height)
    } catch { /* ignore */ }
  }, [])

  // ── 加载并渲染图片 ──
  useEffect(() => {
    const lrc = getLRC()
    if (!lrc || !ready || !src || src === loadedSrcRef.current) return
    loadedSrcRef.current = src

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = async () => {
      const iw = naturalWidth || img.naturalWidth
      const ih = naturalHeight || img.naturalHeight
      const c = document.createElement('canvas'); c.width = iw; c.height = ih
      c.getContext('2d')!.drawImage(img, 0, 0, iw, ih)
      const idata = c.getContext('2d')!.getImageData(0, 0, iw, ih)
      const rgba = new Uint8Array(idata.data.buffer)

      try {
        if (mediaTexRef.current != null) await lrc!.updateTexture(mediaTexRef.current, rgba)
        else mediaTexRef.current = await lrc!.loadTexture(rgba, iw, ih)

        onLoad?.(iw, ih)
        await renderFrame()
      } catch { /* ignore */ }
    }
    img.src = src
  }, [src, ready, naturalWidth, naturalHeight])

  // ── 水印变化时加载 ──
  useEffect(() => {
    if (watermark?.enabled && watermark.style) {
      loadWmTexture(watermark.style)
    }
  }, [watermark?.enabled, watermark?.style, loadWmTexture])

  // ── 水印 layout 变化时重新渲染 ──
  useEffect(() => { renderFrame() }, [watermark?.layout, watermark?.enabled])

  // ── renderFrame ──
  const renderFrame = useCallback(async () => {
    const lrc = getLRC()
    const cvs = canvasRef.current
    if (!lrc || !cvs || mediaTexRef.current == null) return

    const pw = cvs.parentElement?.clientWidth ?? cvs.width
    const ph = cvs.parentElement?.clientHeight ?? cvs.height
    if (pw <= 0 || ph <= 0) return

    const iw = naturalWidth || cvs.width
    const ih = naturalHeight || cvs.height
    // 计算居中 contain 布局
    const ar = iw / (ih || 1)
    let dw = pw, dh = pw / ar
    if (dh > ph) { dh = ph; dw = ph * ar }
    const dx = (pw - dw) / 2
    const dy = (ph - dh) / 2

    const layers: RenderLayer[] = [{
      textureId: mediaTexRef.current,
      dstX: dx / pw, dstY: dy / ph, dstW: dw / pw, dstH: dh / ph,
      srcX: 0, srcY: 0, srcW: 1, srcH: 1,
      opacity: 1, zIndex: 0,
    }]

    // 水印层
    if (watermark?.enabled && watermark.layout && wmTexRef.current != null) {
      const wl = watermark.layout
      layers.push({
        textureId: wmTexRef.current,
        dstX: wl.x / dw, dstY: wl.y / dh,  // 水印坐标相对于图片内容区域
        dstW: wl.width / dw, dstH: wl.height / dh,
        srcX: 0, srcY: 0, srcW: 1, srcH: 1,
        opacity: 0.85, zIndex: 10,
      })
    }

    try {
      const result = await lrc.renderFrame(pw, ph, layers)
      cvs.width = pw; cvs.height = ph
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)), pw, ph),
        0, 0,
      )
    } catch { /* ignore */ }
  }, [canvasRef, naturalWidth, naturalHeight, watermark])

  return <canvas ref={canvasRef as React.RefObject<HTMLCanvasElement>} className={className} />
}
