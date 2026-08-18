import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useFileCache } from '../../hooks/useFileCache'
import type { CompositionInput } from '../../shared/types'
import { compositionSourceType, renderWebGpuCompositionToDataUrl } from '../../lib/webgpu/static-image-export'
import { IconButton, Tooltip } from '../../ui'

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
  editing?: boolean
  deleting?: boolean
  onDelete?: () => void
}

const THUMB_CACHE = new Map<string, string>()

/** 使用 WebGPU 渲染一帧带 LUT 的缩略图，返回 data URL。 */
async function renderFilterThumb(
  sourcePath: string,
  lutPath: string,
  intensity: number,
): Promise<string> {
  const cacheKey = `${lutPath}::${sourcePath}::${intensity}`
  const cached = THUMB_CACHE.get(cacheKey)
  if (cached) return cached

  const composition: CompositionInput = {
    version: 1,
    canvas: { width: 220, height: 138 },
    layers: [{
      source: { path: sourcePath, sourceType: compositionSourceType(sourcePath), key: `filter:${sourcePath}` },
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fit: 'cover',
      opacity: 1,
      zIndex: 0,
      lutId: lutPath,
      lutIntensity: intensity,
    }],
  }

  const url = await renderWebGpuCompositionToDataUrl({ composition, quality: 85 })
  THUMB_CACHE.set(cacheKey, url)
  return url
}

export function FilterItem({
  filePath,
  name = '',
  active,
  onClick,
  mediaPath,
  hideName,
  intensity = 30,
  editing = false,
  deleting = false,
  onDelete,
}: FilterItemProps) {
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

    // 源缩略图就绪 → 调用 WebGPU 渲染带 LUT 的缩略图
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
      className={`filter-card${active ? ' selected' : ''}${editing ? ' editing' : ''}`}
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
      {editing && onDelete && (
        <Tooltip content={deleting ? '正在删除' : `删除${name}`}>
          <IconButton
            variant="ghost"
            size="mini"
            className="filter-card-delete"
            icon={<Trash2 size={14} />}
            aria-label={`删除${name}`}
            disabled={deleting}
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
          />
        </Tooltip>
      )}
      {active && !hideName && <div className="check">✓</div>}
      {!hideName && <div className="name">{name}</div>}
    </article>
  )
}
