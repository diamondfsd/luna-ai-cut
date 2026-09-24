import { ipcMain } from 'electron'

import {
  getLiveStreamStatus,
  sendLiveStreamAudioFrame,
  sendLiveStreamControlCommand,
  setLiveStreamAudioMonitor,
  setLiveStreamAudioSource,
  startLiveStream,
  startLiveStreamOutput,
  stopLiveStream,
  stopLiveStreamOutput,
} from '../media/live-stream/liveStreamService'
import type {
  LiveStreamAudioInputFrame,
  LiveStreamAudioSourceMode,
  LiveStreamControlCommand,
  LiveStreamOptions,
} from '../../src/shared/types'

export function register(): void {
  ipcMain.handle('live-stream:status', () => getLiveStreamStatus())
  ipcMain.handle('live-stream:start', () => startLiveStream())
  ipcMain.handle('live-stream:start-output', (_event, options: LiveStreamOptions) => (
    startLiveStreamOutput(options)
  ))
  ipcMain.handle('live-stream:stop-output', () => stopLiveStreamOutput())
  ipcMain.handle('live-stream:set-audio-monitor', (event, enabled: boolean) => (
    setLiveStreamAudioMonitor(Boolean(enabled), event.sender)
  ))
  ipcMain.handle('live-stream:set-audio-source', (_event, source: LiveStreamAudioSourceMode) => (
    setLiveStreamAudioSource(source)
  ))
  ipcMain.handle('live-stream:send-audio-frame', (_event, frame: LiveStreamAudioInputFrame) => (
    sendLiveStreamAudioFrame(frame)
  ))
  ipcMain.handle('live-stream:send-control', (_event, command: LiveStreamControlCommand) => (
    sendLiveStreamControlCommand(command)
  ))
  ipcMain.handle('live-stream:stop', () => stopLiveStream())
}
