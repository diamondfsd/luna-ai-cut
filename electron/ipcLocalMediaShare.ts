import { ipcMain } from 'electron'

import {
  getLocalMediaShareStatus,
  startLocalMediaShare,
  stopLocalMediaShare,
} from './localMediaShareService'

export function register(): void {
  ipcMain.handle('local-media-share:status', () => getLocalMediaShareStatus())
  ipcMain.handle('local-media-share:start', () => startLocalMediaShare())
  ipcMain.handle('local-media-share:stop', () => stopLocalMediaShare())
}
