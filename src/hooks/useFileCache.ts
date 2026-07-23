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
 * 同时支持 HTTP 和 file:// 路径：
 * - HTTP → cacheFile 下载到本地 + 生成缩略图
 * - file:// → cacheFile 跳过下载，直接生成本地缩略图
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

    const isHttp = sourceUrl.startsWith('http')

    // file:// 路径：文件已在本地，直接设置路径，但仍需 cacheFile 触发缩略图生成
    if (!isHttp) {
      setCacheFilePath(sourceUrl)
    }

    // 触发缓存（HTTP 下载 + 缩略图生成，或 file:// 缩略图生成）
    setIsLoading(isHttp)
    window.luna
      .cacheFile({ sourceUrl })
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
