import { ipcMain } from 'electron'

import { cameraVideoStreamFor } from '../devices/common/cameraVideoStreamService'
import type { IpcContext } from './context'
import type { CameraVideoStreamOptions } from '../../src/shared/types'

export function register(ctx: IpcContext): void {
  ipcMain.handle('camera-video-stream:start', (_event, options: CameraVideoStreamOptions) => (
    cameraVideoStreamFor(ctx, options).start()
  ))
  ipcMain.handle('camera-video-stream:stop', (_event, options: CameraVideoStreamOptions) => (
    cameraVideoStreamFor(ctx, options).stop()
  ))
  ipcMain.handle('camera-video-stream:status', (_event, options: CameraVideoStreamOptions) => (
    cameraVideoStreamFor(ctx, options).status()
  ))
}
