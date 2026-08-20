import { BrowserWindow, ipcMain } from 'electron'

import { cameraBridgeReceiver } from './cameraBridgeReceiver'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  cameraBridgeReceiver.subscribe((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('camera-bridge:status', status)
    }
  })
  cameraBridgeReceiver.subscribeFrame((frame) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('camera-bridge:frame', frame)
    }
  })
  ipcMain.handle('camera-bridge:start', () => cameraBridgeReceiver.start())
  ipcMain.handle('camera-bridge:stop', () => cameraBridgeReceiver.stop())
  ipcMain.handle('camera-bridge:status', () => cameraBridgeReceiver.getStatus())
  ipcMain.on('camera-bridge:subscribe', (event) => {
    event.sender.send('camera-bridge:status', cameraBridgeReceiver.getStatus())
  })
}
