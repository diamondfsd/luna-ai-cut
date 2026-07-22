import { useEffect, useRef, useState } from 'react'

import { buildBorderLayer, FRAME_PRESETS } from './buildBorderLayer'
import type { CompositionInput } from '../../shared/types'
import { DEFAULT_PIPELINE } from '../shared/editPipeline'
import { pipelineColorToRenderColor } from '../shared/renderLayerPipeline'

const THUMB_CACHE = new Map<string, string>()

interface BorderThumbnailRenderCore {
  renderCompositionFrame: (
    composition: CompositionInput,
    time: number,
    maxSide?: number,
  ) => Promise<{ width: number; height: number; data: Uint8Array | ArrayBuffer }>
}

function getLrc(): BorderThumbnailRenderCore | null {
  return (window as unknown as { lunaRenderCore?: BorderThumbnailRenderCore }).lunaRenderCore ?? null
}

async function renderBorderThumb(
  sourcePath: string,
  presetId: string,
): Promise<string> {
  const cacheKey = `border-thumb::${presetId}::${sourcePath}`
  const cached = THUMB_CACHE.get(cacheKey)
  if (cached) return cached

  const lrc = getLrc()
  if (!lrc) throw new Error('渲染引擎未初始化')

  const preset = FRAME_PRESETS.find((p) => p.id === presetId)
  if (!preset) throw new Error(`预设 ${presetId} 未找到`)

  const colors = fallbackPresetColors(presetId)
  const borderLayers = buildBorderLayer({
    canvasWidth: 220,
    canvasHeight: 138,
    border: {
      enabled: true,
      presetId,
      frameSize: presetId === 'blurred-photo-card' ? 104 : 100,
      backgroundColor: colors.backgroundColor,
      textColor: colors.textColor,
      opacity: 100,
      showLogo: true,
      showTitle: true,
      showCameraInfo: true,
      showDate: true,
      title: '',
      mediaScale: 100,
      mediaOffsetX: 0,
      mediaOffsetY: 0,
      shadowStrength: 50,
      shadowBlur: presetId === 'blurred-photo-card' ? 20 : 50,
      shadowOffsetY: 0,
    },
    metadata: null,
    mediaPath: sourcePath,
    mediaLayerStyle: { color: pipelineColorToRenderColor(DEFAULT_PIPELINE.color) },
  })

  const composition: CompositionInput = {
    canvas: { width: 220, height: 138 },
    layers: [
      {
        source: { path: sourcePath },
        rect: { x: 0, y: 0, w: 1, h: 1 },
        fit: 'cover',
        opacity: 1,
        zIndex: 0,
      },
      ...borderLayers.map((l) => ({
        layerType: l.layerType,
        source: { path: l.filePath },
        rect: { x: l.dstX, y: l.dstY, w: l.dstW, h: l.dstH },
        fit: l.fit ?? 'cover',
        opacity: l.opacity,
        zIndex: l.zIndex,
        color: l.color,
        transform: l.transform,
        positioning: l.positioning,
        shape: l.shape,
        fillColor: l.fillColor,
        cornerRadius: l.cornerRadius,
        strokeColor: l.strokeColor,
        strokeWidth: l.strokeWidth,
        content: l.content,
        fontSize: l.fontSize,
        fontFamily: l.fontFamily,
        fontFile: l.fontFile,
        fontWeight: l.fontWeight,
        textColor: l.textColor,
        textAlign: l.textAlign,
        verticalAlign: l.verticalAlign,
      })),
    ],
  }

  const result = await lrc.renderCompositionFrame(composition, 0, 220)

  // Convert RGBA buffer → data URL
  const canvas = document.createElement('canvas')
  canvas.width = result.width
  canvas.height = result.height
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(result.width, result.height)
  const data = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data)
  imageData.data.set(data)
  ctx.putImageData(imageData, 0, 0)
  const url = canvas.toDataURL('image/jpeg', 0.85)
  THUMB_CACHE.set(cacheKey, url)
  return url
}

function fallbackPresetColors(presetId: string) {
  const preset = FRAME_PRESETS.find((p) => p.id === presetId)
  const background = preset?.layers?.find((layer) => layer.type === 'shape' && layer.id === 'background')
  const text = preset?.layers?.find((layer) => layer.type === 'text')
  return {
    backgroundColor: background?.type === 'shape' ? background.fill?.color ?? preset?.swatch ?? '#ffffff' : preset?.swatch ?? '#ffffff',
    textColor: text?.type === 'text' ? text.style.color : '#222222',
  }
}

interface BorderItemProps {
  presetId: string
  name?: string
  active?: boolean
  onClick?: () => void
  /** 父组件传来的源文件路径（传给 Rust 渲染带边框的缩略图） */
  mediaPath: string | null
  /** 隐藏底部的名称文本 */
  hideName?: boolean
}

export function BorderItem({ presetId, name = '', active, onClick, mediaPath, hideName }: BorderItemProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [visible, setVisible] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // IntersectionObserver：进入视口才加载
  useEffect(() => {
    const el = cardRef.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  // 源图就绪 → 调用 Rust 渲染带边框的缩略图
  useEffect(() => {
    if (!visible || !mediaPath) return
    let cancelled = false
    setLoading(true)
    renderBorderThumb(mediaPath, presetId)
      .then((url) => {
        if (!cancelled && mountedRef.current) {
          setThumbUrl(url)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setLoading(false)
      })
    return () => { cancelled = true }
  }, [visible, mediaPath, presetId])

  return (
    <article
      ref={cardRef}
      className={`border-card ${active ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="thumb">
        {thumbUrl ? (
          <img src={thumbUrl} alt={name} className="thumb-img" />
        ) : loading ? (
          <div className="thumb-loading" />
        ) : (
          <div className="thumb-placeholder" />
        )}
      </div>
      {active && !hideName && <div className="check">✓</div>}
      {!hideName && <div className="name">{name}</div>}
    </article>
  )
}
