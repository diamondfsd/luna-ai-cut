import { ipcRenderer, contextBridge } from 'electron'
import type {
  AiConfig,
  AppSettings,
  DeviceDebugApi,
  DeviceDebugEvent,
  DeviceConnectOptions,
  DownloadProgress,
  ExportFileInput,
  ExportProgress,
  HotUpdateCheckResult,
  LunaApi,
  LunaFile,
  NetworkDiagnosticsResult,
  WorkspaceMediaAsset,
  WorkspaceProject,
  UpdateInfo,
  VideoExportSettings,
  WatermarkSettings,
  WifiConnectOptions,
  WifiDebugApi,
  WifiHttpRequestOptions,
  WifiPortCheckOptions,
  ExportTaskRecord,
} from '../src/shared/types'

interface ExportItemInput {
  id: string
  sourcePath: string
  outputPath: string
}

interface ExportItemUpdate {
  progress?: number
  status?: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  error?: string
  destinationPath?: string
}

interface LunaExportTaskApi {
  create(name: string, items?: ExportItemInput[], taskId?: string): Promise<ExportTaskRecord>
  addItems(taskId: string, items: ExportItemInput[]): Promise<void>
  updateItem(taskId: string, itemId: string, data: ExportItemUpdate): Promise<void>
  cancel(taskId: string): Promise<void>
  get(taskId: string): Promise<ExportTaskRecord | undefined>
  list(): Promise<ExportTaskRecord[]>
  clear(): Promise<void>
}

const lunaApi: LunaApi & { exportTask: LunaExportTaskApi } = {
  // 日志
  log: (level: string, message: string, meta?: unknown) => {
    ipcRenderer.send('log:renderer', level, message, meta)
  },
  logExport: (message: string, meta?: unknown) => {
    return ipcRenderer.invoke('log:export', message, meta)
  },
  getLogDir: () => ipcRenderer.invoke('log:getDir'),
  clearLogs: () => ipcRenderer.invoke('log:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  chooseDownloadDir: () => ipcRenderer.invoke('settings:chooseDownloadDir'),
  chooseLocalResourcesDir: () => ipcRenderer.invoke('settings:chooseLocalResourcesDir'),
  chooseExportDir: () => ipcRenderer.invoke('settings:chooseExportDir'),
  chooseLutDir: () => ipcRenderer.invoke('settings:chooseLutDir'),
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
  previewLivePhoto: (sourceUrl: string) => ipcRenderer.invoke('luna:previewLivePhoto', sourceUrl),
  resolveThumbnail: (filePath: string, kind?: string) => ipcRenderer.invoke('luna:resolveThumbnail', filePath, kind),
  getMediaMetadata: (file: LunaFile, cachedPath?: string | null) => ipcRenderer.invoke('luna:metadata', file, cachedPath),
  getMediaMetadataByPath: (filePath: string) => ipcRenderer.invoke('luna:metadataByPath', filePath),
  previewWithWatermark: (file: LunaFile, sourcePath: string, settings: WatermarkSettings) =>
    ipcRenderer.invoke('luna:previewWithWatermark', file, sourcePath, settings),
  requestVideoFrameRate: (file: LunaFile, cachedPath?: string | null) =>
    ipcRenderer.invoke('luna:requestVideoFrameRate', file, cachedPath),
  downloadFiles: (files: LunaFile[], downloadDir?: string) => ipcRenderer.invoke('luna:downloadFiles', files, downloadDir),
  cancelDownloads: () => ipcRenderer.invoke('luna:cancelDownloads'),
  exportFiles: (files: ExportFileInput[], exportDir: string, watermarkSettings: WatermarkSettings, videoExportSettings?: VideoExportSettings) =>
    ipcRenderer.invoke('luna:exportFiles', files, exportDir, watermarkSettings, videoExportSettings),
  cancelExports: () => ipcRenderer.invoke('luna:cancelExports'),
  cancelExportTask: (taskId: string) => ipcRenderer.invoke('lrc:cancelExportTask', taskId),
  getExportTasks: () => ipcRenderer.invoke('export-task:list'),
  getExportTask: (taskId: string) => ipcRenderer.invoke('export-task:get', taskId),
  clearExportTasks: () => ipcRenderer.invoke('export-task:clear'),
  getDownloadedRecords: (files: LunaFile[], downloadDir?: string) => ipcRenderer.invoke('downloads:records', files, downloadDir),
  revealFile: (filePath: string) => ipcRenderer.invoke('files:reveal', filePath),
  openPath: (targetPath: string) => ipcRenderer.invoke('files:openPath', targetPath),
  openPhotosApp: () => ipcRenderer.invoke('files:openPhotosApp'),
  deleteLocalFiles: (filePaths: string[]) => ipcRenderer.invoke('files:deleteLocal', filePaths),
  aiChat: (config: AiConfig, systemPrompt: string, messages: Array<{ role: string; content: string }>) =>
    ipcRenderer.invoke('ai:chat', config, systemPrompt, messages),
  readExifModel: (localPath: string) => ipcRenderer.invoke('luna:readExifModel', localPath),
  getWatermarkPath: (style: string, kind: 'image' | 'video') => ipcRenderer.invoke('luna:getWatermarkPath', style, kind) as Promise<{ filePath: string; width: number; height: number }>,
  getBorderLogoPath: (logoId: string) => ipcRenderer.invoke('luna:getBorderLogoPath', logoId) as Promise<string>,
  disconnect: (host?: string) => ipcRenderer.invoke('luna:disconnect', host),
  getWifiStatus: () => ipcRenderer.invoke('wifiDebug:getStatus'),
  collectNetworkDiagnostics: () => ipcRenderer.invoke('luna:collectNetworkDiagnostics') as Promise<NetworkDiagnosticsResult>,
  scanWifi: () => ipcRenderer.invoke('wifiDebug:scan'),
  connectWifi: (options: WifiConnectOptions) => ipcRenderer.invoke('wifiDebug:connect', options),
  disconnectWifi: () => ipcRenderer.invoke('wifiDebug:disconnect'),
  cacheFile: (params: { sourceUrl: string; previewUrl?: string | null }) => ipcRenderer.invoke('luna:cacheFile', params),
  workspace: {
    loadPreview: (filePath: string) => ipcRenderer.invoke('workspace:loadPreview', filePath),
    getMediaResolution: (filePath: string) => ipcRenderer.invoke('workspace:getMediaResolution', filePath),
    isLivePhoto: (filePath: string) => ipcRenderer.invoke('workspace:isLivePhoto', filePath),
    readColorMetadata: (filePath: string) => ipcRenderer.invoke('workspace:readColorMetadata', filePath),
    listProjects: () => ipcRenderer.invoke('workspace:listProjects'),
    createProject: (name: string, assets: WorkspaceMediaAsset[]) => ipcRenderer.invoke('workspace:createProject', name, assets),
    addAssetsToProject: (projectId: string, assets: WorkspaceMediaAsset[]) => ipcRenderer.invoke('workspace:addAssetsToProject', projectId, assets),
    saveProject: (project: WorkspaceProject) => ipcRenderer.invoke('workspace:saveProject', project),
    deleteProject: (projectId: string) => ipcRenderer.invoke('workspace:deleteProject', projectId),
    renameProject: (projectId: string, newName: string) => ipcRenderer.invoke('workspace:renameProject', projectId, newName),
    extractVideoFrame: (videoPath: string, outputPath: string, frameTime: number) => ipcRenderer.invoke('workspace:extractVideoFrame', videoPath, outputPath, frameTime),
    exportRenderedLivePhoto: (name: string, imagePath: string, videoPath: string, appleLivePhoto: boolean, preserveInputs?: boolean) => ipcRenderer.invoke('workspace:exportRenderedLivePhoto', name, imagePath, videoPath, appleLivePhoto, preserveInputs),
    copyFile: (sourcePath: string) => ipcRenderer.invoke('workspace:copyFile', sourcePath),
    listColorPresets: () => ipcRenderer.invoke('workspace:listColorPresets'),
    saveColorPreset: (name: string, colorJson: string) => ipcRenderer.invoke('workspace:saveColorPreset', name, colorJson),
    deleteColorPreset: (id: string) => ipcRenderer.invoke('workspace:deleteColorPreset', id),
    renameColorPreset: (id: string, newName: string) => ipcRenderer.invoke('workspace:renameColorPreset', id, newName),
  },
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

  // ── 导出任务记录（统一 API） ──
  exportTask: {
    create: (name: string, items?: ExportItemInput[], taskId?: string) => ipcRenderer.invoke('export-task:create', name, items, taskId),
    addItems: (taskId: string, items: ExportItemInput[]) => ipcRenderer.invoke('export-task:add-items', taskId, items),
    updateItem: (taskId: string, itemId: string, data: ExportItemUpdate) => ipcRenderer.invoke('export-task:update-item', taskId, itemId, data),
    cancel: (taskId: string) => ipcRenderer.invoke('export-task:cancel', taskId),
    get: (taskId: string) => ipcRenderer.invoke('export-task:get', taskId),
    list: () => ipcRenderer.invoke('export-task:list'),
    clear: () => ipcRenderer.invoke('export-task:clear'),
  },

  // ── 热更新 ──
  getHotUpdateVersion: () => ipcRenderer.invoke('hot-update:current-version'),
  checkForHotUpdates: () => ipcRenderer.invoke('hot-update:check'),
  applyHotUpdate: (info: HotUpdateCheckResult) => ipcRenderer.invoke('hot-update:apply', info),
  clearHotUpdate: () => ipcRenderer.invoke('hot-update:clear'),
  relaunchApp: () => ipcRenderer.invoke('hot-update:relaunch'),
  onHotUpdateAvailable: (callback: (info: HotUpdateCheckResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: HotUpdateCheckResult): void => callback(info)
    ipcRenderer.on('hot-update:available', listener)
    return () => ipcRenderer.off('hot-update:available', listener)
  },
}

const wifiDebugApi: WifiDebugApi = {
  getStatus: () => ipcRenderer.invoke('wifiDebug:getStatus'),
  scan: () => ipcRenderer.invoke('wifiDebug:scan'),
  connect: (options: WifiConnectOptions) => ipcRenderer.invoke('wifiDebug:connect', options),
  disconnect: () => ipcRenderer.invoke('wifiDebug:disconnect'),
  checkPort: (options: WifiPortCheckOptions) => ipcRenderer.invoke('wifiDebug:checkPort', options),
  httpRequest: (options: WifiHttpRequestOptions) => ipcRenderer.invoke('wifiDebug:httpRequest', options),
}

const deviceDebugApi: DeviceDebugApi = {
  runTest: (params) => ipcRenderer.invoke('deviceDebug:runTest', params),
  checkPort: (params) => ipcRenderer.invoke('deviceDebug:checkPort', params),
  connect: (params) => ipcRenderer.invoke('deviceDebug:connect', params),
  disconnect: (params) => ipcRenderer.invoke('deviceDebug:disconnect', params),
  checkAuth: (params) => ipcRenderer.invoke('deviceDebug:checkAuth', params),
  requestAuth: (params) => ipcRenderer.invoke('deviceDebug:requestAuth', params),
  getAuthState: (params) => ipcRenderer.invoke('deviceDebug:getAuthState', params),
  listFiles: (params) => ipcRenderer.invoke('deviceDebug:listFiles', params),
  runDiagnostics: (params) => ipcRenderer.invoke('deviceDebug:runDiagnostics', params),
  getDeviceOptions: () => ipcRenderer.invoke('deviceDebug:getDeviceOptions'),
  log: (params) => ipcRenderer.invoke('deviceDebug:log', params),
  getLogPath: () => ipcRenderer.invoke('deviceDebug:getLogPath'),
  onLog: (callback: (event: DeviceDebugEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: DeviceDebugEvent): void => callback(data)
    ipcRenderer.on('deviceDebug:log', listener)
    return () => ipcRenderer.off('deviceDebug:log', listener)
  },
}

interface CompositionInput {
  version?: number
  canvas: { width: number; height: number; fps?: number; duration?: number }
  layers: Array<{
    id?: string
    source: {
      path: string
      sourceType?: string
      time?: { offset?: number; start?: number; duration?: number; loopEnabled?: boolean }
    }
    rect: { x: number; y: number; w: number; h: number }
    fit?: string
    opacity?: number
    zIndex?: number
    color?: unknown
    transform?: unknown
    positioning?: unknown
  }>
}

const lunaRenderCoreApi = {
  init: () => ipcRenderer.invoke('lrc:init'),
  loadTexture: (data: Buffer, width: number, height: number) =>
    ipcRenderer.invoke('lrc:loadTexture', data, width, height),
  updateTexture: (textureId: number, data: Buffer) =>
    ipcRenderer.invoke('lrc:updateTexture', textureId, data),
  renderFrame: (canvasWidth: number, canvasHeight: number, layers: any[]) =>
    ipcRenderer.invoke('lrc:renderFrame', canvasWidth, canvasHeight, layers),
  releaseTexture: (textureId: number) =>
    ipcRenderer.invoke('lrc:releaseTexture', textureId),
  renderCompositionFrame: (composition: CompositionInput, time: number, maxSide?: number) =>
    ipcRenderer.invoke('lrc:renderCompositionFrame', composition, time, maxSide),
  renderCompositionFrameAsync: (composition: CompositionInput, time: number, maxSide?: number) =>
    ipcRenderer.invoke('lrc:renderCompositionFrameAsync', composition, time, maxSide),
  exportCompositionVideo: (
    outputPath: string,
    composition: CompositionInput,
    fps: number | null,
    duration: number | null,
    hardware: boolean,
    taskId?: string,
    qualityPreset?: string,
    exportTaskId?: string,
    exportItemId?: string,
  ) => ipcRenderer.invoke('lrc:exportCompositionVideo', outputPath, composition, fps, duration, hardware, taskId, qualityPreset, exportTaskId, exportItemId),
  cancelExportTask: (taskId: string) => ipcRenderer.invoke('lrc:cancelExportTask', taskId),
  getExportTaskProgress: (taskId: string) => ipcRenderer.invoke('lrc:getExportTaskProgress', taskId),
  resolveRenderSource: (originalPath: string, cacheDir: string) => ipcRenderer.invoke('lrc:resolveRenderSource', originalPath, cacheDir),
  exportCompositionImage: (
    outputPath: string,
    composition: CompositionInput,
    format: string,
    quality: number,
    exportTaskId?: string,
    exportItemId?: string,
  ) => ipcRenderer.invoke('lrc:exportCompositionImage', outputPath, composition, format, quality, exportTaskId, exportItemId),
  listCubeFiles: (dirPath: string) => ipcRenderer.invoke('lrc:listCubeFiles', dirPath),
  importCubeFile: (sourcePath: string, categoryName: string, lutDir: string, targetName?: string, meta?: { name?: string; description?: string }) =>
    ipcRenderer.invoke('lrc:importCubeFile', sourcePath, categoryName, lutDir, targetName, meta),
  deleteCubeFile: (cubePath: string, isBuiltin?: boolean) =>
    ipcRenderer.invoke('lrc:deleteCubeFile', cubePath, isBuiltin),
}

contextBridge.exposeInMainWorld('luna', lunaApi)
contextBridge.exposeInMainWorld('lunaRenderCore', lunaRenderCoreApi)
contextBridge.exposeInMainWorld('deviceDebug', deviceDebugApi)
if (import.meta.env.DEV || process.env.VITE_DEV_SERVER_URL) {
  contextBridge.exposeInMainWorld('wifiDebug', wifiDebugApi)
}
