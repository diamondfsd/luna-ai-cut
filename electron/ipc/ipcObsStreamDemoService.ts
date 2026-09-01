import { app, ipcMain } from 'electron'

import {
  getObsStreamDemoStatus,
  startObsStreamDemo,
  stopObsStreamDemo,
} from '../media/obs-demo/obsMp4StreamService'

export function register(): void {
  if (app.isPackaged) return

  ipcMain.handle('obs-stream-demo:status', () => getObsStreamDemoStatus())
  ipcMain.handle('obs-stream-demo:start', () => startObsStreamDemo())
  ipcMain.handle('obs-stream-demo:stop', () => stopObsStreamDemo())
}
