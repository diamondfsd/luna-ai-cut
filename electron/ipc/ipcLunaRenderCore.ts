/**
 * IPC 处理器 — Luna Render Core
 */
import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { appendFileSync, existsSync, statSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, extname, basename, isAbsolute } from 'node:path'
import {
  warmupRenderCore,
  renderCompositionFrame as lrcRenderCompositionFrame,
  renderCompositionFrameAsync as lrcRenderCompositionFrameAsync,
  resolveRenderSource as lrcResolveRenderSource,
  exportCompositionVideoAsync as lrcExportCompositionVideoAsync,
  exportCompositionImageAsync as lrcExportCompositionImageAsync,
  cancelExportTask as lrcCancelExportTask,
  getExportTaskProgress as lrcGetExportTaskProgress,
  resetRenderCompatibilityBlock,
} from '../platform/render/lunaRenderCore'

// 导入纹理管理方法
import { getNative, cleanNativeInput } from '../platform/render/lunaRenderCore'
import { getFfmpegPath, getFfprobePath } from '../platform/ffmpeg/pipeline'
import * as exportTaskService from '../export/exportTaskService'
import { getLogDir, logMainError, logMainInfo, logMainWarn } from '../infrastructure/loggerService'
import { RUNTIME_RESOURCE_DEFINITIONS } from '../infrastructure/runtimeResourceDefinitions'
import { loadRuntimeResource } from '../infrastructure/runtimeResourceService'
import { embedJpegSourceMetadata, embedVideoSourceMetadata } from '../export/exportSourceMetadata'
import { registerNativePreviewIpc } from '../media/nativePreviewIpc'

interface RegisterContext {
  win: Electron.BrowserWindow | null
  activeNativeExportTasks: Set<string>
}

function runtimeResourceCacheRoot(): string {
  return join(app.getPath('userData'), 'resource-packs')
}

function relativePackPath(value: string, root: 'fonts' | 'luts'): string | null {
  const normalized = value.replace(/\\/g, '/')
  const prefix = `${root}/`
  if (!isAbsolute(value)) return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null
  const index = normalized.toLowerCase().lastIndexOf(`/${prefix}`)
  return index >= 0 ? normalized.slice(index + prefix.length + 1) : null
}

function joinPackPath(root: string, relative: string): string {
  if (!relative || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('资源文件路径不安全')
  }
  return join(root, ...relative.split('/'))
}

async function resolveRuntimePaths<T>(value: T): Promise<T> {
  if (Array.isArray(value)) return await Promise.all(value.map(resolveRuntimePaths)) as T
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    if (key === 'fontFile' && typeof item === 'string') {
      const relative = relativePackPath(item, 'fonts')
      const localPath = relative && !isAbsolute(item)
        ? (app.isPackaged
        ? join(process.resourcesPath, 'fonts', relative)
        : join(process.env.APP_ROOT ?? join(import.meta.dirname, '..'), 'public', 'fonts', relative))
        : item
      if (existsSync(localPath)) output[key] = localPath
      else if (relative) {
        const root = await loadRuntimeResource(runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS.fonts)
        output[key] = joinPackPath(root, relative)
      } else output[key] = item
    } else if ((key === 'lutId' || key === 'restoreLutId') && typeof item === 'string') {
      const relative = relativePackPath(item, 'luts')
      if (existsSync(item) || !relative) output[key] = item
      else {
        const root = await loadRuntimeResource(runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS.luts)
        output[key] = joinPackPath(root, relative)
      }
    } else {
      output[key] = await resolveRuntimePaths(item)
    }
  }
  return output as T
}

/** 写日志到文件（追加模式），APP_ROOT 在 appMain.ts 中设置 */
function rcLog(msg: string): void {
  const logPath = join(getLogDir(), 'luna-rc.log')
  try {
    const ts = new Date().toISOString().slice(11, 23)
    appendFileSync(logPath, `[${ts}] [main] ${msg}\n`)
  } catch { /* ignore */ }
}

/** 包装 handler：自动 catch 异常并记日志 */
function safe<T extends (...args: any[]) => any>(label: string, fn: T): T {
  let firstCall = true
  return (async (...args: any[]) => {
    const traceThisCall = firstCall
    firstCall = false
    if (traceThisCall) logMainInfo('[LRC] 首次调用开始', { label })
    try {
      const result = await fn(...args)
      if (traceThisCall) logMainInfo('[LRC] 首次调用完成', { label })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      rcLog(`ERROR in ${label}: ${msg}`)
      logMainError('[LRC] 调用失败', { label, error: msg })
      throw err
    }
  }) as unknown as T
}

export function register(ctx: RegisterContext): void {
  registerNativePreviewIpc(ctx, resolveRuntimePaths)

  ipcMain.handle('lrc:resetCompatibilityBlock', async () => {
    resetRenderCompatibilityBlock()
    logMainInfo('[LRC] 已解除渲染兼容保护，等待重新检测')
  })

  ipcMain.handle('lrc:init', safe('init', async (_event: IpcMainInvokeEvent, logPath?: string) => {
    await warmupRenderCore(logPath)
    rcLog('lrc:init OK')
  }))

  ipcMain.handle('lrc:getNativePreviewCapabilities', safe('getNativePreviewCapabilities', async () => {
    return getNative().getNativePreviewCapabilities()
  }))

  ipcMain.handle('lrc:prepareRuntimeResource', safe('prepareRuntimeResource',
    async (_event: IpcMainInvokeEvent, kind: 'fonts' | 'luts') => {
      if (kind !== 'fonts' && kind !== 'luts') throw new Error('未知运行时资源类型')
      await loadRuntimeResource(runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS[kind])
    },
  ))

  // 纹理管理方法
  ipcMain.handle('lrc:loadTexture', safe('loadTexture',
    async (_event: IpcMainInvokeEvent, data: Buffer, width: number, height: number) => {
      return getNative().loadTexture(data, width, height)
    },
  ))

  ipcMain.handle('lrc:updateTexture', safe('updateTexture',
    async (_event: IpcMainInvokeEvent, textureId: number, data: Buffer) => {
      return getNative().updateTexture(textureId, data)
    },
  ))

  ipcMain.handle('lrc:renderFrame', safe('renderFrame',
    async (_event: IpcMainInvokeEvent, canvasWidth: number, canvasHeight: number, layers: any[], compositionTime?: number) => {
      return getNative().renderFrame(
        canvasWidth,
        canvasHeight,
        cleanNativeInput(await resolveRuntimePaths(layers)),
        compositionTime,
      )
    },
  ))

  ipcMain.handle('lrc:releaseTexture', safe('releaseTexture',
    async (_event: IpcMainInvokeEvent, textureId: number) => {
      return getNative().releaseTexture(textureId)
    },
  ))

  ipcMain.handle('lrc:renderCompositionFrame', safe('renderCompositionFrame',
    async (_event: IpcMainInvokeEvent, composition: any, time: number, maxSide?: number) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      return lrcRenderCompositionFrame(ffmpegPath, ffprobePath, await resolveRuntimePaths(composition), time, maxSide)
    },
  ))

  ipcMain.handle('lrc:renderCompositionFrameAsync', safe('renderCompositionFrameAsync',
    async (_event: IpcMainInvokeEvent, composition: any, time: number, maxSide?: number) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      return lrcRenderCompositionFrameAsync(ffmpegPath, ffprobePath, await resolveRuntimePaths(composition), time, maxSide)
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
        _event.sender?.send('export:progress', {
          exportId: exportItemId,
          taskId: exportTaskId,
          fileName: outputPath.split(/[\\/]/).pop(),
          percent: 0,
          status: 'exporting',
          destinationPath: outputPath,
        })
      }

      await lrcExportCompositionImageAsync({ ffmpegPath, ffprobePath, outputPath, composition: await resolveRuntimePaths(composition), format, quality })
      const sourcePath = composition?.layers?.find((layer: any) => layer?.layerType === 'media')?.source?.path
        ?? composition?.layers?.find((layer: any) => layer?.source?.path)?.source?.path
      await embedJpegSourceMetadata(outputPath, sourcePath).catch((error) => {
        logMainWarn('[导出] 无法写入图片来源信息', {
          outputPath,
          error: error instanceof Error ? error.message : String(error),
        })
      })

      if (exportTaskId && exportItemId) {
        _event.sender?.send('export:progress', {
          exportId: exportItemId,
          taskId: exportTaskId,
          fileName: outputPath.split(/[\\/]/).pop(),
          percent: 100,
          status: 'done',
          destinationPath: outputPath,
        })
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
      includeAudio?: boolean,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      const renderTaskId = taskId ?? exportItemId ?? `composition_${Date.now()}`
      const progressExportId = exportItemId ?? renderTaskId
      const fileName = fileNameFromPath(outputPath)
      rcLog(`lrc:exportCompositionVideo start out=${outputPath} task=${renderTaskId} layers=${composition?.layers?.length ?? 0} audio=${includeAudio !== false}`)
      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting' }).catch(() => {})
        _event.sender?.send('export:progress', {
          exportId: progressExportId,
          taskId: exportTaskId,
          fileName,
          percent: 0,
          status: 'exporting',
          destinationPath: outputPath,
        })
      }
      const progressTimer = setInterval(() => {
        const progress = lrcGetExportTaskProgress(renderTaskId)
        if (!progress) return
        const currentFrame = Number(progress[0])
        const totalFrames = Number(progress[1])
        if (totalFrames <= 1) return
        const percent = Math.max(0, Math.min(99, Math.floor((currentFrame / totalFrames) * 100)))
        if (exportTaskId && exportItemId) {
          exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting', progress: percent }).catch(() => {})
          _event.sender?.send('export:progress', {
            exportId: progressExportId,
            taskId: exportTaskId,
            fileName,
            percent,
            status: 'exporting',
            destinationPath: outputPath,
          })
        }
      }, 500)
      ctx.activeNativeExportTasks.add(renderTaskId)
      try {
        await lrcExportCompositionVideoAsync({
          ffmpegPath,
          ffprobePath,
          outputPath,
          composition: await resolveRuntimePaths(composition),
          fps,
          duration,
          hardware,
          taskId: renderTaskId,
          qualityPreset,
          includeAudio,
        })
        const sourcePath = composition?.layers?.find((layer: any) => layer?.layerType === 'media')?.source?.path
          ?? composition?.layers?.find((layer: any) => layer?.source?.path)?.source?.path
        await embedVideoSourceMetadata(ffmpegPath, outputPath, sourcePath).catch((error) => {
          logMainWarn('[导出] 无法写入来源设备信息', {
            outputPath,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        if (exportTaskId && exportItemId) {
          await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'done', progress: 100, destinationPath: outputPath }).catch(() => {})
          _event.sender?.send('export:progress', {
            exportId: progressExportId,
            taskId: exportTaskId,
            fileName,
            percent: 100,
            status: 'done',
            destinationPath: outputPath,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (exportTaskId && exportItemId) {
          await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'failed', error: message }).catch(() => {})
          _event.sender?.send('export:progress', {
            exportId: progressExportId,
            taskId: exportTaskId,
            fileName,
            percent: 100,
            status: 'failed',
            destinationPath: outputPath,
            error: message,
          })
        }
        throw error
      } finally {
        clearInterval(progressTimer)
        ctx.activeNativeExportTasks.delete(renderTaskId)
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
      const results: Array<{ path: string; name: string; relDir: string; description?: string; isBuiltin: boolean }> = []
      const seen = new Set<string>()

      // 内置 LUT 目录：遍历候选路径，取第一个存在的
      //   打包后：process.resourcesPath/luts（extraResources 复制到 resources/luts/）
      //   开发时：VITE_PUBLIC/luts 或 APP_ROOT/public/luts
      let builtinDir = [
        join(process.resourcesPath || '', 'luts'),
        join(process.env.VITE_PUBLIC || join(process.env.APP_ROOT || join(import.meta.dirname, '..'), 'public'), 'luts'),
      ].find((p) => { try { return statSync(p).isDirectory() } catch { return false } }) || ''
      if (!builtinDir) {
        builtinDir = await loadRuntimeResource(runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS.luts)
      }

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
              let description: string | undefined
              try {
                const metaPath = join(dir, `${fileBaseName}.cube.meta.json`)
                const metaRaw = await readFile(metaPath, 'utf8')
                const meta = JSON.parse(metaRaw)
                if (meta.name) name = meta.name
                if (meta.description) description = meta.description
              } catch { /* 没有 meta 文件就用文件名 */ }
              const relDir = dir === baseDir ? '' : dir.slice(baseDir.length + 1)
              const key = `${fileBaseName}:${relDir}`
              if (seen.has(key)) continue
              seen.add(key)
              results.push({ path: fullPath, name, relDir, description, isBuiltin: dir.startsWith(builtinDir) })
            }
          } catch { /* 跳过无权限文件 */ }
        }
      }

      await scanDir(dirPath, dirPath)

      // 始终扫描内置 LUT 目录
      try {
        await stat(builtinDir)
        await scanDir(builtinDir, builtinDir)
      } catch { /* 内置 LUT 目录不存在则跳过 */ }

      return results
    },
  ))

  /** 导入 .cube 文件到 LUT 目录的指定分组 */
  ipcMain.handle('lrc:importCubeFile', safe('importCubeFile',
    async (
      _event: IpcMainInvokeEvent,
      sourcePath: string,
      categoryName: string,
      lutDir: string,
      targetName?: string,
      meta?: { name?: string; description?: string },
    ) => {
      if (!sourcePath.toLowerCase().endsWith('.cube')) {
        throw new Error('只支持 .cube 格式的 LUT 文件')
      }
      const fileName = targetName ? `${targetName}.cube` : basename(sourcePath)
      const destDir = join(lutDir, categoryName)
      await mkdir(destDir, { recursive: true })
      const destPath = join(destDir, fileName)
      await cp(sourcePath, destPath, { force: true })
      const fileBaseName = fileName.replace(/\.cube$/i, '')

      // 写入同名 .meta.json（与内置 LUT 格式一致）
      const metaObj: Record<string, unknown> = {}
      if (meta?.name) {
        metaObj.name = meta.name
      } else {
        metaObj.name = fileBaseName
      }
      if (meta?.description) metaObj.description = meta.description
      const metaPath = destPath + '.meta.json'
      await writeFile(metaPath, JSON.stringify(metaObj), 'utf-8')

      rcLog(`lrc:importCubeFile ${destPath}`)
      return { path: destPath, name: fileBaseName, relDir: categoryName }
    },
  ))

  /** 删除 .cube 文件及其同名 .meta.json（内置 LUT 不可删除） */
  ipcMain.handle('lrc:deleteCubeFile', safe('deleteCubeFile',
    async (_event: IpcMainInvokeEvent, cubePath: string, isBuiltin?: boolean) => {
      if (isBuiltin) {
        throw new Error('内置 LUT 不可删除')
      }
      const rmOpts = { force: true } as const
      await rm(cubePath, rmOpts)
      // 同时删除同名的 meta 文件（如果存在）
      const metaPath = cubePath + '.meta.json'
      await rm(metaPath, rmOpts)
      rcLog(`lrc:deleteCubeFile ${cubePath}`)
    },
  ))

}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || 'export.mp4'
}
