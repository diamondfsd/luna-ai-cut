import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Shared lookup for detection, forwarding and pairing tools. */
export function iosUsbToolBinary(tool: 'iproxy' | 'idevice_id' | 'idevicepair'): string | null {
  const windows = process.platform === 'win32'
  const name = `${tool}${windows ? '.exe' : ''}`
  const platformDirectory = windows ? 'win-x64' : `darwin-${process.arch}`
  const supported = windows || process.platform === 'darwin'
  // Installed applications must not pick up development resources from cwd.
  if (supported && process.resourcesPath && !process.defaultApp) {
    const bundled = join(process.resourcesPath, 'ios-usb', name)
    return existsSync(bundled) ? bundled : null
  }
  const candidates = [
    ...(supported && process.resourcesPath ? [join(process.resourcesPath, 'ios-usb', name)] : []),
    ...(supported ? [join(process.cwd(), 'resources', 'ios-usb', platformDirectory, name)] : []),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}
