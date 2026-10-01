import { app, BrowserWindow, ipcMain, screen } from 'electron'
import path from 'node:path'
import type { LivePreviewWindowSettings, LiveWindowResolution } from '../../src/shared/types/liveStream'
import type { IpcContext } from './context'
import { liveWindowContentSize } from '../application/liveWindowSizing'

const attachedWindows = new WeakSet<BrowserWindow>()
let livePreviewWindow: BrowserWindow | null = null
let livePreviewOwner: BrowserWindow | null = null
let livePreviewSettings: LivePreviewWindowSettings | null = null

export function isLivePreviewUsageSource(event: Electron.IpcMainEvent): boolean {
  return Boolean(livePreviewWindow && !livePreviewWindow.isDestroyed()
    && event.sender === livePreviewWindow.webContents
    && event.senderFrame === livePreviewWindow.webContents.mainFrame)
}

function resizeLivePreviewWindow(window: BrowserWindow, sourceAspectRatio: number): void {
  const display = screen.getDisplayMatching(window.getBounds())
  const size = liveWindowContentSize('720p', display.workArea, sourceAspectRatio)
  window.setContentSize(size.width, size.height)

  const bounds = window.getBounds()
  window.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
    Math.round(display.workArea.y + (display.workArea.height - bounds.height) / 2),
  )
}

async function openLivePreviewWindow(owner: BrowserWindow, aspectRatio = 16 / 9): Promise<void> {
  if (livePreviewWindow && !livePreviewWindow.isDestroyed()) {
    resizeLivePreviewWindow(livePreviewWindow, aspectRatio)
    livePreviewWindow.focus()
    return
  }

  const display = screen.getDisplayMatching(owner.getBounds())
  const size = liveWindowContentSize('720p', display.workArea, aspectRatio)
  const appRoot = process.env.APP_ROOT ?? app.getAppPath()
  const window = new BrowserWindow({
    x: Math.round(display.workArea.x + (display.workArea.width - size.width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - size.height) / 2),
    width: size.width,
    height: size.height,
    title: 'Luna直播投屏专用窗口',
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { roundedCorners: false } : {}),
    webPreferences: {
      preload: path.join(appRoot, 'dist-electron', 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  livePreviewWindow = window
  livePreviewOwner = owner
  window.on('page-title-updated', (event) => event.preventDefault())
  window.webContents.setBackgroundThrottling(false)
  window.once('closed', () => {
    const previousOwner = livePreviewOwner
    livePreviewWindow = null
    livePreviewOwner = null
    if (previousOwner && !previousOwner.isDestroyed() && !previousOwner.webContents.isDestroyed()) {
      previousOwner.webContents.send('window:live-mode-ended')
    }
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  try {
    if (devServerUrl) {
      await window.loadURL(new URL('#/live-preview-window', devServerUrl).toString())
    } else {
      await window.loadFile(path.join(appRoot, 'dist', 'index.html'), { hash: '/live-preview-window' })
    }
  } catch (error) {
    if (!window.isDestroyed()) window.close()
    throw error
  }
  if (!window.isDestroyed()) window.show()
}

function closeLivePreviewWindow(): void {
  if (livePreviewWindow && !livePreviewWindow.isDestroyed()) livePreviewWindow.close()
}

function notifyFullScreenState(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.send('window:fullscreen-changed', window.isFullScreen())
  }
}

function attachFullScreenEvents(window: BrowserWindow): void {
  if (attachedWindows.has(window)) return
  attachedWindows.add(window)

  const notify = () => notifyFullScreenState(window)
  window.on('enter-full-screen', notify)
  window.on('leave-full-screen', notify)
  window.once('closed', () => attachedWindows.delete(window))
}

export function register(context: IpcContext): void {
  app.on('browser-window-created', (_event, window) => attachFullScreenEvents(window))
  for (const window of BrowserWindow.getAllWindows()) attachFullScreenEvents(window)

  ipcMain.handle('window:set-fullscreen', (event, enabled: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed() || !window.isFullScreenable()) return
    window.setFullScreen(enabled)
  })

  ipcMain.handle('window:set-live-mode', async (event, enabled: boolean, resolution?: LiveWindowResolution, sourceAspectRatio?: number) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.isDestroyed() || owner !== context.win) return

    if (enabled) {
      if (resolution !== '720p') throw new Error('不支持的窗口尺寸')
      await openLivePreviewWindow(owner, sourceAspectRatio)
    } else {
      closeLivePreviewWindow()
    }
  })

  ipcMain.on('live-preview-window:update-settings', (event, settings: LivePreviewWindowSettings) => {
    if (event.sender !== context.win?.webContents) return
    livePreviewSettings = settings
    if (livePreviewWindow && !livePreviewWindow.isDestroyed()) {
      livePreviewWindow.webContents.send('live-preview-window:settings', settings)
    }
  })

  ipcMain.handle('live-preview-window:get-settings', (event) => {
    if (event.sender !== livePreviewWindow?.webContents) return null
    return livePreviewSettings
  })

  ipcMain.handle('live-preview-window:resize', (event, sourceAspectRatio: number) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window !== livePreviewWindow || !Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0) return
    resizeLivePreviewWindow(window, sourceAspectRatio)
  })
}
