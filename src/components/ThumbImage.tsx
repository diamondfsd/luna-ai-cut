import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'

import { useFileCache } from '../hooks/useFileCache'

/** 缩略图加载前的占位 SVG（图片图标） */
const PLACEHOLDER_DATA_URL =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect width="400" height="300" fill="%23f4f2ee"/%3E%3Cpath d="M168 116h64a16 16 0 0 1 16 16v36a16 16 0 0 1-16 16h-64a16 16 0 0 1-16-16v-36a16 16 0 0 1 16-16Z" fill="none" stroke="%23948f87" stroke-width="10"/%3E%3Ccircle cx="180" cy="142" r="10" fill="%23948f87"/%3E%3Cpath d="m164 174 34-32 20 19 16-14 18 27" fill="none" stroke="%23948f87" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/%3E%3C/svg%3E'

const MAX_AUTO_RETRIES = 2

interface ThumbImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** 本地文件路径，组件内部通过 useFileCache 懒加载并生成缩略图 */
  src: string
}

/**
 * 通用缩略图组件
 *
 * 接收本地文件路径作为 `src`，内部通过 `useFileCache` 懒加载并生成缩略图。
 * 缩略图加载前会显示一个占位图标，加载完成后切换为真实缩略图。
 * 支持所有标准 `<img>` 属性（className、style、alt、draggable 等）。
 *
 * 用法：
 * ```tsx
 * <ThumbImage src="/path/to/photo.jpg" className="thumb-img" alt="" draggable={false} />
 * ```
 */
export function ThumbImage({ src, onError, onLoad, ...imgProps }: ThumbImageProps) {
  const [visible, setVisible] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const retryCountRef = useRef(0)
  const { thumbnailUrl, hasError, retry } = useFileCache(src, visible)

  useEffect(() => {
    retryCountRef.current = 0
  }, [src])

  const retryOnce = useCallback(() => {
    if (retryCountRef.current >= MAX_AUTO_RETRIES) return false
    retryCountRef.current += 1
    retry()
    return true
  }, [retry])

  useEffect(() => {
    if (!visible || !hasError || retryCountRef.current >= MAX_AUTO_RETRIES) return
    const delay = 350 * (retryCountRef.current + 1)
    const timer = window.setTimeout(retryOnce, delay)
    return () => window.clearTimeout(timer)
  }, [hasError, retryOnce, visible])

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
      src={thumbnailUrl ?? PLACEHOLDER_DATA_URL}
      onError={(event) => {
        onError?.(event)
        if (thumbnailUrl) retryOnce()
      }}
      onLoad={(event) => {
        onLoad?.(event)
        if (thumbnailUrl) retryCountRef.current = 0
      }}
      {...imgProps}
    />
  )
}
