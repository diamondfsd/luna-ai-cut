import { app, shell } from 'electron'
import { join } from 'node:path'
import { APPLE_DEVICE_SUPPORT_INSTALLER } from '../../../src/shared/appleDeviceSupport'
import type { AppleDeviceSupportState } from '../../../src/shared/types'
import { checkAppleDeviceSupport, verifyAppleInstallerSignature } from '../../platform/windows/appleDeviceSupport'
import { logMainWarn } from '../../infrastructure/loggerService'
import { downloadVerifiedFile } from '../resumableDownloadService'
import { AppleDriverInstaller } from './appleDriverInstaller'

const installer = new AppleDriverInstaller({
  platform: process.platform,
  arch: process.arch,
  definition: APPLE_DEVICE_SUPPORT_INSTALLER,
  destinationDir: () => join(app.getPath('userData'), 'drivers', APPLE_DEVICE_SUPPORT_INSTALLER.version),
  download: downloadVerifiedFile,
  verifySignature: verifyAppleInstallerSignature,
  openInstaller: (filePath) => shell.openPath(filePath),
  onError: (error) => logMainWarn('[iPhone USB] 驱动安装失败', {
    error: error instanceof Error ? error.message : String(error),
  }),
})

let supportCheck: Promise<AppleDeviceSupportState> | null = null
let checkedAt = 0

export function getAppleDeviceSupportStatus(): Promise<AppleDeviceSupportState> {
  if (process.platform !== 'win32' || process.arch !== 'x64') return Promise.resolve('not-required')
  if (!supportCheck || Date.now() - checkedAt >= 5_000) {
    checkedAt = Number.POSITIVE_INFINITY
    supportCheck = checkAppleDeviceSupport().finally(() => { checkedAt = Date.now() })
  }
  return supportCheck
}

export function getAppleDriverDownloadStatus() {
  return installer.status()
}

export function installAppleDriver(): Promise<void> {
  return installer.install()
}

export function cancelAppleDriverInstall(): void {
  installer.cancel()
}
