import { ipcMain } from 'electron'

import { logMainError, logMainInfo, logMainWarn } from './loggerService'

export function register(): void {
  ipcMain.on(
    'ai-editing:log',
    (_event, level: string, event: string, details?: Record<string, unknown>) => {
      const message = `[AI Editing] ${event}`
      if (level === 'error') {
        console.error(message, details ?? '')
        logMainError(message, details)
      } else if (level === 'warn') {
        console.warn(message, details ?? '')
        logMainWarn(message, details)
      } else {
        console.info(message, details ?? '')
        logMainInfo(message, details)
      }
    },
  )
}
