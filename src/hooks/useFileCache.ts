import { useCallback, useEffect, useRef, useState } from 'react'

interface FileCache {
  /** 缩略图 URL（本地 file:// 路径或 null） */
  thumbnailUrl: string | null
  /** 完整文件缓存路径 */
  cacheFilePath: string | null
  /** 是否正在下载/生成中 */
  isLoading: boolean
  /** 是否缓存失败 */
  hasError: boolean
  /** 重试 */
  retry: () => void
}

/**
 * 根据 sourceUrl 获取本地缓存文件和缩略图。
 *
 * 与 MediaCard 一致的缓存逻辑：
 * - HTTP URL → 调用 cacheFile 下载到本地、生成缩略图
 * - 本地路径 → 直接返回，无需缓存
 *
 * @param sourceUrl 文件 URL
 * @param enabled 是否允许触发缓存（设为 false 可延迟缓存，适合列表滚动懒加载）
 */
export function useFileCache(sourceUrl: string | null, enabled = true): FileCache {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [cacheFilePath, setCacheFilePath] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setThumbnailUrl(null)
    setCacheFilePath(null)
    setHasError(false)

    if (!sourceUrl || !enabled) {
      setIsLoading(false)
      return
    }

    // 非 HTTP 路径直接使用，无需缓存
    if (!sourceUrl.startsWith('http')) {
      setCacheFilePath(sourceUrl)
      setIsLoading(false)
      return
    }

    // HTTP 路径：触发缓存
    setIsLoading(true)

    window.luna
      .cacheFile(sourceUrl)
      .catch(() => {
        setHasError(true)
        setIsLoading(false)
      })

    const unsubscribe = window.luna.onThumbnailReady(({ fileId, cacheFilePath: cachedPath, thumbnailUrl: thumbUrl }) => {
      if (fileId !== sourceUrl) return
      if (cachedPath) setCacheFilePath(cachedPath)
      if (thumbUrl) setThumbnailUrl(thumbUrl)
      if (cachedPath || thumbUrl) {
        setHasError(false)
        setIsLoading(false)
      } else {
        // cacheFilePath=null 表示缓存失败
        setHasError(true)
        setIsLoading(false)
      }
    })

    cleanupRef.current = unsubscribe

    return () => {
      unsubscribe()
      cleanupRef.current = null
    }
  }, [sourceUrl, enabled, retryKey])

  const retry = useCallback(() => {
    setRetryKey((k) => k + 1)
  }, [])

  return { thumbnailUrl, cacheFilePath, isLoading, hasError, retry }
}
