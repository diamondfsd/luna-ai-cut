import { useEffect, useRef, useState } from 'react'

import { buildBorderLayer } from './buildBorderLayer'
import { findFramePreset, framePresetDefaultSettings, FRAME_PRESETS } from './borderPresets'
import type { CompositionInput } from '../../shared/types'
import { compositionSourceType, renderWebGpuCompositionToDataUrl } from '../../lib/webgpu/static-image-export'
import { DEFAULT_PIPELINE } from '../shared/editPipeline'
import { pipelineColorToRenderColor } from '../shared/renderLayerPipeline'

const THUMB_CACHE = new Map<string, string>()

async function renderBorderThumb(
  sourcePath: string,
  presetId: string,
): Promise<string> {
  const cacheKey = `border-thumb::${presetId}::${sourcePath}`
  const cached = THUMB_CACHE.get(cacheKey)
  if (cached) return cached

  const preset = findFramePreset(presetId)
  if (!preset) throw new Error(`预设 ${presetId} 未找到`)

  const colors = fallbackPresetColors(presetId)
  const borderLayers = buildBorderLayer({
    canvasWidth: 220,
    canvasHeight: 138,
    border: {
      ...DEFAULT_PIPELINE.border,
      enabled: true,
      presetId,
      backgroundColor: colors.backgroundColor,
      textColor: colors.textColor,
      ...framePresetDefaultSettings(presetId),
      title: '',
    },
    metadata: null,
    mediaPath: sourcePath,
    mediaLayerStyle: { color: pipelineColorToRenderColor(DEFAULT_PIPELINE.color) },
  })

  const composition: CompositionInput = {
    canvas: { width: 220, height: 138 },
    layers: [
      {
        source: { path: sourcePath, sourceType: compositionSourceType(sourcePath), key: `border:${sourcePath}` },
        rect: { x: 0, y: 0, w: 1, h: 1 },
        fit: 'cover',
        opacity: 1,
        zIndex: 0,
      },
      ...borderLayers.map((l) => ({
        layerType: l.layerType,
        source: { path: l.filePath, sourceType: compositionSourceType(l.filePath), key: `border:${l.filePath}` },
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

  const url = await renderWebGpuCompositionToDataUrl({ composition, quality: 85 })
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
  /** 父组件传来的源文件路径（用于生成 WebGPU 边框缩略图） */
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

  // 源图就绪 → 调用 WebGPU 渲染带边框的缩略图
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
