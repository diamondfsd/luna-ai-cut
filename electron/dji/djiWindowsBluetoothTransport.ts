import { getNativeScriptPath } from '../swiftUtils'
import { NativeDjiBleTransport } from './djiCoreBluetoothTransport'

export class WindowsDjiBleTransport extends NativeDjiBleTransport {
  constructor(deviceId: string) {
    super(deviceId, {
      platform: 'win32',
      executable: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'],
      scriptPath: getNativeScriptPath('djiWindowsBluetoothTransport.ps1'),
    })
  }
}

export function createWindowsDjiBleTransport(deviceId: string): WindowsDjiBleTransport | null {
  return process.platform === 'win32' ? new WindowsDjiBleTransport(deviceId) : null
}
