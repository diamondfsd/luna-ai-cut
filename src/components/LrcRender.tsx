import { useEffect, useRef, useCallback, useState } from 'react'

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
  /** 每次合成渲染完成后触发 */
  onRender?: () => void
}

// ── 工具 ──

function isStatic(l: LrcLayer): l is LrcStaticLayer {
  return 'imagePath' in l
}
function isVideo(l: LrcLayer): l is LrcVideoLayer {
  return 'videoPath' in l
}

/** 将 LrcLayer 转为 renderPreview 的层输入 */
function toPreviewLayer(
  l: LrcLayer,
  videoTime: number,
): any {
  return {
    filePath: isStatic(l) ? l.imagePath : l.videoPath,
    isVideo: isVideo(l),
    videoTime,
    dstX: l.dstX, dstY: l.dstY, dstW: l.dstW, dstH: l.dstH,
    srcX: l.srcX ?? 0, srcY: l.srcY ?? 0,
    srcW: l.srcW ?? 1, srcH: l.srcH ?? 1,
    opacity: l.opacity ?? 1,
    zIndex: l.zIndex ?? 0,
  }
}

// ── LrcRender ──

export function LrcRender({ layers, canvasRef: extRef, className, onError, onReady, onRender }: LrcRenderProps) {
  const internalRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extRef ?? internalRef
  const destroyRef = useRef(false)
  const rafRef = useRef(0)
  const layersRef = useRef<LrcLayer[]>(layers)
  layersRef.current = layers

  const [ready, setReady] = useState(false)

  // ── 视频播放时间追踪 ──
  const videoTimeRef = useRef(0)
  const lastFrameRef = useRef(0)

  // ═══════════════════════════════════════
  //  初始化 lunaRenderCore
  // ═══════════════════════════════════════
  useEffect(() => {
    const lrc = getLRC()
    if (!lrc) {
      const msg = 'lunaRenderCore 未加载'
      onError?.(msg)
      return
    }
    destroyRef.current = false
    lrc.init()
      .then(() => { if (!destroyRef.current) { setReady(true); onReady?.() } })
      .catch((e: Error) => {
        if (destroyRef.current) return
        onError?.(`渲染引擎初始化失败: ${e.message}`)
      })

    return () => {
      destroyRef.current = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ═══════════════════════════════════════
  //  统一渲染：调 renderPreview
  // ═══════════════════════════════════════
  const renderScene = useCallback(async (videoTime: number) => {
    const lrc = getLRC()
    const cvs = canvasRef.current
    if (!lrc || !cvs) return

    const pw = cvs.parentElement?.clientWidth ?? cvs.width
    const ph = cvs.parentElement?.clientHeight ?? cvs.height
    if (pw <= 0 || ph <= 0) return

    const currentLayers = layersRef.current
    if (currentLayers.length === 0) return

    const sorted = [...currentLayers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    const layersInput = sorted.map((l) => {
      if (isVideo(l)) {
        return toPreviewLayer(l, videoTime)
      }
      // contain 适配在 renderPreview 内由 Rust 处理（纹理尺寸已知）
      // 但 dstX/dstY/dstW/dstH 的 contain 计算仍需前端做
      return toPreviewLayer(l, 0)
    })

    try {
      const result = await lrc.renderPreview({
        width: pw,
        height: ph,
        layers: layersInput,
      })
      cvs.width = pw; cvs.height = ph
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result), pw, ph), 0, 0,
      )
      onRender?.()
    } catch { /* 渲染错误静默 */ }
  }, [canvasRef, onRender])

  // ═══════════════════════════════════════
  //  layers 变化 -> 渲染一帧
  // ═══════════════════════════════════════
  useEffect(() => {
    if (!ready) return
    videoTimeRef.current = 0
    lastFrameRef.current = 0
    renderScene(0)
  }, [layers, ready])

  // ═══════════════════════════════════════
  //  RAF 循环（有视频层时）
  // ═══════════════════════════════════════
  useEffect(() => {
    if (!ready || !layers.some(isVideo)) return
    if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)

    function loop(timestamp: number) {
      if (lastFrameRef.current > 0) {
        videoTimeRef.current += (timestamp - lastFrameRef.current) / 1000
      }
      lastFrameRef.current = timestamp
      renderScene(videoTimeRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [layers, ready])

  // ═══════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════
  return <canvas ref={canvasRef as React.Ref<HTMLCanvasElement>} className={className} />
}

/** 获取 lunaRenderCore 实例 */
function getLRC() {
  return (window as any).lunaRenderCore as undefined | {
    init: () => Promise<void>
    renderPreview: (input: any) => Promise<Uint8Array>
  }
}
