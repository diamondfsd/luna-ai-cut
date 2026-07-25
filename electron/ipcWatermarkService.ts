import { ipcMain } from 'electron'

import { chooseCustomWatermark } from './customWatermarkService'

export function register(): void {
  ipcMain.handle('watermark:chooseCustom', () => chooseCustomWatermark())
}
