import { app, BrowserWindow, ipcMain, screen, type Rectangle } from 'electron'
import type { LiveWindowResolution } from '../../src/shared/types/liveStream'
import { liveWindowContentSize } from '../application/liveWindowSizing'

const attachedWindows = new WeakSet<BrowserWindow>()
const liveWindowStates = new WeakMap<BrowserWindow, {
  bounds: Rectangle
  minimumSize: [number, number]
  wasResizable: boolean
  wasMaximizable: boolean
  wasMaximized: boolean
  wasBackgroundThrottling: boolean
}>()

function restoreLiveWindow(window: BrowserWindow, notifyRenderer = true): void {
  const state = liveWindowStates.get(window)
  if (!state || window.isDestroyed()) return

  liveWindowStates.delete(window)
  if (notifyRenderer) window.webContents.send('window:live-mode-ended')
  if (!window.webContents.isDestroyed()) {
    window.webContents.setBackgroundThrottling(state.wasBackgroundThrottling)
  }
  window.setResizable(state.wasResizable)
  window.setMaximizable(state.wasMaximizable)
  window.setMinimumSize(...state.minimumSize)
  window.setBounds(state.bounds)
  if (state.wasMaximized) window.maximize()
}

function setLiveWindow(window: BrowserWindow, resolution: LiveWindowResolution, sourceAspectRatio?: number): void {
  if (!liveWindowStates.has(window)) {
    const wasMaximized = window.isMaximized()
    if (wasMaximized) window.unmaximize()

    const bounds = window.getBounds()
    const minimumSize = window.getMinimumSize()
    liveWindowStates.set(window, {
      bounds,
      minimumSize: [minimumSize[0], minimumSize[1]],
      wasResizable: window.isResizable(),
      wasMaximizable: window.isMaximizable(),
      wasMaximized,
      wasBackgroundThrottling: window.webContents.backgroundThrottling,
    })
  }

  window.webContents.setBackgroundThrottling(false)
  const display = screen.getDisplayMatching(window.getBounds())
  const size = liveWindowContentSize(resolution, display.workArea, sourceAspectRatio)
  window.setResizable(false)
  window.setMaximizable(false)
  window.setMinimumSize(0, 0)
  window.setContentSize(size.width, size.height)

  const nextBounds = window.getBounds()
  const { workArea } = display
  window.setPosition(
    Math.round(workArea.x + (workArea.width - nextBounds.width) / 2),
    Math.round(workArea.y + (workArea.height - nextBounds.height) / 2),
  )
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
  window.on('close', () => restoreLiveWindow(window))
  window.webContents.on('render-process-gone', () => restoreLiveWindow(window, false))
  window.once('closed', () => {
    attachedWindows.delete(window)
    liveWindowStates.delete(window)
  })
}

export function register(): void {
  app.on('browser-window-created', (_event, window) => attachFullScreenEvents(window))
  for (const window of BrowserWindow.getAllWindows()) attachFullScreenEvents(window)

  ipcMain.handle('window:set-fullscreen', (event, enabled: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed() || !window.isFullScreenable()) return
    window.setFullScreen(enabled)
  })

  ipcMain.handle('window:control', (event, action: 'minimize' | 'toggle-maximize' | 'close') => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return
    if (action === 'minimize' && window.isMinimizable()) window.minimize()
    if (action === 'toggle-maximize' && window.isMaximizable()) {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    }
    if (action === 'close') window.close()
  })

  ipcMain.handle('window:set-live-mode', (event, enabled: boolean, resolution?: LiveWindowResolution, sourceAspectRatio?: number) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return

    if (enabled) {
      if (resolution !== '720p') {
        throw new Error('不支持的窗口尺寸')
      }
      setLiveWindow(window, resolution, sourceAspectRatio)
    } else {
      restoreLiveWindow(window)
    }
  })
}
