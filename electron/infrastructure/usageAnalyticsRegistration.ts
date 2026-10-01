import { app, ipcMain, type BrowserWindow } from 'electron'
import { logMainInfo, logMainWarn } from './loggerService'
import { createUsageAnalytics } from './usageAnalytics'
import { createLiveUsageAnalytics } from './liveUsageAnalytics'
import { setLiveUsageAnalytics } from '../media/live-stream/liveStreamService'
import { isLivePreviewUsageSource } from '../ipc/ipcWindowService'

export function createAppUsageAnalytics() {
  const analytics = createUsageAnalytics({
    enabled: !process.env.LUNA_E2E_USER_DATA_DIR,
    userData: app.getPath('userData'),
    appVersion: process.env.LUNA_BOOT_SOURCE?.startsWith('hot-update:')
      ? process.env.LUNA_BOOT_SOURCE.slice('hot-update:'.length)
      : app.getVersion(),
    osName: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform,
    osVersion: process.getSystemVersion(),
    arch: process.arch,
    environment: app.isPackaged ? 'production' : 'development',
    onResult: (result) => {
      const message = `[PostHog] ${result.success ? '上报成功' : '上报失败'}`
      if (result.success) logMainInfo(message, result)
      else logMainWarn(message, result)
      if (!app.isPackaged) console.info(message, result)
    },
  })
  const liveUsage = createLiveUsageAnalytics(properties => analytics.liveSummary(properties))
  setLiveUsageAnalytics(liveUsage)
  return {
    opened: analytics.opened,
    register(getWindow: () => BrowserWindow | null) {
      const trusted = (event: Electron.IpcMainEvent) => {
        const window = getWindow()
        return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
      }
      ipcMain.on('usage:page-opened', (event, page: unknown) => {
        if (trusted(event)) void analytics.pageOpened(page)
      })
      ipcMain.on('usage:live', (event, message: unknown) => {
        if (trusted(event)) liveUsage.message(message)
        else if (isLivePreviewUsageSource(event)) liveUsage.message(message, 'preview')
      })
    },
  }
}
