import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'

interface MainWindowOptions {
  devServerUrl: string | undefined
  iconPath: string
  preloadPath: string
  rendererDist: string
  hasActiveDownloads: () => boolean
  hasActiveExports: () => boolean
  abortDownloads: () => void
  abortExports: () => void
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  let forceQuitAfterTaskCancel = false
  const win = new BrowserWindow({
    title: 'Luna AI Cut',
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    icon: options.iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  win.on('close', (event) => {
    const hasDownloadTasks = options.hasActiveDownloads()
    const hasExportTasks = options.hasActiveExports()
    if (forceQuitAfterTaskCancel || (!hasDownloadTasks && !hasExportTasks)) return

    event.preventDefault()
    const tasks = [
      hasDownloadTasks ? '下载任务' : null,
      hasExportTasks ? '导出任务' : null,
    ].filter(Boolean).join('和')
    const result = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['先不退出', '终止任务并退出'],
      defaultId: 0,
      cancelId: 0,
      title: '仍有任务正在进行',
      message: `当前还有${tasks}正在进行。`,
      detail: '退出前需要先终止这些任务，未完成的文件不会继续处理。',
      noLink: true,
    })
    if (result !== 1) return

    options.abortDownloads()
    options.abortExports()
    forceQuitAfterTaskCancel = true
    win.close()
  })

  if (options.devServerUrl) {
    win.loadURL(options.devServerUrl)
  } else {
    win.loadFile(path.join(options.rendererDist, 'index.html'))
  }

  return win
}

export function appIconPath(appRoot: string): string {
  const iconName = process.platform === 'darwin' ? 'icon.icns' : 'icon.png'
  if (app.isPackaged) return path.join(process.resourcesPath, iconName)
  return path.join(appRoot, 'build', iconName)
}
