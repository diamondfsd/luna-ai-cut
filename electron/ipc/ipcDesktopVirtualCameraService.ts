import { ipcMain } from 'electron'

import {
  getDesktopVirtualCameraStatus,
  installDesktopVirtualCameraHost,
  openDesktopVirtualCameraSettings,
  revealDesktopVirtualCameraSource,
  startDesktopVirtualCamera,
  stopDesktopVirtualCamera,
} from '../media/desktop-virtual-camera/desktopVirtualCameraService'
import type { DesktopVirtualCameraOptions } from '../../src/shared/types'

export function register(): void {
  ipcMain.handle('desktop-virtual-camera:status', () => getDesktopVirtualCameraStatus())
  ipcMain.handle('desktop-virtual-camera:install', () => installDesktopVirtualCameraHost())
  ipcMain.handle('desktop-virtual-camera:start', (_event, options: DesktopVirtualCameraOptions) => (
    startDesktopVirtualCamera(options)
  ))
  ipcMain.handle('desktop-virtual-camera:stop', () => stopDesktopVirtualCamera())
  ipcMain.handle('desktop-virtual-camera:open-extension-settings', () => openDesktopVirtualCameraSettings())
  ipcMain.handle('desktop-virtual-camera:reveal-install-source', () => revealDesktopVirtualCameraSource())
}
