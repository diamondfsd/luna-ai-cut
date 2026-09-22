import { ipcMain } from 'electron'

import {
  getDesktopVirtualCameraStatus,
  installDesktopVirtualCameraHost,
  openDesktopVirtualCameraSettings,
  revealDesktopVirtualCameraSource,
  setDesktopVirtualCameraAudioDelay,
  setDesktopVirtualCameraAudioMonitor,
  setDesktopVirtualCameraAudioSource,
  sendDesktopControlCommand,
  sendDesktopVirtualCameraAudioFrame,
  startDesktopVirtualCamera,
  startDesktopVirtualCameraOutput,
  stopDesktopVirtualCamera,
  stopDesktopVirtualCameraOutput,
} from '../media/desktop-virtual-camera/desktopVirtualCameraService'
import type {
  DesktopAudioInputFrame,
  DesktopAudioSourceMode,
  DesktopControlCommand,
  DesktopVirtualCameraOptions,
} from '../../src/shared/types'

export function register(): void {
  ipcMain.handle('desktop-virtual-camera:status', () => getDesktopVirtualCameraStatus())
  ipcMain.handle('desktop-virtual-camera:install', () => installDesktopVirtualCameraHost())
  ipcMain.handle('desktop-virtual-camera:start', (_event, options: DesktopVirtualCameraOptions) => (
    startDesktopVirtualCamera(options)
  ))
  ipcMain.handle('desktop-virtual-camera:start-output', () => startDesktopVirtualCameraOutput())
  ipcMain.handle('desktop-virtual-camera:stop-output', () => stopDesktopVirtualCameraOutput())
  ipcMain.handle('desktop-virtual-camera:set-audio-delay', (_event, delayMs: number) => (
    setDesktopVirtualCameraAudioDelay(delayMs)
  ))
  ipcMain.handle('desktop-virtual-camera:set-audio-monitor', (event, enabled: boolean) => (
    setDesktopVirtualCameraAudioMonitor(Boolean(enabled), event.sender)
  ))
  ipcMain.handle('desktop-virtual-camera:set-audio-source', (_event, source: DesktopAudioSourceMode) => (
    setDesktopVirtualCameraAudioSource(source)
  ))
  ipcMain.handle('desktop-virtual-camera:send-audio-frame', (_event, frame: DesktopAudioInputFrame) => (
    sendDesktopVirtualCameraAudioFrame(frame)
  ))
  ipcMain.handle('desktop-virtual-camera:send-control', (_event, command: DesktopControlCommand) => (
    sendDesktopControlCommand(command)
  ))
  ipcMain.handle('desktop-virtual-camera:stop', () => stopDesktopVirtualCamera())
  ipcMain.handle('desktop-virtual-camera:open-extension-settings', () => openDesktopVirtualCameraSettings())
  ipcMain.handle('desktop-virtual-camera:reveal-install-source', () => revealDesktopVirtualCameraSource())
}
