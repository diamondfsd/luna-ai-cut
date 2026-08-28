import type { BrowserWindow } from 'electron'
import { WebBluetoothDjiBleTransport } from './djiWebBluetoothTransport'

export class WindowsDjiBleTransport extends WebBluetoothDjiBleTransport {
  constructor(deviceId: string, win: BrowserWindow | null) {
    super(deviceId, win)
  }
}

export function createWindowsDjiBleTransport(deviceId: string, win: BrowserWindow | null): WindowsDjiBleTransport | null {
  return process.platform === 'win32' && win ? new WindowsDjiBleTransport(deviceId, win) : null
}
