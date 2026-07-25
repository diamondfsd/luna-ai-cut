import { ipcMain } from 'electron'

import { chooseCustomWatermarks } from './customWatermarkService'

export function register(): void {
  ipcMain.handle('watermark:chooseCustom', () => chooseCustomWatermarks())
}
