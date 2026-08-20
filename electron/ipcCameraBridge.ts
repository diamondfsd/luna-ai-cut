import { BrowserWindow, ipcMain } from 'electron'

import { cameraBridgeReceiver } from './cameraBridgeReceiver'
import { macVirtualCamera } from './macVirtualCamera'

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
    macVirtualCamera.writeFrame(frame)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('camera-bridge:frame', frame)
    }
  })
  ipcMain.handle('camera-bridge:start', () => cameraBridgeReceiver.start())
  ipcMain.handle('camera-bridge:stop', () => cameraBridgeReceiver.stop())
  ipcMain.handle('camera-bridge:status', () => cameraBridgeReceiver.getStatus())
  macVirtualCamera.subscribe((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('camera-bridge:virtual-status', status)
    }
  })
  ipcMain.handle('camera-bridge:virtual-start', () => macVirtualCamera.start())
  ipcMain.handle('camera-bridge:virtual-stop', () => macVirtualCamera.stop())
  ipcMain.handle('camera-bridge:virtual-status', () => macVirtualCamera.getStatus())
  ipcMain.on('camera-bridge:virtual-subscribe', (event) => {
    event.sender.send('camera-bridge:virtual-status', macVirtualCamera.getStatus())
  })
  ipcMain.on('camera-bridge:subscribe', (event) => {
    event.sender.send('camera-bridge:status', cameraBridgeReceiver.getStatus())
  })
}
