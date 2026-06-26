import type { Dispatch, SetStateAction } from 'react'

import type { AppSettings, DownloadProgress, ExportProgress, LunaFile, VideoExportSettings, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import type { ViewMode } from './useMediaLibraryController'

interface TransferActionProps {
  files: LunaFile[]
  selectedFiles: LunaFile[]
  settings: AppSettings | null
  setActiveDownloadFileNames: (value: Set<string>) => void
  setDeleteError: (value: string | null) => void
  setDeletingLocalFiles: (value: boolean) => void
  setDownloadProgress: Dispatch<SetStateAction<Map<string, DownloadProgress>>>
  setDownloadQueue: Dispatch<SetStateAction<LunaFile[]>>
  setDownloadedFiles: Dispatch<SetStateAction<LunaFile[]>>
  setExportError: (value: string | null) => void
  setExportedFiles: Dispatch<SetStateAction<LunaFile[]>>
  setExporting: (value: boolean) => void
  setExportProgress: Dispatch<SetStateAction<Map<string, ExportProgress>>>
  setExportSnapshots: Dispatch<SetStateAction<Map<string, LunaFile>>>
  setFiles: Dispatch<SetStateAction<LunaFile[]>>
  setPreviewFile: Dispatch<SetStateAction<LunaFile | null>>
  setPreviewFiles: Dispatch<SetStateAction<LunaFile[]>>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  setShowDeleteDialog: (value: boolean) => void
  viewMode: ViewMode
  loadDownloadedLibrary: () => Promise<void>
  loadExportLibrary: () => Promise<void>
}

function markDownloaded(file: LunaFile, path: string): LunaFile {
  return { ...file, localPath: path, downloadFilePath: path }
}

export function useMediaLibraryTransferActions({
  files,
  selectedFiles,
  settings,
  setActiveDownloadFileNames,
  setDeleteError,
  setDeletingLocalFiles,
  setDownloadProgress,
  setDownloadQueue,
  setDownloadedFiles,
  setExportError,
  setExportedFiles,
  setExporting,
  setExportProgress,
  setExportSnapshots,
  setFiles,
  setPreviewFile,
  setPreviewFiles,
  setSelected,
  setShowDeleteDialog,
  viewMode,
  loadDownloadedLibrary,
  loadExportLibrary,
}: TransferActionProps) {
  function markFileDownloaded(fileName: string, path: string): void {
    setFiles((current) => current.map((file) => (
      file.name === fileName ? markDownloaded(file, path) : file
    )))
    setPreviewFiles((current) => current.map((file) => (
      file.name === fileName ? markDownloaded(file, path) : file
    )))
    setPreviewFile((current) => (
      current?.name === fileName ? markDownloaded(current, path) : current
    ))
  }

  async function restoreDownloadedRecords(nextFiles = files, downloadDir = settings?.downloadDir): Promise<void> {
    if (!downloadDir || nextFiles.length === 0) return
    try {
      const records = await window.luna.getDownloadedRecords(nextFiles, downloadDir)
      if (records.length === 0) return
      for (const record of records) {
        markFileDownloaded(record.fileName, record.path)
      }
      setDownloadProgress((current) => {
        const next = new Map(current)
        for (const record of records) {
          const file = nextFiles.find((item) => item.name === record.fileName)
          next.set(record.fileName, {
            fileName: record.fileName,
            index: 0,
            totalFiles: records.length,
            downloaded: record.bytes ?? file?.bytes ?? 0,
            total: record.bytes ?? file?.bytes ?? null,
            percent: 100,
            speedBps: 0,
            status: 'exists',
            destinationPath: record.path,
          })
        }
        return next
      })
    } catch (error) {
      console.error(error)
    }
  }

  async function startDownload(): Promise<void> {
    if (!settings || selectedFiles.length === 0) return

    let toDownload = selectedFiles
    if (settings.downloadDir) {
      const records = await window.luna.getDownloadedRecords(selectedFiles, settings.downloadDir)
      const recordByName = new Map(records.map((record) => [record.fileName, record]))
      if (records.length > 0) {
        for (const record of records) {
          markFileDownloaded(record.fileName, record.path)
        }
        setDownloadProgress((current) => {
          const next = new Map(current)
          for (const [index, record] of records.entries()) {
            const file = selectedFiles.find((item) => item.name === record.fileName)
            next.set(record.fileName, {
              fileName: record.fileName,
              index,
              totalFiles: selectedFiles.length,
              downloaded: record.bytes ?? file?.bytes ?? 0,
              total: record.bytes ?? file?.bytes ?? null,
              percent: 100,
              speedBps: 0,
              status: 'exists',
              destinationPath: record.path,
            })
          }
          return next
        })
      }
      toDownload = selectedFiles.filter((file) => !recordByName.has(file.name))
    }

    setSelected(new Set())
    const activeNames = new Set(toDownload.map((file) => file.name))
    setActiveDownloadFileNames(activeNames)
    if (toDownload.length === 0) return
    setDownloadProgress((current) => {
      const next = new Map(current)
      for (const [index, file] of toDownload.entries()) {
        const existing = next.get(file.name)
        if (existing?.status === 'done' || existing?.status === 'exists') continue
        next.set(file.name, {
          fileName: file.name,
          index,
          totalFiles: toDownload.length,
          downloaded: 0,
          total: file.bytes,
          percent: 0,
          speedBps: 0,
          status: 'queued',
        })
      }
      return next
    })
    setDownloadQueue((current) => {
      const currentActive = current.filter((file) => activeNames.has(file.name))
      const queued = new Set(currentActive.map((file) => file.name))
      return [...currentActive, ...toDownload.filter((file) => !queued.has(file.name))]
    })
  }

  async function downloadOne(file: LunaFile): Promise<void> {
    if (!settings) return
    if (settings.downloadDir) {
      const records = await window.luna.getDownloadedRecords([file], settings.downloadDir)
      const existing = records[0]
      if (existing) {
        markFileDownloaded(file.name, existing.path)
        setDownloadProgress((current) => {
          const next = new Map(current)
          next.set(file.name, {
            fileName: file.name,
            index: 0,
            totalFiles: 1,
            downloaded: existing.bytes ?? file.bytes ?? 0,
            total: existing.bytes ?? file.bytes ?? null,
            percent: 100,
            speedBps: 0,
            status: 'exists',
            destinationPath: existing.path,
          })
          return next
        })
        return
      }
    }
    setActiveDownloadFileNames(new Set([file.name]))
    setDownloadProgress((current) => {
      const next = new Map(current)
      const existing = next.get(file.name)
      if (existing?.status !== 'done' && existing?.status !== 'exists') {
        next.set(file.name, {
          fileName: file.name,
          index: 0,
          totalFiles: 1,
          downloaded: 0,
          total: file.bytes,
          percent: 0,
          speedBps: 0,
          status: 'queued',
        })
      }
      return next
    })
    setDownloadQueue((current) => (current.some((item) => item.name === file.name) ? current : [...current, file]))
  }

  async function exportLocalFiles(filesToExport: LunaFile[], watermarkSettings: WatermarkSettingsType, videoExportSettings?: VideoExportSettings): Promise<void> {
    if (filesToExport.length === 0) return
    setExportError(null)
    setExporting(true)
    try {
      if (!settings?.exportDir) {
        setExportError('未设置导出目录，请在设置中配置')
        return
      }
      const batchTs = Date.now()
      const snapshots = new Map<string, LunaFile>()
      const queued = new Map<string, ExportProgress>()
      filesToExport.forEach((file, index) => {
        const exportName = file.downloadName || file.name
        const exportId = `${exportName}_${batchTs}_${index}`
        snapshots.set(exportId, file)
        queued.set(exportId, {
          exportId,
          fileName: exportName,
          index,
          totalFiles: filesToExport.length,
          percent: 0,
          status: 'queued',
        })
      })
      setExportSnapshots(snapshots)
      setExportProgress(queued)
      const payload = filesToExport.map((file, index) => {
        const exportName = file.downloadName || file.name
        return {
          name: exportName,
          kind: file.kind,
          localPath: file.downloadFilePath ?? file.localPath,
          exportId: `${exportName}_${batchTs}_${index}`,
        }
      })
      const result = await window.luna.exportFiles(payload, settings.exportDir, watermarkSettings, videoExportSettings)
      if (result.failed.length > 0) {
        const firstError = result.failed[0]
        setExportError(`${firstError.name}: ${firstError.error}`)
      }
      if (result.canceled.length > 0) {
        setExportError('导出已取消')
      }
      setSelected(new Set())
      await loadExportLibrary()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportError(`导出失败: ${message}`)
      console.error('[export] 导出失败:', error)
    } finally {
      setExporting(false)
    }
  }

  async function deleteSelectedLocalFiles(): Promise<void> {
    const filesToDelete = selectedFiles
    if (filesToDelete.length === 0) return
    const filePaths = filesToDelete
      .map((file) => file.downloadFilePath ?? file.localPath)
      .filter((filePath): filePath is string => Boolean(filePath))
    if (filePaths.length === 0) {
      setDeleteError('没有可删除的本地文件')
      return
    }

    setDeletingLocalFiles(true)
    setDeleteError(null)
    try {
      const result = await window.luna.deleteLocalFiles(filePaths)
      if (result.failed.length > 0) {
        setDeleteError(`${result.failed.length} 个文件删除失败`)
      }
      const deletedPaths = new Set(result.deleted)
      const isDeleted = (file: LunaFile): boolean => deletedPaths.has(file.downloadFilePath ?? file.localPath ?? '')
      if (viewMode === 'export') {
        setExportedFiles((current) => current.filter((file) => !isDeleted(file)))
      } else {
        setDownloadedFiles((current) => current.filter((file) => !isDeleted(file)))
      }
      setPreviewFiles((current) => current.filter((file) => !isDeleted(file)))
      setPreviewFile((current) => (current && isDeleted(current) ? null : current))
      setSelected(new Set())
      setShowDeleteDialog(false)
      if (viewMode === 'export') void loadExportLibrary()
      else void loadDownloadedLibrary()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDeleteError(`删除失败: ${message}`)
    } finally {
      setDeletingLocalFiles(false)
    }
  }

  return {
    deleteSelectedLocalFiles,
    downloadOne,
    exportLocalFiles,
    markFileDownloaded,
    restoreDownloadedRecords,
    startDownload,
  }
}
