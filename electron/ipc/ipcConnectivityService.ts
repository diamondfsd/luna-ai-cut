import { BrowserWindow, ipcMain } from 'electron'
import type { LunaFile, WifiConnectOptions, WifiHttpRequestOptions, WifiPortCheckOptions } from '../../src/shared/types'
import { cancelBluetoothScan, scanBluetoothDevices } from '../platform/network/bluetoothDebugService'
import {
  checkWifiPort,
  connectWifiNetwork,
  disconnectWifiNetwork,
  getWifiDebugStatus,
  requestWifiHttp,
  scanWifiNetworks,
} from '../platform/network/wifiDebugService'
import { openWifiSettings } from '../platform/network/wifiService'
import { getDownloadedRecords, getLocalResourcesDir, getSettings } from '../storage/fileService'
import path from 'node:path'
import { collectLunaNetworkDiagnostics } from '../platform/network/networkDiagnostics'
import { registerDjiWebBluetoothIpc } from '../devices/dji/djiWebBluetoothTransport'
import { registerLunaWebBluetoothIpc } from '../devices/insta360/lunaBleWebBluetoothTransport'

export function register(): void {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    registerDjiWebBluetoothIpc()
    registerLunaWebBluetoothIpc()
  }
  ipcMain.handle('downloads:records', async (_event, files: LunaFile[], targetDir?: unknown) => {
    const settings = await getSettings()
    const requestedTargetDir = targetDir === undefined || targetDir === null || targetDir === ''
      ? null
      : typeof targetDir === 'string' && path.isAbsolute(targetDir.trim())
        ? path.resolve(targetDir.trim())
        : (() => { throw new Error('目标目录无效') })()
    const roots = requestedTargetDir
      ? [requestedTargetDir]
      : [...new Set([
          getLocalResourcesDir(settings),
          ...(settings.downloadDirectories ?? []).filter((directory) => path.isAbsolute(directory)),
        ].map((directory) => path.resolve(directory)))]
    const records = await Promise.all(roots.map((root) => getDownloadedRecords(
      files,
      root,
      requestedTargetDir ? false : settings.organizeDownloadsByDate ?? false,
    )))
    const byFileName = new Map<string, import('../../src/shared/types').DownloadRecord>()
    for (const batch of records) {
      for (const record of batch) {
        if (!byFileName.has(record.fileName)) byFileName.set(record.fileName, record)
      }
    }
    return [...byFileName.values()]
  })

  ipcMain.handle('wifi:openSettings', () => openWifiSettings())
  ipcMain.handle('wifiDebug:getStatus', () => getWifiDebugStatus())

  if (process.platform === 'win32') {
    ipcMain.handle('wifiDebug:scan', () => scanWifiNetworks())
    ipcMain.handle('wifiDebug:connect', (_event, options: WifiConnectOptions) => connectWifiNetwork(options))
    ipcMain.handle('wifiDebug:disconnect', () => disconnectWifiNetwork())
    ipcMain.handle('wifiDebug:checkPort', (_event, options: WifiPortCheckOptions) => checkWifiPort(options))
    ipcMain.handle('wifiDebug:httpRequest', (_event, options: WifiHttpRequestOptions) => requestWifiHttp(options))
  }

  ipcMain.handle('bluetooth:scanNative', async (_event, timeoutMs?: number) => {
    const result = await scanBluetoothDevices(timeoutMs)
    if (!result.success) throw new Error(result.message)
    return result.data ?? []
  })

  ipcMain.handle('bluetooth:cancelScan', () => {
    cancelBluetoothScan()
  })

  ipcMain.handle('luna:collectNetworkDiagnostics', (_event, host?: string) => collectLunaNetworkDiagnostics(host))

  ipcMain.handle('devtools:open', () => {
    BrowserWindow.getFocusedWindow()?.webContents.openDevTools({ mode: 'detach' })
  })
}
