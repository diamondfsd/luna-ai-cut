import { ipcMain } from 'electron'

import { chooseCustomWatermarks, deleteCustomWatermark, listCustomWatermarks } from './customWatermarkService'

export function register(): void {
  ipcMain.handle('watermark:chooseCustom', () => chooseCustomWatermarks())
  ipcMain.handle('watermark:listCustom', () => listCustomWatermarks())
  ipcMain.handle('watermark:deleteCustom', (_event, assetId: string) => deleteCustomWatermark(assetId))
}
