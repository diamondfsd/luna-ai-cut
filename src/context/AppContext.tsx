/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AppSettings, ConnectionStatus, DownloadProgress, ExportProgress, LunaFile } from '../shared/types'
import { logger } from '../lib/rendererLogger'

interface AppContextValue {
  settings: AppSettings | null
  setSettings: (s: AppSettings | ((prev: AppSettings | null) => AppSettings | null)) => void
  connection: ConnectionStatus | null
  setConnection: (c: ConnectionStatus | null) => void
  downloadProgress: Map<string, DownloadProgress>
  setDownloadProgress: React.Dispatch<React.SetStateAction<Map<string, DownloadProgress>>>
  exportProgress: Map<string, ExportProgress>
  setExportProgress: React.Dispatch<React.SetStateAction<Map<string, ExportProgress>>>
  exportSnapshots: Map<string, LunaFile>
  setExportSnapshots: React.Dispatch<React.SetStateAction<Map<string, LunaFile>>>
  exporting: boolean
  setExporting: (exporting: boolean) => void
  /** 隐藏开发模式 — 在设置页连点 5 次相机地址激活，重启后失效 */
  hiddenDevMode: boolean
  setHiddenDevMode: (v: boolean) => void
}

const AppCtx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map())
  const [exportProgress, setExportProgress] = useState<Map<string, ExportProgress>>(new Map())
  const [exportSnapshots, setExportSnapshots] = useState<Map<string, LunaFile>>(new Map())
  const [exporting, setExporting] = useState(false)
  const [hiddenDevMode, setHiddenDevMode] = useState(false)

  const applyExportProgress = useCallback((progress: ExportProgress): void => {
    setExportProgress((current) => {
      const key = progress.exportId ?? progress.fileName
      const nextProgress = { ...current.get(key), ...progress }
      const next = new Map(current).set(key, nextProgress)
      setExporting([...next.values()].some((item) => item.status === 'queued' || item.status === 'exporting'))
      return next
    })
    if (progress.status === 'done') logger.info(`导出完成: ${progress.fileName}`, { destinationPath: progress.destinationPath })
    else if (progress.status === 'failed') logger.error(`导出失败: ${progress.fileName}`, { error: progress.error })
    else if (progress.status === 'canceled') logger.warn(`导出已取消: ${progress.fileName}`)
    else if (progress.status === 'exporting' && progress.percent !== null && progress.percent % 25 === 0) logger.info(`导出进度: ${progress.fileName}`, { percent: progress.percent })
  }, [])

  useEffect(() => {
    const offIpc = window.luna.onExportProgress(applyExportProgress)
    const handleLocalProgress = (event: Event): void => {
      applyExportProgress((event as CustomEvent<ExportProgress>).detail)
    }
    window.addEventListener('luna:export-progress-local', handleLocalProgress)
    return () => {
      offIpc()
      window.removeEventListener('luna:export-progress-local', handleLocalProgress)
    }
  }, [applyExportProgress])

  return (
    <AppCtx.Provider
      value={{
        settings,
        setSettings,
        connection,
        setConnection,
        downloadProgress,
        setDownloadProgress,
        exportProgress,
        setExportProgress,
        exportSnapshots,
        setExportSnapshots,
        exporting,
        setExporting,
        hiddenDevMode,
        setHiddenDevMode,
      }}
    >
      {children}
    </AppCtx.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
