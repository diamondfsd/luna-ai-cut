import { ipcRenderer, contextBridge } from 'electron'
import type {
  AiConfig,
  AppSettings,
  DeviceConnectOptions,
  DownloadProgress,
  ExportProgress,
  LunaApi,
  LunaFile,
  UpdateInfo,
  VideoExportSettings,
  WatermarkSettings,
  WifiConnectOptions,
  WifiDebugApi,
  WifiHttpRequestOptions,
  WifiPortCheckOptions,
} from '../src/shared/types'

const lunaApi: LunaApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  chooseDownloadDir: () => ipcRenderer.invoke('settings:chooseDownloadDir'),
  chooseExportDir: () => ipcRenderer.invoke('settings:chooseExportDir'),
  chooseMockMediaDir: () => ipcRenderer.invoke('settings:chooseMockMediaDir'),
  startMockServer: (settings?: Partial<AppSettings>) => ipcRenderer.invoke('mock:start', settings),
  stopMockServer: () => ipcRenderer.invoke('mock:stop'),
  getMockServerStatus: () => ipcRenderer.invoke('mock:status'),
  getCacheStats: () => ipcRenderer.invoke('cache:stats'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  openWifiSettings: () => ipcRenderer.invoke('wifi:openSettings'),
  openDevTools: () => ipcRenderer.invoke('devtools:open'),
  scanBluetoothDevices: (timeoutMs?: number) => ipcRenderer.invoke('bluetooth:scanNative', timeoutMs),
  cancelBluetoothScan: () => ipcRenderer.invoke('bluetooth:cancelScan'),
  connectDevice: (options?: DeviceConnectOptions) => ipcRenderer.invoke('device:connect', options),
  checkConnection: (host?: string) => ipcRenderer.invoke('luna:checkConnection', host),
  listFiles: (host?: string, storageId?: string) => ipcRenderer.invoke('luna:listFiles', host, storageId),
  listSampleFiles: () => ipcRenderer.invoke('luna:listSampleFiles'),
  listDownloadedFiles: (downloadDir?: string) => ipcRenderer.invoke('downloads:listFiles', downloadDir),
  listExportFiles: (exportDir?: string) => ipcRenderer.invoke('exports:listFiles', exportDir),
  previewFile: (file: LunaFile, files: LunaFile[]) => ipcRenderer.invoke('luna:previewFile', file, files),
  previewLivePhoto: (file: LunaFile) => ipcRenderer.invoke('luna:previewLivePhoto', file),
  getMediaMetadata: (file: LunaFile, cachedPath?: string | null) => ipcRenderer.invoke('luna:metadata', file, cachedPath),
  previewWithWatermark: (file: LunaFile, sourcePath: string, settings: WatermarkSettings) =>
    ipcRenderer.invoke('luna:previewWithWatermark', file, sourcePath, settings),
  requestVideoFrameRate: (file: LunaFile, cachedPath?: string | null) =>
    ipcRenderer.invoke('luna:requestVideoFrameRate', file, cachedPath),
  downloadFiles: (files: LunaFile[], downloadDir?: string) => ipcRenderer.invoke('luna:downloadFiles', files, downloadDir),
  cancelDownloads: () => ipcRenderer.invoke('luna:cancelDownloads'),
  exportFiles: (files: Array<{ name: string; kind: string; localPath?: string }>, exportDir: string, watermarkSettings: WatermarkSettings, videoExportSettings?: VideoExportSettings) =>
    ipcRenderer.invoke('luna:exportFiles', files, exportDir, watermarkSettings, videoExportSettings),
  cancelExports: () => ipcRenderer.invoke('luna:cancelExports'),
  getDownloadedRecords: (files: LunaFile[], downloadDir?: string) => ipcRenderer.invoke('downloads:records', files, downloadDir),
  revealFile: (filePath: string) => ipcRenderer.invoke('files:reveal', filePath),
  openPath: (targetPath: string) => ipcRenderer.invoke('files:openPath', targetPath),
  deleteLocalFiles: (filePaths: string[]) => ipcRenderer.invoke('files:deleteLocal', filePaths),
  aiChat: (config: AiConfig, systemPrompt: string, messages: Array<{ role: string; content: string }>) =>
    ipcRenderer.invoke('ai:chat', config, systemPrompt, messages),
  disconnect: (host?: string) => ipcRenderer.invoke('luna:disconnect', host),
  cacheFile: (file: LunaFile) => ipcRenderer.invoke('luna:cacheFile', file),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgress): void => callback(progress)
    ipcRenderer.on('download:progress', listener)
    return () => ipcRenderer.off('download:progress', listener)
  },
  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ExportProgress): void => callback(progress)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.off('export:progress', listener)
  },
  onConnectionLost: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('luna:connection-lost', listener)
    return () => ipcRenderer.off('luna:connection-lost', listener)
  },
  onThumbnailReady: (callback: (data: { fileId: string; fileName?: string; downloadName?: string; cacheFilePath: string; thumbnailUrl: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { fileId: string; fileName?: string; downloadName?: string; cacheFilePath: string; thumbnailUrl: string },
    ): void => callback(data)
    ipcRenderer.on('luna:thumbnail-ready', listener)
    return () => ipcRenderer.off('luna:thumbnail-ready', listener)
  },
  onVideoFrameRateReady: (callback: (data: { fileId: string; fileName: string; frameRate: number | null; duration?: number | null }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { fileId: string; fileName: string; frameRate: number | null; duration?: number | null },
    ): void => callback(data)
    ipcRenderer.on('luna:video-frame-rate-ready', listener)
    return () => ipcRenderer.off('luna:video-frame-rate-ready', listener)
  },
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: UpdateInfo): void => callback(info)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.off('update:available', listener)
  },
  listReleaseNotes: () => ipcRenderer.invoke('release-notes:list'),
}

const wifiDebugApi: WifiDebugApi = {
  getStatus: () => ipcRenderer.invoke('wifiDebug:getStatus'),
  scan: () => ipcRenderer.invoke('wifiDebug:scan'),
  connect: (options: WifiConnectOptions) => ipcRenderer.invoke('wifiDebug:connect', options),
  disconnect: () => ipcRenderer.invoke('wifiDebug:disconnect'),
  checkPort: (options: WifiPortCheckOptions) => ipcRenderer.invoke('wifiDebug:checkPort', options),
  httpRequest: (options: WifiHttpRequestOptions) => ipcRenderer.invoke('wifiDebug:httpRequest', options),
}

contextBridge.exposeInMainWorld('luna', lunaApi)
if (import.meta.env.DEV || process.env.VITE_DEV_SERVER_URL) {
  contextBridge.exposeInMainWorld('wifiDebug', wifiDebugApi)
}
