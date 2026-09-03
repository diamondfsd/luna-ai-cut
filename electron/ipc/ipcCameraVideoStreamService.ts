import { ipcMain } from 'electron'

import { cameraVideoStreamFor, startCameraObsVideoStream, stopCameraObsVideoStream } from '../devices/common/cameraVideoStreamService'
import type { IpcContext } from './context'
import type { CameraVideoStreamOptions } from '../../src/shared/types'

export function register(ctx: IpcContext): void {
  ipcMain.handle('camera-video-stream:start', (_event, options: CameraVideoStreamOptions) => (
    cameraVideoStreamFor(ctx, options).start()
  ))
  ipcMain.handle('camera-video-stream:stop', (_event, options: CameraVideoStreamOptions) => (
    cameraVideoStreamFor(ctx, options).stop()
  ))
  ipcMain.handle('camera-video-stream:start-obs', (_event, options: CameraVideoStreamOptions) => (
    startCameraObsVideoStream(ctx, options)
  ))
  ipcMain.handle('camera-video-stream:stop-obs', (_event, options: CameraVideoStreamOptions) => (
    stopCameraObsVideoStream(ctx, options)
  ))
  ipcMain.handle('camera-video-stream:status', (_event, options: CameraVideoStreamOptions) => (
    cameraVideoStreamFor(ctx, options).status()
  ))
}
