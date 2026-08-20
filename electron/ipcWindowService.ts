import { app, BrowserWindow, ipcMain } from 'electron'

const attachedWindows = new WeakSet<BrowserWindow>()

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

export function register(): void {
  app.on('browser-window-created', (_event, window) => attachFullScreenEvents(window))
  for (const window of BrowserWindow.getAllWindows()) attachFullScreenEvents(window)

  ipcMain.handle('window:set-fullscreen', (event, enabled: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed() || !window.isFullScreenable()) return
    window.setFullScreen(enabled)
  })
}
