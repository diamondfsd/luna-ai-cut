import { useEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from 'react'

import { useFileCache } from '../hooks/useFileCache'
import { filePathToPreviewUrl } from '../lib/fileUtils'

interface ThumbImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** 本地文件路径，组件内部通过 useFileCache 懒加载并生成缩略图 */
  src: string
}

/**
 * 通用缩略图组件
 *
 * 接收本地文件路径作为 `src`，内部通过 `useFileCache` 懒加载并生成缩略图。
 * 支持所有标准 `<img>` 属性（className、style、alt、draggable 等）。
 *
 * 用法：
 * ```tsx
 * <ThumbImage src="/path/to/photo.jpg" className="thumb-img" alt="" draggable={false} />
 * ```
 */
export function ThumbImage({ src, ...imgProps }: ThumbImageProps) {
  const [visible, setVisible] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const sourceUrl = useMemo(() => filePathToPreviewUrl(src) ?? src, [src])
  const { thumbnailUrl } = useFileCache(sourceUrl, visible)

  // IntersectionObserver 懒加载：进入视口才触发 useFileCache
  useEffect(() => {
    if (visible) return
    const el = imgRef.current
    if (!el) return
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

  return (
    <img
      ref={imgRef}
      src={thumbnailUrl ?? undefined}
      {...imgProps}
    />
  )
}
