import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * 纹理层 — 使用已加载的 textureId 进行渲染
 */
export interface LrcTextureLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

/**
 * 静态层 — 传入图片路径，LrcRender 内部自动加载为纹理并合成渲染。
 * dstX/dstY/dstW/dstH 均为归一化坐标 [0, 1]
 */
export interface LrcStaticLayer {
  imagePath: string
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

interface LrcRenderProps {
  /** 静态层列表，按 zIndex 升序叠放 */
  layers: LrcStaticLayer[]
  /** 可选外部 canvas ref */
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

// ── 工具：加载图片 → RGBA ──

async function loadImageAsRGBA(imagePath: string): Promise<{
  rgba: Uint8Array
  width: number
  height: number
}> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`图片加载失败: ${imagePath}`))
    img.src = imagePath
  })
  const w = img.naturalWidth
  const h = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  const idata = c.getContext('2d')!.getImageData(0, 0, w, h)
  return { rgba: new Uint8Array(idata.data.buffer), width: w, height: h }
}

// ── LrcRender ──

export function LrcRender({ layers, canvasRef: extRef, className, onError, onReady }: LrcRenderProps) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const texMapRef = useRef<Map<string, number>>(new Map())
  const loadedKeyRef = useRef('')
  const destroyRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  // ── 初始化 lunaRenderCore ──
  useEffect(() => {
    const lrc = getLRC()
    if (!lrc) {
      const msg = 'lunaRenderCore 未加载'
      setFatalError(msg)
      onError?.(msg)
      return
    }

    destroyRef.current = false

    lrc.init()
      .then(() => {
        if (destroyRef.current) return
        setReady(true)
        onReady?.()
      })
      .catch((e: Error) => {
        const msg = `渲染引擎初始化失败: ${e.message}`
        if (destroyRef.current) return
        setFatalError(msg)
        onError?.(msg)
      })

    return () => {
      destroyRef.current = true
      const lrc2 = getLRC()
      if (!lrc2) return
      for (const [, texId] of texMapRef.current) {
        lrc2.releaseTexture(texId).catch(() => {})
      }
      texMapRef.current.clear()
      lrc2.destroy().catch(() => {})
    }
  }, [])

  // ── 渲染帧 ──
  const render = useCallback(async () => {
    const lrc = getLRC()
    const cvs = canvasRef.current
    if (!lrc || !cvs || texMapRef.current.size === 0) return

    const pw = cvs.parentElement?.clientWidth ?? cvs.width
    const ph = cvs.parentElement?.clientHeight ?? cvs.height
    if (pw <= 0 || ph <= 0) return

    // 按 zIndex 升序排列构建纹理层
    const sorted = [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    const renderLayers: LrcTextureLayer[] = []

    for (const layer of sorted) {
      const texId = texMapRef.current.get(layer.imagePath)
      if (texId == null) continue
      renderLayers.push({
        textureId: texId,
        dstX: layer.dstX, dstY: layer.dstY,
        dstW: layer.dstW, dstH: layer.dstH,
        srcX: layer.srcX ?? 0, srcY: layer.srcY ?? 0,
        srcW: layer.srcW ?? 1, srcH: layer.srcH ?? 1,
        opacity: layer.opacity ?? 1,
        zIndex: layer.zIndex ?? 0,
      })
    }

    if (renderLayers.length === 0) return

    try {
      const result = await lrc.renderFrame(pw, ph, renderLayers)
      cvs.width = pw
      cvs.height = ph
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result), pw, ph),
        0, 0,
      )
    } catch {
      // 渲染错误静默忽略
    }
  }, [layers])

  // ── 加载纹理并渲染 ──
  useEffect(() => {
    if (!ready) return

    const keys = layers.map(l => l.imagePath)
    const key = keys.join('|')
    if (key === loadedKeyRef.current) return
    loadedKeyRef.current = key

    const lrc = getLRC()
    if (!lrc) return

    // 清理已经不用的纹理
    const used = new Set(keys)
    for (const [path, texId] of texMapRef.current) {
      if (!used.has(path)) {
        lrc.releaseTexture(texId).catch(() => {})
        texMapRef.current.delete(path)
      }
    }

    // 加载新纹理
    const loadPromises = layers.map(async (layer) => {
      if (texMapRef.current.has(layer.imagePath)) return
      try {
        const { rgba, width, height } = await loadImageAsRGBA(layer.imagePath)
        const texId = await lrc.loadTexture(rgba, width, height)
        texMapRef.current.set(layer.imagePath, texId)
      } catch (e) {
        console.error('[LrcRender] 纹理加载失败:', layer.imagePath, e)
      }
    })

    Promise.all(loadPromises).then(() => render())
  }, [layers, ready, render])

  if (fatalError) {
    return (
      <div
        className={className}
        style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <p style={{ color: 'var(--red, #e53e3e)', fontSize: 14, textAlign: 'center', padding: 16 }}>
          {fatalError}
        </p>
      </div>
    )
  }

  return (
    <canvas ref={canvasRef as React.Ref<HTMLCanvasElement>} className={className} />
  )
}
