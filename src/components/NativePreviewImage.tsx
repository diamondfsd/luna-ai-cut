import { useEffect, useRef, useCallback, useState } from 'react'

interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
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
  src: string
  naturalWidth?: number
  naturalHeight?: number
  className?: string
  onLoad?: (w: number, h: number) => void
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
}

export function NativePreviewImage({ src, naturalWidth, naturalHeight, className, onLoad, canvasRef: extCanvasRef }: Props) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extCanvasRef ?? internalRef
  const mediaTexRef = useRef<number | null>(null)
  const loadedSrcRef = useRef('')
  const [ready, setReady] = useState(false)

  // ── init Native Core ──
  useEffect(() => {
    const lrc = getLRC()
    if (!lrc) return
    lrc.init().then(() => setReady(true)).catch(() => {})
    return () => {
      if (mediaTexRef.current != null) lrc.releaseTexture(mediaTexRef.current).catch(() => {})
    }
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

    try {
      const result = await lrc.renderFrame(pw, ph, layers)
      cvs.width = pw; cvs.height = ph
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)), pw, ph),
        0, 0,
      )
    } catch { /* ignore */ }
  }, [canvasRef, naturalWidth, naturalHeight])

  return <canvas ref={canvasRef as React.RefObject<HTMLCanvasElement>} className={className} />
}
