import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import type { WindowCloseBehavior } from '../../src/shared/types'

let appQuitting = false
let windowCloseBehavior: WindowCloseBehavior = 'hide'

app.on('before-quit', () => {
  appQuitting = true
})

export function setMainWindowCloseBehavior(behavior: WindowCloseBehavior | undefined): void {
  windowCloseBehavior = behavior === 'hide' ? 'hide' : 'quit'
}

export function getMainWindowCloseBehavior(): WindowCloseBehavior {
  return windowCloseBehavior
}

interface MainWindowOptions {
  devServerUrl: string | undefined
  iconPath: string
  preloadPath: string
  rendererDist: string
  hasActiveDownloads: () => boolean
  hasActiveExports: () => boolean
  abortDownloads: () => void
  abortExports: () => void
  getWindowCloseBehavior: () => WindowCloseBehavior
}

export function activateMainWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  let forceQuitAfterTaskCancel = false
  const win = new BrowserWindow({
    title: 'Luna AI Cut',
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    fullscreenable: true,
    show: false,
    icon: options.iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  // 阻止 HTML <title> 覆盖通过 win.setTitle() 设置的窗口标题
  win.on('page-title-updated', (event) => {
    event.preventDefault()
  })

  win.once('ready-to-show', () => activateMainWindow(win))

  win.on('close', (event) => {
    const hasDownloadTasks = options.hasActiveDownloads()
    const hasExportTasks = options.hasActiveExports()
    if (forceQuitAfterTaskCancel) return

    if (!hasDownloadTasks && !hasExportTasks) {
      if (!appQuitting && options.getWindowCloseBehavior() === 'hide') {
        event.preventDefault()
        win.hide()
      }
      return
    }

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

export function appTrayIconPath(appRoot: string): string {
  if (process.platform === 'darwin') {
    if (app.isPackaged) return path.join(process.resourcesPath, 'tray-template.png')
    return path.join(appRoot, 'build', 'tray-template.png')
  }
  if (app.isPackaged) return path.join(process.resourcesPath, 'icon.png')
  return path.join(appRoot, 'build', 'icon.png')
}
