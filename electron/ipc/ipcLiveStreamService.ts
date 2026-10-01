import { app, ipcMain } from 'electron'
import { cancelAppleDriverInstall, installAppleDriver } from '../media/live-stream/appleDeviceSupportService'

import {
  getLiveStreamStatus,
  sendLiveStreamControlCommand,
  startLiveStreamCapture,
  startLiveStream,
  stopLiveStream,
  stopLiveStreamCapture,
} from '../media/live-stream/liveStreamService'
import type { LiveStreamControlCommand } from '../../src/shared/types'

export function register(): void {
  app.on('before-quit', cancelAppleDriverInstall)
  ipcMain.handle('live-stream:install-apple-driver', () => installAppleDriver())
  ipcMain.handle('live-stream:status', () => getLiveStreamStatus())
  ipcMain.handle('live-stream:start', () => startLiveStream())
  ipcMain.handle('live-stream:start-capture', () => startLiveStreamCapture())
  ipcMain.handle('live-stream:stop-capture', () => stopLiveStreamCapture())
  ipcMain.handle('live-stream:send-control', (_event, command: LiveStreamControlCommand) => (
    sendLiveStreamControlCommand(command)
  ))
  ipcMain.handle('live-stream:stop', () => stopLiveStream())
}
