import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { HotUpdateCheckResult } from './hotUpdater'
import { applyHotUpdate, checkForHotUpdates, clearHotUpdate, getCurrentHotVersion } from './hotUpdater'
import type { IpcContext } from './ipcContext'
import { logMainError, logMainInfo } from './loggerService'
import { listReleaseNotes } from './releaseNotesService'
import { checkForUpdates } from './updateService'

export function register(ctx: IpcContext): void {
  ipcMain.handle('update:check', async () => {
    const fullInfo = await checkForUpdates()
    if (fullInfo) return fullInfo

    const hotInfo = await checkForHotUpdates()
    if (hotInfo && ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('hot-update:available', hotInfo)
    }
    return null
  })

  ipcMain.handle('hot-update:current-version', () => {
    return getCurrentHotVersion()
  })

  ipcMain.handle('hot-update:check', async (): Promise<HotUpdateCheckResult | null> => {
    return checkForHotUpdates()
  })

  ipcMain.handle('hot-update:apply', async (_event, info: HotUpdateCheckResult): Promise<{ success: boolean; error?: string }> => {
    try {
      logMainInfo(`开始应用热更新: ${info.version}, 下载地址: ${info.downloadUrl}`)
      await applyHotUpdate(info)
      const appliedVersion = getCurrentHotVersion()
      logMainInfo(`热更新应用完成, 本地版本: ${appliedVersion}`)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logMainError(`热更新应用失败: ${message}`)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('hot-update:clear', () => {
    clearHotUpdate()
  })

  ipcMain.handle('hot-update:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('release-notes:list', async (): Promise<Array<{ version: string; content: string }>> => {
    try {
      const bundledRoot = app.isPackaged ? process.resourcesPath : app.getAppPath()
      const searchRoots = app.isPackaged
        ? [join(app.getPath('userData'), '.luna-hot'), bundledRoot]
        : [bundledRoot]
      return listReleaseNotes(searchRoots)
    } catch {
      return []
    }
  })
}
