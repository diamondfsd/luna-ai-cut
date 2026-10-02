import { parseHdcTargets } from './harmonyHdcClient.ts'
import type { RunAdb } from './androidAdbClient.ts'

// All transports keep detecting. Guard only the destructive Huawei USB-mode switch.
export async function canProbeUsbAccessory(vendorId: number, runHdc: RunAdb | null): Promise<boolean> {
  if (vendorId !== 0x12d1 || !runHdc) return true
  try {
    const devices = parseHdcTargets(await runHdc(['list', 'targets', '-v']))
    return !devices.some(device => device.state === 'device')
  } catch {
    // Failed discovery or stale records must not lock out other platforms.
    return true
  }
}
