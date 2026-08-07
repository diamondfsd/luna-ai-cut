import { ipcMain } from 'electron'
import type { AppSettings } from '../src/shared/types'
import { deviceDefinitions } from './deviceDefaults'
import {
  chooseDownloadDir, chooseLocalResourcesDir, chooseExportDir, chooseLutDir, chooseMockMediaDir,
  chooseWorkspaceMediaDirectory, chooseWorkspaceMediaFiles, readWorkspaceMediaFile,
  getSettings, saveSettings, getCacheStats, clearCache,
} from './fileService'
import { startMockServer, stopMockServer, getMockStatus } from './mockServerService'
import { deleteCustomLut, listCustomLuts } from './customLutLibraryService'

export function register(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: Partial<AppSettings>) => saveSettings(settings))
  ipcMain.handle('devices:list', () => deviceDefinitions())
  ipcMain.handle('settings:chooseDownloadDir', () => chooseDownloadDir())
  ipcMain.handle('settings:chooseLocalResourcesDir', () => chooseLocalResourcesDir())
  ipcMain.handle('settings:chooseExportDir', () => chooseExportDir())
  ipcMain.handle('settings:chooseLutDir', () => chooseLutDir())
  ipcMain.handle('settings:listCustomLuts', () => listCustomLuts())
  ipcMain.handle('settings:deleteCustomLut', (_event, filePath: string) => deleteCustomLut(filePath))
  ipcMain.handle('settings:chooseMockMediaDir', () => chooseMockMediaDir())
  ipcMain.handle('workspace:chooseMediaFiles', () => chooseWorkspaceMediaFiles())
  ipcMain.handle('workspace:chooseMediaDirectory', () => chooseWorkspaceMediaDirectory())
  ipcMain.handle('workspace:readMediaFile', (_event, filePath: string) => readWorkspaceMediaFile(filePath))
  ipcMain.handle('mock:start', (_event, s?: Partial<AppSettings>) => startMockServer(s))
  ipcMain.handle('mock:stop', () => stopMockServer())
  ipcMain.handle('mock:status', () => getMockStatus())
  ipcMain.handle('cache:stats', () => getCacheStats())
  ipcMain.handle('cache:clear', () => clearCache())
}
