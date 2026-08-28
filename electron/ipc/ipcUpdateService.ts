import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { HotUpdateCheckResult } from '../infrastructure/hotUpdater'
import { applyHotUpdate, checkForHotUpdates, clearHotUpdate, getCurrentHotVersion } from '../infrastructure/hotUpdater'
import { logMainError, logMainInfo } from '../infrastructure/loggerService'
import { listReleaseNotes } from '../infrastructure/releaseNotesService'
import { checkForUpdates } from '../infrastructure/updateService'

export function register(): void {
  ipcMain.handle('update:check', async () => {
    logMainInfo('[更新] 用户手动检查完整更新')
    try {
      const result = await checkForUpdates()
      logMainInfo('[更新] 完整更新检查完成', { available: Boolean(result), version: result?.version })
      return result
    } catch (error) {
      logMainError('[更新] 完整更新检查失败', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })

  ipcMain.handle('hot-update:current-version', () => {
    return getCurrentHotVersion()
  })

  ipcMain.handle('hot-update:check', async (): Promise<HotUpdateCheckResult | null> => {
    logMainInfo('[热更新] 用户手动检查')
    try {
      const result = await checkForHotUpdates()
      logMainInfo('[热更新] 手动检查完成', { available: Boolean(result), version: result?.version })
      return result
    } catch (error) {
      logMainError('[热更新] 手动检查失败', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
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
