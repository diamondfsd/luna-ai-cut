/**
 * Live Photo 检测工具（带全局缓存）
 *
 * 用法：
 *   const live = useIsLivePhoto(fileUrl)              // 立即检测
 *   const live = useLivePhotoWhenVisible(fileUrl, ref) // 可见后检测
 *   getIsLivePhoto(fileUrl).then(v => ...)             // 非 hook 场景
 */
import { useEffect, useState } from 'react'

// ── 全局缓存（模块级 Map，持久化） ──
const cache = new Map<string, boolean>()

function normalizeLivePhotoPath(fileUrl: string): string {
  try {
    const parsed = new URL(fileUrl)
    if (parsed.protocol === 'file:') {
      const decoded = decodeURIComponent(parsed.pathname)
      // Windows: file:///C:/Users/... → URL.pathname 返回 /C:/Users/...（多一个前置 /）
      // 去掉这个前置 /，否则 fs.open 在主进程可能失败
      if (/^\/[a-zA-Z]:[/\\]/.test(decoded)) return decoded.slice(1)
      return decoded
    }
  } catch {
    // 保持原始路径
  }
  return fileUrl
}

/** 检测并缓存 */
export function getIsLivePhoto(fileUrl: string): Promise<boolean> {
  const cached = cache.get(fileUrl)
  if (cached !== undefined) return Promise.resolve(cached)
  return window.luna.workspace.isLivePhoto(normalizeLivePhotoPath(fileUrl)).then((v: boolean) => {
    cache.set(fileUrl, v)
    return v
  }).catch(() => {
    cache.set(fileUrl, false)
    return false
  })
}

/** React hook：取缓存值或触发检测，返回当前结果 */
export function useIsLivePhoto(fileUrl: string | undefined | null): boolean {
  const [v, setV] = useState(() => (fileUrl != null && cache.get(fileUrl)) ?? false)

  useEffect(() => {
    if (fileUrl == null) { setV(false); return }
    const cached = cache.get(fileUrl)
    if (cached !== undefined) { setV(cached); return }
    getIsLivePhoto(fileUrl).then(setV)
  }, [fileUrl])

  return v
}

/**
 * React hook：元素可见后才检测 Live Photo，返回当前状态。
 * 适用于列表场景（缩略图条、媒体卡片），避免不可见元素触发 IPC。
 * @param fileUrl 文件 URL
 * @param ref React ref 指向要观察的 DOM 元素
 * @param rootMargin IntersectionObserver rootMargin（默认 200px）
 */
export function useLivePhotoWhenVisible(
  fileUrl: string | null | undefined,
  ref: React.RefObject<Element | null>,
  rootMargin = '200px',
): boolean {
  const [v, setV] = useState(() => (fileUrl != null && cache.get(fileUrl)) ?? false)

  useEffect(() => {
    if (fileUrl == null) { setV(false); return }
    const cached = cache.get(fileUrl)
    if (cached !== undefined) { setV(cached); return }

    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          obs.disconnect()
          getIsLivePhoto(fileUrl).then(setV)
        }
      },
      { rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [fileUrl, ref, rootMargin])

  return v
}
