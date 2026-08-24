import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { activateMainWindow } from './windowService'

interface AppTrayOptions {
  iconPath: string
  getMainWindow: () => BrowserWindow | null
  createMainWindow: () => void
}

let appTray: Tray | null = null

function createTrayIcon(iconPath: string): Electron.NativeImage {
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) {
    const size = process.platform === 'darwin' ? 18 : 16
    const resized = icon.resize({ width: size, height: size })
    if (process.platform === 'darwin') resized.setTemplateImage(true)
    return resized
  }
  return nativeImage.createEmpty()
}

function openMainWindow(options: AppTrayOptions): void {
  const mainWindow = options.getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    activateMainWindow(mainWindow)
    return
  }
  options.createMainWindow()
}

export function createAppTray(options: AppTrayOptions): void {
  if (appTray && !appTray.isDestroyed()) return

  appTray = new Tray(createTrayIcon(options.iconPath))
  appTray.setToolTip('Luna AI Cut')
  appTray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '打开 Luna AI Cut',
      click: () => openMainWindow(options),
    },
    { type: 'separator' },
    {
      label: '退出 Luna AI Cut',
      click: () => app.quit(),
    },
  ]))
  appTray.on('click', () => openMainWindow(options))
}

export function destroyAppTray(): void {
  if (!appTray || appTray.isDestroyed()) {
    appTray = null
    return
  }
  appTray.destroy()
  appTray = null
}
