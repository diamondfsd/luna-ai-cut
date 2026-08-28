import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

import { useFileCache } from '../hooks/useFileCache'

/** 缩略图加载前的占位 SVG（图片图标） */
const PLACEHOLDER_DATA_URL =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect width="400" height="300" fill="%23f4f2ee"/%3E%3Cpath d="M168 116h64a16 16 0 0 1 16 16v36a16 16 0 0 1-16 16h-64a16 16 0 0 1-16-16v-36a16 16 0 0 1 16-16Z" fill="none" stroke="%23948f87" stroke-width="10"/%3E%3Ccircle cx="180" cy="142" r="10" fill="%23948f87"/%3E%3Cpath d="m164 174 34-32 20 19 16-14 18 27" fill="none" stroke="%23948f87" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/%3E%3C/svg%3E'

const MAX_AUTO_RETRIES = 2

interface ThumbImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** 本地文件路径，组件内部通过 useFileCache 懒加载并生成缩略图 */
  src: string
  /** 相机提供的低分辨率代理视频，例如 Luna 的 LRV 或 DJI 的 LRF */
  previewSrc?: string | null
  /** 相机清单提供的独立缩略图，例如 DJI 的 .scr/.thm */
  thumbnailSrc?: string | null
  /** 距离最近滚动容器可视区域多远时开始加载，默认 300px */
  preloadMargin?: number
  /** 仅向滚动方向下方提前加载；设置后覆盖 preloadMargin 的全方向边距 */
  preloadBottom?: number
  /** 自动重试后仍无法加载时显示的内容；未提供时继续显示默认占位图 */
  unavailableFallback?: ReactNode
  /** 自动重试后仍无法加载时触发 */
  onUnavailable?: (src: string) => void
  /** 本地缓存文件准备好时触发 */
  onCacheReady?: (cacheFilePath: string) => void
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
export function ThumbImage({ src, previewSrc, thumbnailSrc, preloadMargin = 300, preloadBottom, unavailableFallback, onUnavailable, onCacheReady, onError, onLoad, ...imgProps }: ThumbImageProps) {
  const embeddedImage = src.startsWith('data:image/')
  const [visible, setVisible] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [remoteThumbnail, setRemoteThumbnail] = useState<string | null>(thumbnailSrc ?? null)
  const [remoteThumbnailFailed, setRemoteThumbnailFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const retryCountRef = useRef(0)
  useEffect(() => {
    setRemoteThumbnail(thumbnailSrc ?? null)
    setRemoteThumbnailFailed(false)
  }, [thumbnailSrc])

  const useRemoteThumbnail = Boolean(remoteThumbnail) && !remoteThumbnailFailed
  const { thumbnailUrl, cacheFilePath, hasError, retry } = useFileCache(src, visible && !embeddedImage && !useRemoteThumbnail, previewSrc)

  useEffect(() => {
    if (cacheFilePath) onCacheReady?.(cacheFilePath)
  }, [cacheFilePath, onCacheReady])

  useEffect(() => {
    retryCountRef.current = 0
    setUnavailable(false)
  }, [src])

  const retryOnce = useCallback(() => {
    if (retryCountRef.current >= MAX_AUTO_RETRIES) return false
    retryCountRef.current += 1
    retry()
    return true
  }, [retry])

  useEffect(() => {
    if (!visible || !hasError) return
    if (unavailable) return
    if (retryCountRef.current >= MAX_AUTO_RETRIES) {
      setUnavailable(true)
      onUnavailable?.(src)
      return
    }
    const delay = 350 * (retryCountRef.current + 1)
    const timer = window.setTimeout(retryOnce, delay)
    return () => window.clearTimeout(timer)
  }, [hasError, onUnavailable, retryOnce, src, unavailable, visible])

  // 以内层滚动区域为观察根，确保嵌套页面也能在进入可视区前预取。
  useEffect(() => {
    if (visible) return
    const el = imgRef.current
    if (!el) return
    let scrollRoot = el.parentElement
    while (scrollRoot && scrollRoot !== document.body) {
      const style = window.getComputedStyle(scrollRoot)
      if (/(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) break
      scrollRoot = scrollRoot.parentElement
    }
    if (scrollRoot === document.body) scrollRoot = null

    const rootRect = scrollRoot?.getBoundingClientRect() ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
    }
    const rect = el.getBoundingClientRect()
    const topMargin = preloadBottom == null ? preloadMargin : 0
    const rightMargin = preloadBottom == null ? preloadMargin : 0
    const bottomMargin = preloadBottom ?? preloadMargin
    const leftMargin = preloadBottom == null ? preloadMargin : 0
    if (rect.width > 0 && rect.height > 0
      && rect.bottom >= rootRect.top - topMargin && rect.top <= rootRect.bottom + bottomMargin
      && rect.right >= rootRect.left - leftMargin && rect.left <= rootRect.right + rightMargin) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { root: scrollRoot, rootMargin: `${topMargin}px ${rightMargin}px ${bottomMargin}px ${leftMargin}px` },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [preloadBottom, preloadMargin, visible])

  return unavailable && unavailableFallback ? unavailableFallback : (
    <img
      ref={imgRef}
      src={embeddedImage ? src : remoteThumbnail ?? thumbnailUrl ?? PLACEHOLDER_DATA_URL}
      onError={(event) => {
        onError?.(event)
        if (remoteThumbnail && !remoteThumbnailFailed) {
          if (/\.scr(?:$|[?#])/i.test(remoteThumbnail)) {
            setRemoteThumbnail(remoteThumbnail.replace(/\.scr(?=$|[?#])/i, '.thm'))
          } else {
            setRemoteThumbnail(null)
            setRemoteThumbnailFailed(true)
          }
          return
        }
        if (thumbnailUrl) retryOnce()
      }}
      onLoad={(event) => {
        onLoad?.(event)
        if (thumbnailUrl) {
          retryCountRef.current = 0
          setUnavailable(false)
        }
      }}
      {...imgProps}
    />
  )
}
