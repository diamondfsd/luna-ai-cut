import { app, dialog, ipcMain } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AppSettings } from '../src/shared/types'
import { deviceDefinitions } from './deviceDefaults'
import {
  chooseBaseDir, chooseLocalResourcesDir, chooseExportDir, chooseLutDir, chooseMockMediaDir, chooseWorkspaceMediaFiles,
  getLocalResourcesDir, getSettings, saveSettings, getCacheStats, clearCache,
} from './fileService'
import { startMockServer, stopMockServer, getMockStatus } from './mockServerService'
import { deleteCustomLut, listCustomLuts } from './customLutLibraryService'
import {
  assertStorageTargetWritable,
  createStorageMigrationPlan,
  migrateLocalStorage,
  storageMigrationConflictLabels,
  type StorageMigrationSources,
} from './storageMigrationService'
import { organizeDownloadedFiles } from './downloadStorageService'
import type { IpcContext } from './ipcContext'

let storageMigrationInProgress = false

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.lstat(directory)).isDirectory()
  } catch {
    return false
  }
}

async function storageMigrationSources(settings: AppSettings): Promise<StorageMigrationSources> {
  const legacyRoot = app.getPath('userData')
  const currentCache = path.join(settings.baseDir, 'cache')
  const legacyCache = path.join(legacyRoot, 'cache')
  const legacyPreviews = path.join(legacyRoot, 'cache_previews')
  const legacyMetadata = path.join(legacyRoot, 'cache_metadata')
  const legacyAiSelection = path.join(legacyRoot, '.luna-cache', 'ai-selection')
  const hasCurrentCache = await directoryExists(currentCache)
  const hasLegacyCache = await directoryExists(legacyCache)
  const cacheSource = hasCurrentCache ? currentCache : (hasLegacyCache ? legacyCache : undefined)

  return {
    cacheSource,
    previewCacheSource: !await directoryExists(path.join(cacheSource ?? currentCache, 'previews'))
      && await directoryExists(legacyPreviews)
      ? legacyPreviews
      : undefined,
    metadataCacheSource: !await directoryExists(path.join(cacheSource ?? currentCache, 'metadata'))
      && await directoryExists(legacyMetadata)
      ? legacyMetadata
      : undefined,
    aiSelectionCacheSource: !await directoryExists(path.join(cacheSource ?? currentCache, 'ai-selection'))
      && await directoryExists(legacyAiSelection)
      ? legacyAiSelection
      : undefined,
  }
}

interface StorageMigrationTarget {
  targetDir: string
  overwriteExisting: boolean
}

async function chooseWritableStorageTarget(
  settings: AppSettings,
  sources: StorageMigrationSources,
): Promise<StorageMigrationTarget | null> {
  let defaultPath = path.dirname(settings.baseDir)
  let retry = true
  while (retry) {
    const result = await dialog.showOpenDialog({
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      title: '选择新的本地存储位置',
      buttonLabel: '迁移到这里',
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const targetDir = result.filePaths[0]
    try {
      const plan = createStorageMigrationPlan(settings, targetDir, sources)
      await assertStorageTargetWritable(plan.targetDir)
      const conflicts = await storageMigrationConflictLabels(plan)
      if (conflicts.length === 0) return { targetDir: plan.targetDir, overwriteExisting: false }

      const response = await dialog.showMessageBox({
        type: 'warning',
        title: '目标位置已有内容',
        message: `新位置已包含${conflicts.map((label) => `“${label}”`).join('、')}`,
        detail: '继续后会合并文件夹；同名文件将被全部覆盖，且无法恢复。',
        buttons: ['全部覆盖', '重新选择', '取消'],
        defaultId: 1,
        cancelId: 2,
      })
      if (response.response === 0) return { targetDir: plan.targetDir, overwriteExisting: true }
      retry = response.response === 1
      if (!retry) return null
      defaultPath = targetDir
    } catch (error) {
      const message = error instanceof Error ? error.message : '所选位置无法使用，请更换其他基础目录'
      const response = await dialog.showMessageBox({
        type: 'warning',
        title: '无法使用此位置',
        message,
        detail: '迁移尚未开始，请更换其他基础目录。',
        buttons: ['更换目录', '取消'],
        defaultId: 0,
        cancelId: 1,
      })
      retry = response.response === 0
      if (!retry) return null
      defaultPath = targetDir
    }
  }
  return null
}

export function register(ctx: IpcContext): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: Partial<AppSettings>) => saveSettings(settings))
  ipcMain.handle('devices:list', () => deviceDefinitions())
  ipcMain.handle('settings:chooseBaseDir', () => chooseBaseDir())
  ipcMain.handle('settings:chooseLocalResourcesDir', () => chooseLocalResourcesDir())
  ipcMain.handle('settings:chooseExportDir', () => chooseExportDir())
  ipcMain.handle('settings:chooseLutDir', () => chooseLutDir())
  ipcMain.handle('settings:listCustomLuts', () => listCustomLuts())
  ipcMain.handle('settings:deleteCustomLut', (_event, filePath: string) => deleteCustomLut(filePath))
  ipcMain.handle('settings:chooseMockMediaDir', () => chooseMockMediaDir())
  ipcMain.handle('workspace:chooseMediaFiles', () => chooseWorkspaceMediaFiles())
  ipcMain.handle('mock:start', (_event, s?: Partial<AppSettings>) => startMockServer(s))
  ipcMain.handle('mock:stop', () => stopMockServer())
  ipcMain.handle('mock:status', () => getMockStatus())
  ipcMain.handle('cache:stats', () => getCacheStats())
  ipcMain.handle('cache:clear', () => clearCache())
  ipcMain.handle('downloads:organize', async () => {
    if (ctx.activeDownloadControllers.size > 0) throw new Error('请等待正在下载的内容完成后再整理')
    const settings = await getSettings()
    return organizeDownloadedFiles(getLocalResourcesDir(settings))
  })
  ipcMain.handle('storage:migrate', async () => {
    if (storageMigrationInProgress) throw new Error('本地存储正在迁移，请等待完成')
    if (
      ctx.activeDownloadControllers.size > 0
      || ctx.activeExportControllers.size > 0
      || ctx.activeExportEncoders.size > 0
      || ctx.activeNativeExportTasks.size > 0
    ) {
      throw new Error('请等待正在下载或导出的内容完成后再迁移')
    }

    storageMigrationInProgress = true
    try {
      const settings = await getSettings()
      const sources = await storageMigrationSources(settings)
      const target = await chooseWritableStorageTarget(settings, sources)
      if (!target) return null
      return migrateLocalStorage(settings, target.targetDir, saveSettings, sources, target)
    } finally {
      storageMigrationInProgress = false
    }
  })
}
