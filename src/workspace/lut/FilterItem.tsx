import { useEffect, useRef, useState } from 'react'

import { useFileCache } from '../../hooks/useFileCache'
import { LUT_BASE } from './builtinLuts'
import { getLutCubeData, applyLutToImageData } from './LutCubeParser'

interface FilterItemProps {
  filePath: string
  name: string
  active: boolean
  loading?: boolean
  onClick: () => void
  /** 父组件传来的源文件路径（子组件自行通过 useFileCache 加载缩略图） */
  mediaPath: string | null
}

/** 缩略图缓存 <cacheKey → dataURL> */
const thumbCache = new Map<string, string>()

/** 将 sourceUrl 渲染到 canvas 并应用 LUT，返回 data URL */
async function renderFilterThumb(
  sourceUrl: string,
  filePath: string,
): Promise<string> {
  const cacheKey = `${filePath}::${sourceUrl}`
  const cached = thumbCache.get(cacheKey)
  if (cached) return cached

  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('加载缩略图失败'))
    img.src = sourceUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = 220
  canvas.height = 138
  const ctx = canvas.getContext('2d')!
  const scale = Math.max(canvas.width / img.width, canvas.height / img.height)
  const sw = img.width * scale
  const sh = img.height * scale
  ctx.drawImage(img, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh)

  const sourceData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const cubeUrl = `${LUT_BASE}/${filePath}`
  const lut = await getLutCubeData(cubeUrl)
  const resultUrl = applyLutToImageData(sourceData, lut)
  thumbCache.set(cacheKey, resultUrl)
  return resultUrl
}

export function FilterItem({ filePath, name, active, loading, onClick, mediaPath }: FilterItemProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const [visible, setVisible] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // 用现有 useFileCache 统一处理图片/视频缩略图
  const { thumbnailUrl } = useFileCache(mediaPath, visible)

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

  // 缩略图就绪 → 渲染滤镜效果
  useEffect(() => {
    if (!thumbnailUrl || !filePath) {
      setThumbUrl(null)
      return
    }

    let cancelled = false
    const cacheKey = `${filePath}::${thumbnailUrl}`
    const cached = thumbCache.get(cacheKey)

    if (cached) {
      setThumbUrl(cached)
      return
    }

    renderFilterThumb(thumbnailUrl, filePath).then((url) => {
      if (!cancelled && mountedRef.current) setThumbUrl(url)
    }).catch(() => {
      // 缩略图生成失败，保持空白
    })

    return () => { cancelled = true }
  }, [thumbnailUrl, filePath])

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
        ) : null}
      </div>
      {active && <div className="check">✓</div>}
      <div className="name">{name}</div>
    </article>
  )
}
