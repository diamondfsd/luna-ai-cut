import { app, ipcMain } from 'electron'
import { cancelAppleDriverInstall, installAppleDriver, startAppleService } from '../media/live-stream/appleDeviceSupportService'

import {
  getLiveStreamStatus,
  setAndroidConnectionMode,
  sendLiveStreamControlCommand,
  startLiveStreamCapture,
  startLiveStream,
  stopLiveStream,
  stopLiveStreamCapture,
} from '../media/live-stream/liveStreamService'
import type { AndroidConnectionMode, LiveConnectionDebugTarget, LiveStreamControlCommand } from '../../src/shared/types'
import { diagnoseLiveConnection } from '../media/live-stream/liveConnectionDebugService'

export function register(): void {
  app.on('before-quit', cancelAppleDriverInstall)
  ipcMain.handle('live-stream:start-apple-service', () => startAppleService())
  ipcMain.handle('live-stream:install-apple-driver', () => installAppleDriver())
  ipcMain.handle('live-stream:set-android-mode', (_event, mode: AndroidConnectionMode) => setAndroidConnectionMode(mode))
  ipcMain.handle('live-stream:status', () => getLiveStreamStatus())
  ipcMain.handle('live-stream:diagnose-connection', async (_event, target: LiveConnectionDebugTarget) => {
    if (target !== 'ios' && target !== 'android-adb' && target !== 'harmony-hdc') {
      throw new Error('不支持的手机连接方式')
    }
    const status = await getLiveStreamStatus()
    return diagnoseLiveConnection(target, status)
  })
  ipcMain.handle('live-stream:start', () => startLiveStream())
  ipcMain.handle('live-stream:start-capture', () => startLiveStreamCapture())
  ipcMain.handle('live-stream:stop-capture', () => stopLiveStreamCapture())
  ipcMain.handle('live-stream:send-control', (_event, command: LiveStreamControlCommand) => (
    sendLiveStreamControlCommand(command)
  ))
  ipcMain.handle('live-stream:stop', () => stopLiveStream())
}
