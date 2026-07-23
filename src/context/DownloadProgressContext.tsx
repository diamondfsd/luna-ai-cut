import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { DownloadProgress } from '../shared/types'

interface DownloadProgressContextValue {
  downloadProgress: Map<string, DownloadProgress>
  setDownloadProgress: React.Dispatch<React.SetStateAction<Map<string, DownloadProgress>>>
}

const Ctx = createContext<DownloadProgressContextValue | null>(null)

export function DownloadProgressProvider({ children }: { children: ReactNode }) {
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map())

  useEffect(() => {
    return window.luna.onDownloadProgress((progress) => {
      setDownloadProgress((current) => {
        const next = new Map(current).set(progress.fileName, progress)
        return next
      })
    })
  }, [])

  return (
    <Ctx.Provider value={{ downloadProgress, setDownloadProgress }}>
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
