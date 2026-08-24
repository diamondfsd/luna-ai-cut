import { ipcMain } from 'electron'
import { clearLogs, getLogDir, logExport } from '../infrastructure/loggerService'

export function register(): void {
  ipcMain.handle('log:export', (_event, message: string, meta?: unknown) => {
    logExport('INFO', message, meta)
    return true
  })
  ipcMain.handle('log:getDir', () => getLogDir())
  ipcMain.handle('log:clear', () => clearLogs())
}
