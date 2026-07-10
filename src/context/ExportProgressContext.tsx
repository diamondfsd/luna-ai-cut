import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ExportProgress, LunaFile } from '../shared/types'
import { logger } from '../lib/rendererLogger'

interface ExportProgressContextValue {
  exportProgress: Map<string, ExportProgress>
  setExportProgress: React.Dispatch<React.SetStateAction<Map<string, ExportProgress>>>
  exportSnapshots: Map<string, LunaFile>
  setExportSnapshots: React.Dispatch<React.SetStateAction<Map<string, LunaFile>>>
  exporting: boolean
  setExporting: (exporting: boolean) => void
}

const Ctx = createContext<ExportProgressContextValue | null>(null)

export function ExportProgressProvider({ children }: { children: ReactNode }) {
  const [exportProgress, setExportProgress] = useState<Map<string, ExportProgress>>(new Map())
  const [exportSnapshots, setExportSnapshots] = useState<Map<string, LunaFile>>(new Map())
  const [exporting, setExporting] = useState(false)

  const applyExportProgress = useCallback((progress: ExportProgress): void => {
    if (progress.taskId && progress.exportId) {
      void window.luna.exportTask.updateItem(progress.taskId, progress.exportId, {
        status: progress.status,
        progress: progress.percent ?? undefined,
        destinationPath: progress.destinationPath,
        error: progress.error,
      }).catch(() => {})
    }
    setExportProgress((current) => {
      const key = progress.exportId ?? progress.fileName
      const previous = current.get(key)
      const nextProgress = { ...previous, ...progress }
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
    <Ctx.Provider value={{ exportProgress, setExportProgress, exportSnapshots, setExportSnapshots, exporting, setExporting }}>
      {children}
    </Ctx.Provider>
  )
}

export function useExportProgress(): ExportProgressContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useExportProgress must be used inside ExportProgressProvider')
  return ctx
}
