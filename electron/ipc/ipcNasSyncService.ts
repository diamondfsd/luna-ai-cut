import { ipcMain } from 'electron'

import { nasSyncService } from '../media/nasSyncService'
import type { IpcContext } from './context'

export function register(ctx: IpcContext): void {
  nasSyncService.setProgressListener((status) => {
    ctx.win?.webContents.send('nas-sync:progress', status)
  })
  void nasSyncService.initialize()

  ipcMain.handle('nas-sync:status', () => nasSyncService.getStatus())
  ipcMain.handle('nas-sync:set-debug-mode', (_event, enabled: unknown) => nasSyncService.setDebugMode(enabled === true))
  ipcMain.handle('nas-sync:get-debug-local-root', () => nasSyncService.getDebugLocalRoot())
  ipcMain.handle('nas-sync:probe', (_event, config) => nasSyncService.probe(config))
  ipcMain.handle('nas-sync:list-files', () => nasSyncService.listFiles())
  ipcMain.handle('nas-sync:sync-files', (_event, filePaths: unknown) => {
    if (!Array.isArray(filePaths)) throw new Error('请选择要同步的文件')
    return nasSyncService.enqueueFiles(filePaths.filter((value): value is string => typeof value === 'string'))
  })
  ipcMain.handle('nas-sync:sync-local-resources', () => nasSyncService.syncLocalResources())
  ipcMain.handle('nas-sync:retry-failed', () => nasSyncService.retryFailed())
  ipcMain.handle('nas-sync:cancel-pending', () => nasSyncService.cancelPending())
}
