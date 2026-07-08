/**
 * IPC 处理器 — Luna Render Core
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { appendFileSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import {
  ensureInit,
  renderCompositionFrame as lrcRenderCompositionFrame,
  resolveRenderSource as lrcResolveRenderSource,
  exportCompositionVideoAsync as lrcExportCompositionVideoAsync,
  exportCompositionImageAsync as lrcExportCompositionImageAsync,
  cancelExportTask as lrcCancelExportTask,
  getExportTaskProgress as lrcGetExportTaskProgress,
} from './lunaRenderCore'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import * as exportTaskService from './exportTaskService'

interface RegisterContext {
  win: Electron.BrowserWindow | null
}

/** 写日志到文件（追加模式），APP_ROOT 在 appMain.ts 中设置 */
function rcLog(msg: string): void {
  const appRoot = process.env.APP_ROOT || join(import.meta.dirname, '..')
  const logPath = join(appRoot, 'luna-render-core', 'luna-rc.log')
  try {
    const ts = new Date().toISOString().slice(11, 23)
    appendFileSync(logPath, `[${ts}] [main] ${msg}\n`)
  } catch { /* ignore */ }
}

/** 包装 handler：自动 catch 异常并记日志 */
function safe<T extends (...args: any[]) => any>(label: string, fn: T): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      rcLog(`ERROR in ${label}: ${msg}`)
      throw err
    }
  }) as unknown as T
}

export function register(_ctx: RegisterContext): void {
  ipcMain.handle('lrc:init', safe('init', async (_event: IpcMainInvokeEvent, logPath?: string) => {
    ensureInit(logPath)
    rcLog('lrc:init OK')
  }))

  ipcMain.handle('lrc:renderCompositionFrame', safe('renderCompositionFrame',
    async (_event: IpcMainInvokeEvent, composition: any, time: number, maxSide?: number) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      return lrcRenderCompositionFrame(ffmpegPath, ffprobePath, composition, time, maxSide)
    },
  ))

  ipcMain.handle('lrc:exportCompositionImage', safe('exportCompositionImage',
    async (
      _event: IpcMainInvokeEvent,
      outputPath: string,
      composition: any,
      format: string,
      quality: number,
      exportTaskId?: string,
      exportItemId?: string,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      rcLog(`lrc:exportCompositionImage out=${outputPath} fmt=${format} q=${quality}`)

      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting' }).catch(() => {})
      }
      _event.sender?.send('export:progress', {
        exportId: exportItemId,
        taskId: exportTaskId,
        fileName: outputPath.split(/[\\/]/).pop(),
        percent: 0,
        status: 'exporting',
        destinationPath: outputPath,
      })

      await lrcExportCompositionImageAsync({ ffmpegPath, ffprobePath, outputPath, composition, format, quality })

      _event.sender?.send('export:progress', {
        exportId: exportItemId,
        taskId: exportTaskId,
        fileName: outputPath.split(/[\\/]/).pop(),
        percent: 100,
        status: 'done',
        destinationPath: outputPath,
      })

      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'done', progress: 100, destinationPath: outputPath }).catch(() => {})
      }
      rcLog('lrc:exportCompositionImage done')
    },
  ))

  ipcMain.handle('lrc:resolveRenderSource', safe('resolveRenderSource',
    async (_event: IpcMainInvokeEvent, originalPath: string, cacheDir: string) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      rcLog(`lrc:resolveRenderSource path=${originalPath}`)
      return lrcResolveRenderSource(ffmpegPath, ffprobePath, originalPath, cacheDir)
    },
  ))

  ipcMain.handle('lrc:exportCompositionVideo', safe('exportCompositionVideo',
    async (
      _event: IpcMainInvokeEvent,
      outputPath: string,
      composition: any,
      fps: number | null,
      duration: number | null,
      hardware: boolean,
      taskId?: string,
      qualityPreset?: string,
      exportTaskId?: string,
      exportItemId?: string,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      const renderTaskId = taskId ?? exportItemId ?? `composition_${Date.now()}`
      const progressExportId = exportItemId ?? renderTaskId
      const fileName = fileNameFromPath(outputPath)
      rcLog(`lrc:exportCompositionVideo start out=${outputPath} task=${renderTaskId} layers=${composition?.layers?.length ?? 0}`)
      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting' }).catch(() => {})
      }
      _event.sender?.send('export:progress', {
        exportId: progressExportId,
        taskId: exportTaskId,
        fileName,
        percent: 0,
        status: 'exporting',
        destinationPath: outputPath,
      })
      const progressTimer = setInterval(() => {
        const progress = lrcGetExportTaskProgress(renderTaskId)
        if (!progress) return
        const currentFrame = Number(progress[0])
        const totalFrames = Number(progress[1])
        if (totalFrames <= 1) return
        const percent = Math.max(0, Math.min(99, Math.floor((currentFrame / totalFrames) * 100)))
        if (exportTaskId && exportItemId) {
          exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting', progress: percent }).catch(() => {})
        }
        _event.sender?.send('export:progress', {
          exportId: progressExportId,
          taskId: exportTaskId,
          fileName,
          percent,
          status: 'exporting',
          destinationPath: outputPath,
        })
      }, 500)
      try {
        await lrcExportCompositionVideoAsync({
          ffmpegPath,
          ffprobePath,
          outputPath,
          composition,
          fps,
          duration,
          hardware,
          taskId: renderTaskId,
          qualityPreset,
        })
        if (exportTaskId && exportItemId) {
          await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'done', progress: 100, destinationPath: outputPath }).catch(() => {})
        }
        _event.sender?.send('export:progress', {
          exportId: progressExportId,
          taskId: exportTaskId,
          fileName,
          percent: 100,
          status: 'done',
          destinationPath: outputPath,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (exportTaskId && exportItemId) {
          await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'failed', error: message }).catch(() => {})
        }
        _event.sender?.send('export:progress', {
          exportId: progressExportId,
          taskId: exportTaskId,
          fileName,
          percent: 100,
          status: 'failed',
          destinationPath: outputPath,
          error: message,
        })
        throw error
      } finally {
        clearInterval(progressTimer)
      }
    },
  ))

  ipcMain.handle('lrc:cancelExportTask', safe('cancelExportTask',
    async (_event: IpcMainInvokeEvent, taskId: string) => {
      lrcCancelExportTask(taskId)
      rcLog(`lrc:cancelExportTask task=${taskId}`)
    },
  ))

  ipcMain.handle('lrc:getExportTaskProgress', safe('getExportTaskProgress',
    async (_event: IpcMainInvokeEvent, taskId: string) => {
      return lrcGetExportTaskProgress(taskId)
    },
  ))

  /** 递归扫描 .cube 文件（内置 + 外部目录），按目录名作为分类 */
  ipcMain.handle('lrc:listCubeFiles', safe('listCubeFiles',
    async (_event: IpcMainInvokeEvent, dirPath: string) => {
      const results: Array<{ path: string; name: string; relDir: string }> = []
      const seen = new Set<string>()

      async function scanDir(dir: string, baseDir: string): Promise<void> {
        let entries: string[]
        try { entries = await readdir(dir) } catch { return }
        for (const entry of entries.sort()) {
          const fullPath = join(dir, entry)
          try {
            const info = await stat(fullPath)
            if (info.isDirectory()) {
              await scanDir(fullPath, baseDir)
            } else if (info.isFile() && extname(entry).toLowerCase() === '.cube') {
              const fileBaseName = entry.replace(/\.cube$/i, '')
              // 尝试读取同名的 .meta.json，用其中的 name 字段作为显示名
              let name = fileBaseName
              try {
                const metaPath = join(dir, `${fileBaseName}.cube.meta.json`)
                const metaRaw = await readFile(metaPath, 'utf8')
                const meta = JSON.parse(metaRaw)
                if (meta.name) name = meta.name
              } catch { /* 没有 meta 文件就用文件名 */ }
              const relDir = dir === baseDir ? '' : dir.slice(baseDir.length + 1)
              const key = `${fileBaseName}:${relDir}`
              if (seen.has(key)) continue
              seen.add(key)
              results.push({ path: fullPath, name, relDir })
            }
          } catch { /* 跳过无权限文件 */ }
        }
      }

      await scanDir(dirPath, dirPath)

      // 始终扫描内置 LUT 目录
      const builtinDir = join(
        process.env.VITE_PUBLIC || join(process.env.APP_ROOT!, 'public'),
        'luts',
      )
      try {
        await stat(builtinDir)
        await scanDir(builtinDir, builtinDir)
      } catch { /* 内置 LUT 目录不存在则跳过 */ }

      return results
    },
  ))

  /** 导入 .cube 文件到 LUT 目录的指定分组 */
  ipcMain.handle('lrc:importCubeFile', safe('importCubeFile',
    async (_event: IpcMainInvokeEvent, sourcePath: string, categoryName: string, lutDir: string) => {
      const name = basename(sourcePath)
      if (!name.toLowerCase().endsWith('.cube')) {
        throw new Error('只支持 .cube 格式的 LUT 文件')
      }
      const destDir = join(lutDir, categoryName)
      await mkdir(destDir, { recursive: true })
      const destPath = join(destDir, name)
      await cp(sourcePath, destPath, { force: true })
      const fileBaseName = name.replace(/\.cube$/i, '')
      rcLog(`lrc:importCubeFile ${destPath}`)
      return { path: destPath, name: fileBaseName, relDir: categoryName }
    },
  ))

}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || 'export.mp4'
}
