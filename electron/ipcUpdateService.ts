import { app, ipcMain } from 'electron'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HotUpdateCheckResult } from './hotUpdater'
import { applyHotUpdate, checkForHotUpdates, clearHotUpdate, getCurrentHotVersion } from './hotUpdater'
import type { IpcContext } from './ipcContext'
import { logMainError, logMainInfo } from './loggerService'
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
    const notesDir = app.isPackaged
      ? join(process.resourcesPath)
      : join(app.getAppPath())
    const prefix = 'RELEASE_NOTES_v'
    try {
      const files = readdirSync(notesDir)
        .filter((file) => file.startsWith(prefix) && file.endsWith('.md'))

      files.sort((a, b) => {
        const va = a.match(/(\d+)\.(\d+)\.(\d+)/)
        const vb = b.match(/(\d+)\.(\d+)\.(\d+)/)
        if (!va || !vb) return b.localeCompare(a)
        for (let i = 1; i <= 3; i += 1) {
          const diff = Number(vb[i]) - Number(va[i])
          if (diff !== 0) return diff
        }
        return 0
      })

      return files.slice(0, 5).map((file) => {
        const version = file.slice(prefix.length, -'.md'.length)
        const content = readFileSync(join(notesDir, file), 'utf-8')
        return { version, content }
      })
    } catch {
      return []
    }
  })
}
