import { ipcMain } from 'electron'

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
  ipcMain.handle('live-stream:status', () => getLiveStreamStatus())
  ipcMain.handle('live-stream:start', () => startLiveStream())
  ipcMain.handle('live-stream:start-capture', () => startLiveStreamCapture())
  ipcMain.handle('live-stream:stop-capture', () => stopLiveStreamCapture())
  ipcMain.handle('live-stream:send-control', (_event, command: LiveStreamControlCommand) => (
    sendLiveStreamControlCommand(command)
  ))
  ipcMain.handle('live-stream:stop', () => stopLiveStream())
}
