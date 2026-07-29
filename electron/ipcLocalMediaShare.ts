import { ipcMain } from 'electron'

import {
  getLocalMediaShareStatus,
  listLocalMediaShareNetworks,
  startLocalMediaShare,
  stopLocalMediaShare,
} from './localMediaShareService'
import type { LocalMediaShareStartOptions } from '../src/shared/types/localMediaShare'

export function register(): void {
  ipcMain.handle('local-media-share:list-networks', () => listLocalMediaShareNetworks())
  ipcMain.handle('local-media-share:status', () => getLocalMediaShareStatus())
  ipcMain.handle('local-media-share:start', (_event, options: LocalMediaShareStartOptions) => startLocalMediaShare(options))
  ipcMain.handle('local-media-share:stop', () => stopLocalMediaShare())
}
