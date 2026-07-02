import type { Dispatch, SetStateAction } from 'react'

import { logger, logExport } from '../lib/rendererLogger'
import type { AppSettings, DownloadProgress, ExportProgress, LunaFile, VideoExportSettings, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { createDefaultPipeline } from '../workspace/shared/editPipeline'
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

function exportSourcePath(file: LunaFile): string | null {
  return file.downloadFilePath ?? file.localPath ?? null
}

function exportSnapshot(file: LunaFile, exportedPath?: string): LunaFile {
  const path = exportedPath ?? exportSourcePath(file) ?? file.sourceUrl
  return {
    ...file,
    sourceUrl: path,
    url: path,
    downloadFilePath: exportedPath ?? file.downloadFilePath,
    localPath: exportedPath ?? file.localPath,
  }
}

function isVideoFile(file: LunaFile): boolean {
  return file.kind === 'video' || file.kind === 'lrv'
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
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

  async function exportLocalFiles(filesToExport: LunaFile[], watermarkSettings: WatermarkSettingsType, _videoExportSettings?: VideoExportSettings): Promise<void> {
    if (filesToExport.length === 0) return
    setExportError(null)
    setExporting(true)
    try {
      if (!settings?.exportDir) {
        setExportError('未设置导出目录，请在设置中配置')
        logger.error('导出失败：未设置导出目录')
        return
      }
      logExport('开始导出', {
        fileCount: filesToExport.length,
        fileNames: filesToExport.map(f => f.downloadName || f.name),
        exportDir: settings.exportDir,
        watermarkSettings,
      })
      const batchTs = Date.now()
      const taskName = filesToExport.length === 1
        ? `${filesToExport[0].downloadName || filesToExport[0].name}导出`
        : `${filesToExport.length}个文件导出`
      const exportEntries = filesToExport.map((file, index) => {
        const exportName = file.downloadName || file.name
        return {
          file,
          index,
          exportName,
          exportId: `${exportName}_${batchTs}_${index}`,
        }
      })
      const runnableEntries = exportEntries.filter(({ file }) => exportSourcePath(file))
      const missingEntries = exportEntries.filter(({ file }) => !exportSourcePath(file))
      if (runnableEntries.length === 0) {
        setExportError('本地文件不存在')
        return
      }
      const task = await window.luna.workspace.createExportTask(
        taskName,
        runnableEntries.map(({ file, exportName, exportId }) => ({
          exportId,
          fileName: exportName,
          kind: isVideoFile(file) ? 'video' : 'image',
        })),
      )
      const snapshots = new Map<string, LunaFile>()
      const queued = new Map<string, ExportProgress>()
      exportEntries.forEach(({ file, index, exportName, exportId }) => {
        snapshots.set(exportId, exportSnapshot(file))
        queued.set(exportId, {
          exportId,
          taskId: task.id,
          taskName,
          createdAt: batchTs,
          fileName: exportName,
          index,
          totalFiles: filesToExport.length,
          percent: 0,
          status: 'queued',
        })
      })
      setExportSnapshots((current) => new Map([...current, ...snapshots]))
      setExportProgress((current) => new Map([...current, ...queued]))

      const completed: Array<{ name: string; path: string }> = []
      const failed: Array<{ name: string; error: string }> = missingEntries.map(({ exportName }) => ({
        name: exportName,
        error: '本地文件不存在',
      }))
      if (missingEntries.length > 0) {
        setExportProgress((current) => {
          const next = new Map(current)
          for (const { index, exportName, exportId } of missingEntries) {
            next.set(exportId, {
              exportId,
              taskName,
              createdAt: batchTs,
              fileName: exportName,
              index,
              totalFiles: filesToExport.length,
              percent: null,
              status: 'failed',
              error: '本地文件不存在',
            })
          }
          return next
        })
      }

      const imageEntries = runnableEntries.filter(({ file }) => !isVideoFile(file))
      const videoEntries = runnableEntries.filter(({ file }) => isVideoFile(file))
      const exportOne = async ({ file, index, exportName, exportId }: typeof exportEntries[number]) => {
        const sourcePath = exportSourcePath(file)!

        const pipeline = createDefaultPipeline()
        pipeline.watermark = { ...watermarkSettings }

        try {
          setExportProgress((current) => new Map(current).set(exportId, {
            exportId,
            taskId: task.id,
            taskName,
            createdAt: batchTs,
            fileName: exportName,
            index,
            totalFiles: filesToExport.length,
            percent: 0,
            status: 'exporting',
          }))

          const result = await window.luna.workspace.exportFFmpeg(
            sourcePath,
            JSON.parse(JSON.stringify(pipeline)),
            { exportId, taskName, taskId: task.id },
          )

          completed.push({ name: exportName, path: result.path })
          setExportSnapshots((current) => new Map(current).set(exportId, exportSnapshot(file, result.path)))
          setExportProgress((current) => new Map(current).set(exportId, {
            exportId,
            taskId: task.id,
            taskName,
            createdAt: batchTs,
            fileName: exportName,
            index,
            totalFiles: filesToExport.length,
            percent: 100,
            status: 'done',
            destinationPath: result.path,
          }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failed.push({ name: exportName, error: message })
          setExportProgress((current) => new Map(current).set(exportId, {
            exportId,
            taskId: task.id,
            taskName,
            createdAt: batchTs,
            fileName: exportName,
            index,
            totalFiles: filesToExport.length,
            percent: null,
            status: 'failed',
            error: message,
          }))
        }
      }

      await Promise.all([
        runWithConcurrency(imageEntries, 4, exportOne),
        runWithConcurrency(videoEntries, 1, exportOne),
      ])

      if (completed.length > 0) {
        logExport('导出完成', {
          completedCount: completed.length,
          files: completed,
        })
      }
      if (failed.length > 0) {
        const firstError = failed[0]
        setExportError(`${firstError.name}: ${firstError.error}`)
        logger.error('导出文件失败', { files: failed })
      }
      setSelected(new Set())
      await loadExportLibrary()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportError(`导出失败: ${message}`)
      logger.error('导出异常', { error: message })
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
