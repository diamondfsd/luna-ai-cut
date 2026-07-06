import { BrowserWindow, ipcMain } from 'electron'
import type { LunaFile, WifiConnectOptions, WifiHttpRequestOptions, WifiPortCheckOptions } from '../src/shared/types'
import { cancelBluetoothScan, scanBluetoothDevices } from './bluetoothDebugService'
import { scanUsbDevices } from './usbDeviceService'
import { scanUsbStorageDevices } from './usbStorageService'
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

export function register(): void {
  ipcMain.handle('downloads:records', async (_event, files: LunaFile[]) => {
    const settings = await getSettings()
    return getDownloadedRecords(files, getLocalResourcesDir(settings))
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
    return scanBluetoothDevices(timeoutMs)
  })

  ipcMain.handle('bluetooth:cancelScan', () => {
    cancelBluetoothScan()
  })

  ipcMain.handle('usb:scan', async () => {
    const [devices, storageDevices] = await Promise.all([
      scanUsbDevices().catch(() => []),
      scanUsbStorageDevices().catch(() => []),
    ])
    return [...devices, ...storageDevices]
  })

  ipcMain.handle('devtools:open', () => {
    BrowserWindow.getFocusedWindow()?.webContents.openDevTools({ mode: 'detach' })
  })
}
