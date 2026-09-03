import { ipcMain } from 'electron'
import { clearLogs, exportDiagnosticsBundle, getLogDir, logExport } from '../infrastructure/loggerService'

export function register(): void {
  ipcMain.handle('log:export', (_event, message: string, meta?: unknown) => {
    logExport('INFO', message, meta)
    return true
  })
  ipcMain.handle('log:getDir', () => getLogDir())
  ipcMain.handle('log:export-bundle', () => exportDiagnosticsBundle())
  ipcMain.handle('log:clear', () => clearLogs())
}
