import { ipcMain } from 'electron'

import { cameraMediaSourceFor } from '../devices/common/cameraMediaSourceService'
import { chooseMountedCameraVolume, detectMountedCameraVolumes } from '../devices/common/mountedCameraMediaSource'
import { saveSettings } from '../storage/settingsService'
import type { IpcContext } from './context'
import type { CameraMediaSourceOptions, LunaFile } from '../../src/shared/types'

export function register(ctx: IpcContext): void {
  ipcMain.handle('camera-source:detect-mounted', () => detectMountedCameraVolumes())
  ipcMain.handle('camera-source:choose-mounted', async () => {
    const volume = await chooseMountedCameraVolume()
    if (volume) await saveSettings({ cameraConnectionMode: 'wired', mountedCameraRoot: volume.rootPath })
    return volume
  })
  ipcMain.handle('camera-source:connect', (_event, options: CameraMediaSourceOptions) => (
    cameraMediaSourceFor(ctx, options).connect()
  ))
  ipcMain.handle('camera-source:prepare-connection', async (_event, options: CameraMediaSourceOptions) => {
    const source = cameraMediaSourceFor(ctx, options)
    if (!source.prepareConnection) {
      return { mode: options.mode, message: '当前设备可以直接使用已连接的网络' }
    }
    return source.prepareConnection()
  })
  ipcMain.handle('camera-source:check', (_event, options: CameraMediaSourceOptions) => (
    cameraMediaSourceFor(ctx, options).check()
  ))
  ipcMain.handle('camera-source:list-files', (_event, options: CameraMediaSourceOptions) => (
    cameraMediaSourceFor(ctx, options).listFiles()
  ))
  ipcMain.handle('camera-source:delete-files', (_event, files: LunaFile[], options: CameraMediaSourceOptions) => (
    cameraMediaSourceFor(ctx, options).deleteFiles(files)
  ))
  ipcMain.handle('camera-source:disconnect', (_event, options: CameraMediaSourceOptions) => (
    cameraMediaSourceFor(ctx, options).disconnect()
  ))
}
