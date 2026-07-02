import { ipcMain } from 'electron'
import type { AppSettings } from '../src/shared/types'
import { deviceDefinitions } from './deviceDefaults'
import {
  chooseDownloadDir, chooseLocalResourcesDir, chooseExportDir, chooseMockMediaDir,
  getSettings, saveSettings, getCacheStats, clearCache,
} from './fileService'
import { startMockServer, stopMockServer, getMockStatus } from './mockServerService'
import type { IpcContext } from './ipcContext'

export function register(_ctx?: IpcContext): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: Partial<AppSettings>) => saveSettings(settings))
  ipcMain.handle('devices:list', () => deviceDefinitions())
  ipcMain.handle('settings:chooseDownloadDir', () => chooseDownloadDir())
  ipcMain.handle('settings:chooseLocalResourcesDir', () => chooseLocalResourcesDir())
  ipcMain.handle('settings:chooseExportDir', () => chooseExportDir())
  ipcMain.handle('settings:chooseMockMediaDir', () => chooseMockMediaDir())
  ipcMain.handle('mock:start', (_event, s?: Partial<AppSettings>) => startMockServer(s))
  ipcMain.handle('mock:stop', () => stopMockServer())
  ipcMain.handle('mock:status', () => getMockStatus())
  ipcMain.handle('cache:stats', () => getCacheStats())
  ipcMain.handle('cache:clear', () => clearCache())
}
