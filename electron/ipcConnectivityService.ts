import { BrowserWindow, ipcMain } from 'electron'
import type { LunaFile, WifiConnectOptions, WifiHttpRequestOptions, WifiPortCheckOptions } from '../src/shared/types'
import { cancelBluetoothScan, scanBluetoothDevices } from './bluetoothDebugService'
import {
  checkWifiPort,
  connectWifiNetwork,
  disconnectWifiNetwork,
  getWifiDebugStatus,
  requestWifiHttp,
  scanWifiNetworks,
} from './wifiDebugService'
import { openWifiSettings } from './wifiService'
import { getDownloadedRecords, getLocalResourcesDir, getSettings } from './fileService'
import { collectLunaNetworkDiagnostics } from './networkDiagnostics'

export function register(): void {
  ipcMain.handle('downloads:records', async (_event, files: LunaFile[]) => {
    const settings = await getSettings()
    return getDownloadedRecords(files, getLocalResourcesDir(settings), settings.organizeDownloadsByDate ?? false)
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
