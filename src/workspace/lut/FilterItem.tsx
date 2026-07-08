import { useEffect, useRef, useState } from 'react'

import { useFileCache } from '../../hooks/useFileCache'
import type { CompositionInput } from '../../shared/types'

interface FilterItemProps {
  filePath: string
  name?: string
  active?: boolean
  onClick?: () => void
  /** 父组件传来的源文件路径（子组件自行通过 useFileCache 加载缩略图） */
  mediaPath: string | null
  /** 隐藏底部的名称文本 */
  hideName?: boolean
  /** LUT 强度 0-100，默认 100 */
  intensity?: number
}

const THUMB_CACHE = new Map<string, string>()

function getLrc(): any {
  return (window as unknown as { lunaRenderCore?: any }).lunaRenderCore ?? null
}

/** 调用 Rust 渲染一帧带 LUT 的缩略图，返回 data URL */
async function renderFilterThumb(
  sourcePath: string,
  lutPath: string,
  intensity: number,
): Promise<string> {
  const cacheKey = `${lutPath}::${sourcePath}::${intensity}`
  const cached = THUMB_CACHE.get(cacheKey)
  if (cached) return cached

  const lrc = getLrc()
  if (!lrc) throw new Error('渲染引擎未初始化')

  const composition: CompositionInput = {
    version: 1,
    canvas: { width: 220, height: 138 },
    layers: [{
      source: { path: sourcePath },
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fit: 'cover',
      opacity: 1,
      zIndex: 0,
      lutId: lutPath,
      lutIntensity: intensity,
    }],
  }

  const result = await lrc.renderCompositionFrame(composition, 0, 220)

  // 将 Rust 返回的 RGBA buffer 转为 data URL
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

export function FilterItem({ filePath, name = '', active, onClick, mediaPath, hideName, intensity = 100 }: FilterItemProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)
  const [visible, setVisible] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const thumbnailRef = useRef<string | null>(null)

  // 用 useFileCache 统一处理图片/视频缩略图
  const { cacheFilePath } = useFileCache(mediaPath, visible)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // IntersectionObserver：进入视口才加载
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    if (visible) return

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

  // 源缩略图就绪 → 调用 Rust 渲染带 LUT 的缩略图
  useEffect(() => {
    const sourcePath = cacheFilePath || thumbnailRef.current
    if (!sourcePath || !filePath) {
      setThumbUrl(null)
      return
    }

    let cancelled = false
    setLoading(true)

    renderFilterThumb(sourcePath, filePath, intensity).then((url) => {
      if (!cancelled && mountedRef.current) {
        setThumbUrl(url)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled && mountedRef.current) setLoading(false)
    })

    return () => { cancelled = true }
  }, [cacheFilePath, filePath, intensity])

  return (
    <article
      ref={cardRef}
      className={`filter-card ${active ? 'selected' : ''}`}
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
