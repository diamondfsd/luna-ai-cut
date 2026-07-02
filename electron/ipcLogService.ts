import { ipcMain } from 'electron'
import { clearLogs, getLogDir, logExport } from './loggerService'
import type { IpcContext } from './ipcContext'

export function register(_ctx?: IpcContext): void {
  ipcMain.handle('log:export', (_event, message: string, meta?: unknown) => {
    logExport('INFO', message, meta)
    return true
  })
  ipcMain.handle('log:getDir', () => getLogDir())
  ipcMain.handle('log:clear', () => clearLogs())
}
