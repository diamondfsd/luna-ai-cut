import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DownloadProgress } from '../shared/types'

type DownloadCancelHandler = () => Promise<void>

interface DownloadProgressContextValue {
  downloadProgress: Map<string, DownloadProgress>
  setDownloadProgress: React.Dispatch<React.SetStateAction<Map<string, DownloadProgress>>>
  registerCancelHandler: (handler: DownloadCancelHandler) => () => void
  cancelDownloads: () => Promise<void>
}

const Ctx = createContext<DownloadProgressContextValue | null>(null)

export function DownloadProgressProvider({ children }: { children: ReactNode }) {
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map())
  const cancelHandlerRef = useRef<DownloadCancelHandler | null>(null)

  const registerCancelHandler = useCallback((handler: DownloadCancelHandler) => {
    cancelHandlerRef.current = handler
    return () => {
      if (cancelHandlerRef.current === handler) cancelHandlerRef.current = null
    }
  }, [])

  const cancelDownloads = useCallback(async () => {
    const handler = cancelHandlerRef.current
    if (handler) {
      await handler()
      return
    }
    await window.luna.cancelDownloads()
  }, [])

  useEffect(() => {
    return window.luna.onDownloadProgress((progress) => {
      setDownloadProgress((current) => {
        const next = new Map(current).set(progress.fileName, progress)
        return next
      })
    })
  }, [])

  return (
    <Ctx.Provider value={{ downloadProgress, setDownloadProgress, registerCancelHandler, cancelDownloads }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDownloadProgress(): DownloadProgressContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDownloadProgress must be used inside DownloadProgressProvider')
  return ctx
}

/** 可选读取；不需要下载能力的复用场景允许没有 Provider。 */
export function useOptionalDownloadProgress(): DownloadProgressContextValue | null {
  return useContext(Ctx)
}
