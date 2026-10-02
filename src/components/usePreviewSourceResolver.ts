import { useEffect, useState } from 'react'
import { toast } from '../ui'

export function usePreviewSourceResolver(filePath: string, resolveSource?: (path: string) => Promise<string>) {
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)
  useEffect(() => {
    if (!resolveSource) return
    let disposed = false
    void resolveSource(filePath).then((url) => {
      if (!disposed) setResolved({ path: filePath, url })
    }).catch((error) => {
      if (!disposed) toast.error(error instanceof Error ? error.message : '预览准备失败')
    })
    return () => { disposed = true }
  }, [filePath, resolveSource])
  return resolved?.path === filePath ? resolved.url : null
}
