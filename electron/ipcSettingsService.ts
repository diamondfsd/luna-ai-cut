import { dialog, ipcMain } from 'electron'
import * as path from 'node:path'
import type { AppSettings } from '../src/shared/types'
import { deviceDefinitions } from './deviceDefaults'
import {
  chooseBaseDir, chooseLocalResourcesDir, chooseExportDir, chooseLutDir, chooseMockMediaDir, chooseWorkspaceMediaFiles,
  getSettings, saveSettings, getCacheStats, clearCache,
} from './fileService'
import { startMockServer, stopMockServer, getMockStatus } from './mockServerService'
import { deleteCustomLut, listCustomLuts } from './customLutLibraryService'
import { migrateLocalStorage } from './storageMigrationService'
import type { IpcContext } from './ipcContext'

let storageMigrationInProgress = false

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
      const result = await dialog.showOpenDialog({
        defaultPath: path.dirname(settings.baseDir),
        properties: ['openDirectory', 'createDirectory'],
        title: '选择新的本地存储位置',
        buttonLabel: '迁移到这里',
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return migrateLocalStorage(settings, result.filePaths[0], saveSettings)
    } finally {
      storageMigrationInProgress = false
    }
  })
}
