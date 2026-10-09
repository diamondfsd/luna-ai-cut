import { ipcMain } from 'electron'
import {
  clearLogs,
  exportDiagnosticsBundle,
  getLogDir,
  logExport,
  logMainError,
  logMainInfo,
  logMainWarn,
  logRendererMessage,
} from '../infrastructure/loggerService'

export function register(): void {
  ipcMain.on('log:renderer', (_event, level: string, message: string, meta?: unknown) => {
    logRendererMessage(level, message, meta)
  })
  ipcMain.on('log:main', (_event, level: string, message: string, meta?: unknown) => {
    if (level === 'error') logMainError(message, meta)
    else if (level === 'warn') logMainWarn(message, meta)
    else logMainInfo(message, meta)
  })
  ipcMain.handle('log:export', (_event, message: string, meta?: unknown) => {
    logExport('INFO', message, meta)
    return true
  })
  ipcMain.handle('log:getDir', () => getLogDir())
  ipcMain.handle('log:export-bundle', () => exportDiagnosticsBundle())
  ipcMain.handle('log:clear', () => clearLogs())
}
