import { ipcRenderer, contextBridge } from 'electron'
import type {
  AppSettings,
  DeviceDebugApi,
  DeviceDebugEvent,
  DeviceConnectOptions,
  DownloadProgress,
  DownloadOrganizationResult,
  ExportFileInput,
  ExportProgress,
  HotUpdateCheckResult,
  LunaApi,
  LunaFile,
  NetworkDiagnosticsResult,
  WorkspaceMediaAsset,
  WorkspaceProject,
  WorkspaceSegmentationRequest,
  WorkspaceMaskTrackingRequest,
  WorkspaceObjectRemovalRequest,
  UpdateInfo,
  VideoExportSettings,
  DolbyVisionWatermarkExportRequest,
  CustomWatermarkAsset,
  WatermarkSettings,
  WifiConnectOptions,
  WifiDebugApi,
  WifiHttpRequestOptions,
  WifiPortCheckOptions,
  ExportTaskRecord,
  OriginalFileExportRequest,
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
  startupReady: () => ipcRenderer.send('luna:startup-ready'),
  setFullScreen: (enabled: boolean) => ipcRenderer.invoke('window:set-fullscreen', enabled),
  onFullScreenChange: (callback: (isFullScreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isFullScreen: boolean): void => callback(isFullScreen)
    ipcRenderer.on('window:fullscreen-changed', listener)
    return () => ipcRenderer.off('window:fullscreen-changed', listener)
  },
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
  chooseBaseDir: () => ipcRenderer.invoke('settings:chooseBaseDir'),
  chooseLocalResourcesDir: () => ipcRenderer.invoke('settings:chooseLocalResourcesDir'),
  chooseExportDir: () => ipcRenderer.invoke('settings:chooseExportDir'),
  chooseLutDir: () => ipcRenderer.invoke('settings:chooseLutDir'),
  chooseMockMediaDir: () => ipcRenderer.invoke('settings:chooseMockMediaDir'),
  chooseCustomWatermarks: (): Promise<CustomWatermarkAsset[]> => ipcRenderer.invoke('watermark:chooseCustom'),
  listCustomWatermarks: (): Promise<CustomWatermarkAsset[]> => ipcRenderer.invoke('watermark:listCustom'),
  deleteCustomWatermark: (assetId: string): Promise<CustomWatermarkAsset[]> => ipcRenderer.invoke('watermark:deleteCustom', assetId),
  startMockServer: (deviceId?: string, settings?: Partial<AppSettings>) => ipcRenderer.invoke('mock:start', deviceId, settings),
  stopMockServer: (deviceId?: string) => ipcRenderer.invoke('mock:stop', deviceId),
  getMockServerStatus: (deviceId?: string) => ipcRenderer.invoke('mock:status', deviceId),
  getMockServerStatuses: () => ipcRenderer.invoke('mock:statuses'),
  getCacheStats: () => ipcRenderer.invoke('cache:stats'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  organizeDownloadedFiles: (): Promise<DownloadOrganizationResult> => ipcRenderer.invoke('downloads:organize'),
  migrateLocalStorage: () => ipcRenderer.invoke('storage:migrate'),
  listCustomLuts: () => ipcRenderer.invoke('settings:listCustomLuts'),
  deleteCustomLut: (filePath: string) => ipcRenderer.invoke('settings:deleteCustomLut', filePath),
  openWifiSettings: () => ipcRenderer.invoke('wifi:openSettings'),
  openDevTools: () => ipcRenderer.invoke('devtools:open'),
  scanBluetoothDevices: (timeoutMs?: number) => ipcRenderer.invoke('bluetooth:scanNative', timeoutMs),
  cancelBluetoothScan: () => ipcRenderer.invoke('bluetooth:cancelScan'),
  cameraSource: {
    detectMounted: () => ipcRenderer.invoke('camera-source:detect-mounted'),
    chooseMounted: () => ipcRenderer.invoke('camera-source:choose-mounted'),
    connect: (options) => ipcRenderer.invoke('camera-source:connect', options),
    prepareConnection: (options) => ipcRenderer.invoke('camera-source:prepare-connection', options),
    check: (options) => ipcRenderer.invoke('camera-source:check', options),
    listFiles: (options) => ipcRenderer.invoke('camera-source:list-files', options),
    deleteFiles: (files, options) => ipcRenderer.invoke('camera-source:delete-files', files, options),
    disconnect: (options) => ipcRenderer.invoke('camera-source:disconnect', options),
  },
  cameraVideoStream: {
    start: (options) => ipcRenderer.invoke('camera-video-stream:start', options),
    stop: (options) => ipcRenderer.invoke('camera-video-stream:stop', options),
    status: (options) => ipcRenderer.invoke('camera-video-stream:status', options),
  },
  connectDevice: (options?: DeviceConnectOptions) => ipcRenderer.invoke('device:connect', options),
  checkConnection: (host?: string) => ipcRenderer.invoke('luna:checkConnection', host),
  listFiles: (host?: string, storageId?: string) => ipcRenderer.invoke('luna:listFiles', host, storageId),
  deleteCameraFiles: (files: LunaFile[], host?: string) => ipcRenderer.invoke('luna:deleteCameraFiles', files, host),
  listSampleFiles: () => ipcRenderer.invoke('luna:listSampleFiles'),
  listDownloadedFiles: () => ipcRenderer.invoke('downloads:listFiles'),
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
  detectILog: (filePath: string) => ipcRenderer.invoke('luna:detectILog', filePath),
  downloadFiles: (files: LunaFile[]) => ipcRenderer.invoke('luna:downloadFiles', files),
  cancelDownloads: () => ipcRenderer.invoke('luna:cancelDownloads'),
  exportFiles: (files: ExportFileInput[], exportDir: string, watermarkSettings: WatermarkSettings, videoExportSettings?: VideoExportSettings) =>
    ipcRenderer.invoke('luna:exportFiles', files, exportDir, watermarkSettings, videoExportSettings),
  cancelExports: () => ipcRenderer.invoke('luna:cancelExports'),
  cancelExportTask: (taskId: string) => ipcRenderer.invoke('lrc:cancelExportTask', taskId),
  getExportTasks: () => ipcRenderer.invoke('export-task:list'),
  getExportTask: (taskId: string) => ipcRenderer.invoke('export-task:get', taskId),
  clearExportTasks: () => ipcRenderer.invoke('export-task:clear'),
  localMediaShare: {
    getStatus: () => ipcRenderer.invoke('local-media-share:status'),
    start: () => ipcRenderer.invoke('local-media-share:start'),
    stop: () => ipcRenderer.invoke('local-media-share:stop'),
    getDirectories: () => ipcRenderer.invoke('local-media-share:directories'),
    getEntries: () => ipcRenderer.invoke('local-media-share:entries'),
    chooseDirectories: () => ipcRenderer.invoke('local-media-share:choose-directories'),
    chooseFiles: () => ipcRenderer.invoke('local-media-share:choose-files'),
    removeDirectory: (directory: string) => ipcRenderer.invoke('local-media-share:remove-directory', directory),
    addFiles: (filePaths: string[]) => ipcRenderer.invoke('local-media-share:add-files', filePaths),
    removeFile: (filePath: string) => ipcRenderer.invoke('local-media-share:remove-file', filePath),
  },
  getDownloadedRecords: (files: LunaFile[]) => ipcRenderer.invoke('downloads:records', files),
  revealFile: (filePath: string) => ipcRenderer.invoke('files:reveal', filePath),
  openPath: (targetPath: string) => ipcRenderer.invoke('files:openPath', targetPath),
  startFileDrag: (filePaths: string[], thumbnailUrl?: string | null) => ipcRenderer.send('files:start-drag', filePaths, thumbnailUrl),
  copyFilesToDirectory: (filePaths: string[]) => ipcRenderer.invoke('files:copy-to-directory', filePaths),
  openPhotosApp: () => ipcRenderer.invoke('files:openPhotosApp'),
  deleteLocalFiles: (filePaths: string[]) => ipcRenderer.invoke('files:deleteLocal', filePaths),
  readExifModel: (localPath: string) => ipcRenderer.invoke('luna:readExifModel', localPath),
  getWatermarkPath: (style: string, kind: 'image' | 'video') => ipcRenderer.invoke('luna:getWatermarkPath', style, kind) as Promise<{ filePath: string; width: number; height: number }>,
  getBorderLogoPath: (logoId: string) => ipcRenderer.invoke('luna:getBorderLogoPath', logoId) as Promise<string>,
  disconnect: (host?: string) => ipcRenderer.invoke('luna:disconnect', host),
  getWifiStatus: () => ipcRenderer.invoke('wifiDebug:getStatus'),
  collectNetworkDiagnostics: (host?: string) => ipcRenderer.invoke('luna:collectNetworkDiagnostics', host) as Promise<NetworkDiagnosticsResult>,
  scanWifi: () => ipcRenderer.invoke('wifiDebug:scan'),
  connectWifi: (options: WifiConnectOptions) => ipcRenderer.invoke('wifiDebug:connect', options),
  disconnectWifi: () => ipcRenderer.invoke('wifiDebug:disconnect'),
  cacheFile: (params: { sourceUrl: string; previewUrl?: string | null }) => ipcRenderer.invoke('luna:cacheFile', params),
  workspace: {
    chooseMediaFiles: () => ipcRenderer.invoke('workspace:chooseMediaFiles'),
    loadTrimThumbnailCache: (videoPath: string, duration: number) => ipcRenderer.invoke('workspace:loadTrimThumbnailCache', videoPath, duration),
    saveTrimThumbnailCache: (videoPath: string, duration: number, bytes: ArrayBuffer) => ipcRenderer.invoke('workspace:saveTrimThumbnailCache', videoPath, duration, bytes),
    saveColorMask: (projectId: string, assetId: string, width: number, height: number, bytes: ArrayBuffer, feather: number) => ipcRenderer.invoke('workspace:saveColorMask', projectId, assetId, width, height, bytes, feather),
    loadColorMask: (projectId: string, filePath: string) => ipcRenderer.invoke('workspace:loadColorMask', projectId, filePath),
    deleteColorMask: (projectId: string, filePath: string) => ipcRenderer.invoke('workspace:deleteColorMask', projectId, filePath),
    cleanupColorMasks: (projectId: string, retainedPaths: string[]) => ipcRenderer.invoke('workspace:cleanupColorMasks', projectId, retainedPaths),
    loadPreview: (filePath: string) => ipcRenderer.invoke('workspace:loadPreview', filePath),
    loadFont: (filePath: string) => ipcRenderer.invoke('workspace:loadFont', filePath),
    loadLut: (filePath: string) => ipcRenderer.invoke('workspace:loadLut', filePath),
    getMediaFormatInfo: (filePath: string) => ipcRenderer.invoke('workspace:getMediaFormatInfo', filePath),
    getMediaResolution: (filePath: string) => ipcRenderer.invoke('workspace:getMediaResolution', filePath),
    getVideoDuration: (filePath: string) => ipcRenderer.invoke('workspace:getVideoDuration', filePath),
    probeDolbyVision: (filePath: string) => ipcRenderer.invoke('workspace:probeDolbyVision', filePath),
    exportDolbyVisionWatermark: (request: DolbyVisionWatermarkExportRequest) => ipcRenderer.invoke('workspace:exportDolbyVisionWatermark', request),
    isLivePhoto: (filePath: string) => ipcRenderer.invoke('workspace:isLivePhoto', filePath),
    readColorMetadata: (filePath: string) => ipcRenderer.invoke('workspace:readColorMetadata', filePath),
    getSegmentationModelStatus: (modelId: import('../src/shared/segmentationModels').SegmentationModelId) => ipcRenderer.invoke('workspace:getSegmentationModelStatus', modelId),
    prepareSegmentationModels: (modelIds: import('../src/shared/segmentationModels').SegmentationModelId[]) => ipcRenderer.invoke('workspace:prepareSegmentationModels', modelIds),
    analyzeComposition: (request: import('../src/shared/types').WorkspaceCompositionAnalysisRequest) => ipcRenderer.invoke('workspace:analyzeComposition', request),
    scoreCompositionCrops: (request: import('../src/shared/types').WorkspaceCompositionCropScoreRequest) => ipcRenderer.invoke('workspace:scoreCompositionCrops', request),
    segmentImage: (request: WorkspaceSegmentationRequest) => ipcRenderer.invoke('workspace:segmentImage', request),
    segmentInstances: (request: import('../src/shared/types').WorkspaceInstanceSegmentationRequest) => ipcRenderer.invoke('workspace:segmentInstances', request),
    analyzeBeauty: (request: import('../src/shared/types').WorkspaceBeautyAnalysisRequest) => ipcRenderer.invoke('workspace:analyzeBeauty', request),
    transcribeSubtitles: (request: import('../src/shared/types').WorkspaceSubtitleTranscriptionRequest) => ipcRenderer.invoke('workspace:transcribeSubtitles', request),
    cancelSubtitleTranscription: (requestId: string) => ipcRenderer.invoke('workspace:cancelSubtitleTranscription', requestId),
    chooseSubtitleFont: () => ipcRenderer.invoke('workspace:chooseSubtitleFont'),
    exportSubtitlesSrt: (request: { sourcePath: string; track: import('../src/shared/types').WorkspaceSubtitleTrack; range: { startMs: number; endMs: number } }) => ipcRenderer.invoke('workspace:exportSubtitlesSrt', request),
    cancelSegmentation: (requestId: string) => ipcRenderer.invoke('workspace:cancelSegmentation', requestId),
    trackMask: (request: WorkspaceMaskTrackingRequest) => ipcRenderer.invoke('workspace:trackMask', request),
    cancelMaskTracking: (requestId: string) => ipcRenderer.invoke('workspace:cancelMaskTracking', requestId),
    prepareObjectRemoval: () => ipcRenderer.invoke('workspace:prepareObjectRemoval'),
    releaseObjectRemoval: () => ipcRenderer.invoke('workspace:releaseObjectRemoval'),
    removeObject: (request: WorkspaceObjectRemovalRequest) => ipcRenderer.invoke('workspace:removeObject', request),
    cancelObjectRemoval: (requestId: string) => ipcRenderer.invoke('workspace:cancelObjectRemoval', requestId),
    discardObjectRemovalFiles: (projectId: string, filePaths: string[]) => ipcRenderer.invoke('workspace:discardObjectRemovalFiles', projectId, filePaths),
    loadObjectRemovalMask: (projectId: string, filePath: string, expectedBytes: number) => ipcRenderer.invoke('workspace:loadObjectRemovalMask', projectId, filePath, expectedBytes),
    listProjects: () => ipcRenderer.invoke('workspace:listProjects'),
    createProject: (name: string, assets: WorkspaceMediaAsset[]) => ipcRenderer.invoke('workspace:createProject', name, assets),
    addAssetsToProject: (projectId: string, assets: WorkspaceMediaAsset[]) => ipcRenderer.invoke('workspace:addAssetsToProject', projectId, assets),
    saveProject: (project: WorkspaceProject) => ipcRenderer.invoke('workspace:saveProject', project),
    deleteProject: (projectId: string) => ipcRenderer.invoke('workspace:deleteProject', projectId),
    renameProject: (projectId: string, newName: string) => ipcRenderer.invoke('workspace:renameProject', projectId, newName),
    extractVideoFrame: (videoPath: string, outputPath: string, frameTime: number) => ipcRenderer.invoke('workspace:extractVideoFrame', videoPath, outputPath, frameTime),
    exportRenderedLivePhoto: (name: string, imagePath: string, videoPath: string, appleLivePhoto: boolean, preserveInputs?: boolean, recordTask?: boolean, coverTimeSeconds?: number) => ipcRenderer.invoke('workspace:exportRenderedLivePhoto', name, imagePath, videoPath, appleLivePhoto, preserveInputs, recordTask, coverTimeSeconds),
    exportOriginalFile: (request: OriginalFileExportRequest) => ipcRenderer.invoke('workspace:exportOriginalFile', request),
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
  onWorkspaceSegmentationProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: import('../src/shared/types/api').WorkspaceSegmentationProgress): void => callback(progress)
    ipcRenderer.on('workspace:segmentation-progress', listener)
    return () => ipcRenderer.off('workspace:segmentation-progress', listener)
  },
  onWorkspaceMaskTrackingProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: import('../src/shared/types/api').WorkspaceMaskTrackingProgress): void => callback(progress)
    ipcRenderer.on('workspace:mask-tracking-progress', listener)
    return () => ipcRenderer.off('workspace:mask-tracking-progress', listener)
  },
  onWorkspaceSubtitleProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: import('../src/shared/types').WorkspaceSubtitleProgress): void => callback(progress)
    ipcRenderer.on('workspace:subtitle-progress', listener)
    return () => ipcRenderer.off('workspace:subtitle-progress', listener)
  },
  onConnectionLost: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('luna:connection-lost', listener)
    return () => ipcRenderer.off('luna:connection-lost', listener)
  },
  onThumbnailReady: (callback: (data: { fileId: string; fileName?: string; downloadName?: string; cacheFilePath: string | null; thumbnailUrl: string | null }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { fileId: string; fileName?: string; downloadName?: string; cacheFilePath: string | null; thumbnailUrl: string | null },
    ): void => callback(data)
    ipcRenderer.on('luna:thumbnail-ready', listener)
    return () => ipcRenderer.off('luna:thumbnail-ready', listener)
  },
  onVideoFrameRateReady: (callback: (data: { fileId: string; fileName: string; frameRate: number | null; duration?: number | null; dolbyVision?: boolean | null; dolbyVisionProfile?: number | null; iLog?: boolean | null }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { fileId: string; fileName: string; frameRate: number | null; duration?: number | null; dolbyVision?: boolean | null; dolbyVisionProfile?: number | null; iLog?: boolean | null },
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
  aiSelection: {
    chooseDirectory: () => ipcRenderer.invoke('ai-selection:choose-directory'),
    start: (request) => ipcRenderer.invoke('ai-selection:start', request),
    listSessions: () => ipcRenderer.invoke('ai-selection:list'),
    getSession: (sessionId) => ipcRenderer.invoke('ai-selection:get', sessionId),
    pause: (sessionId) => ipcRenderer.invoke('ai-selection:pause', sessionId),
    resume: (sessionId) => ipcRenderer.invoke('ai-selection:resume', sessionId),
    reanalyze: (sessionId) => ipcRenderer.invoke('ai-selection:reanalyze', sessionId),
    cancel: (sessionId) => ipcRenderer.invoke('ai-selection:cancel', sessionId),
    applyOperation: (sessionId, revision, operation) => ipcRenderer.invoke('ai-selection:apply-operation', sessionId, revision, operation),
    analyzePeople: (sessionId, itemIds) => ipcRenderer.invoke('ai-selection:analyze-people', sessionId, itemIds),
    setFaceGroupingThreshold: (sessionId, threshold) => ipcRenderer.invoke('ai-selection:set-face-grouping-threshold', sessionId, threshold),
    renamePerson: (sessionId, groupId, name) => ipcRenderer.invoke('ai-selection:rename-person', sessionId, groupId, name),
    setPersonAvatar: (sessionId, groupId, itemId, bounds) => ipcRenderer.invoke('ai-selection:set-person-avatar', sessionId, groupId, itemId, bounds),
    mergePeople: (sessionId, targetGroupId, sourceGroupIds) => ipcRenderer.invoke('ai-selection:merge-people', sessionId, targetGroupId, sourceGroupIds),
    unmergePerson: (sessionId, targetGroupId, memberIdentityId) => ipcRenderer.invoke('ai-selection:unmerge-person', sessionId, targetGroupId, memberIdentityId),
    hidePerson: (sessionId, groupId) => ipcRenderer.invoke('ai-selection:hide-person', sessionId, groupId),
    listHiddenPeople: () => ipcRenderer.invoke('ai-selection:list-hidden-people'),
    restorePerson: (sessionId, personId) => ipcRenderer.invoke('ai-selection:restore-person', sessionId, personId),
    analyzeContentTags: (sessionId, itemIds) => ipcRenderer.invoke('ai-selection:analyze-content-tags', sessionId, itemIds),
    analyzeVideos: (sessionId, itemIds) => ipcRenderer.invoke('ai-selection:analyze-videos', sessionId, itemIds),
    undo: (sessionId) => ipcRenderer.invoke('ai-selection:undo', sessionId),
    redo: (sessionId) => ipcRenderer.invoke('ai-selection:redo', sessionId),
    createWorkspaceProject: (sessionId, name) => ipcRenderer.invoke('ai-selection:create-project', sessionId, name),
    removeSession: (sessionId) => ipcRenderer.invoke('ai-selection:remove', sessionId),
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: import('../src/shared/types').AiSelectionProgress): void => callback(progress)
      ipcRenderer.on('ai-selection:progress', listener)
      return () => ipcRenderer.off('ai-selection:progress', listener)
    },
    onSessionUpdated: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, session: import('../src/shared/types').AiSelectionSession): void => callback(session)
      ipcRenderer.on('ai-selection:session-updated', listener)
      return () => ipcRenderer.off('ai-selection:session-updated', listener)
    },
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
  getNativePreviewCapabilities: () => ipcRenderer.invoke('lrc:getNativePreviewCapabilities'),
  createNativePreviewSession: (composition: CompositionInput, bounds: unknown) =>
    ipcRenderer.invoke('lrc:createNativePreviewSession', composition, bounds),
  updateNativePreviewComposition: (sessionId: number, composition: CompositionInput) =>
    ipcRenderer.invoke('lrc:updateNativePreviewComposition', sessionId, composition),
  setNativePreviewBounds: (sessionId: number, bounds: unknown) =>
    ipcRenderer.invoke('lrc:setNativePreviewBounds', sessionId, bounds),
  setNativePreviewVisible: (sessionId: number, visible: boolean) =>
    ipcRenderer.invoke('lrc:setNativePreviewVisible', sessionId, visible),
  playNativePreview: (sessionId: number, time: number) =>
    ipcRenderer.invoke('lrc:playNativePreview', sessionId, time),
  pauseNativePreview: (sessionId: number, time: number) =>
    ipcRenderer.invoke('lrc:pauseNativePreview', sessionId, time),
  seekNativePreview: (sessionId: number, time: number) =>
    ipcRenderer.invoke('lrc:seekNativePreview', sessionId, time),
  getNativePreviewSessionStats: (sessionId: number) =>
    ipcRenderer.invoke('lrc:getNativePreviewSessionStats', sessionId),
  destroyNativePreviewSession: (sessionId: number) =>
    ipcRenderer.invoke('lrc:destroyNativePreviewSession', sessionId),
  prepareRuntimeResource: (kind: 'fonts' | 'luts') => ipcRenderer.invoke('lrc:prepareRuntimeResource', kind),
  resetCompatibilityBlock: () => ipcRenderer.invoke('lrc:resetCompatibilityBlock'),
  loadTexture: (data: Buffer, width: number, height: number) =>
    ipcRenderer.invoke('lrc:loadTexture', data, width, height),
  updateTexture: (textureId: number, data: Buffer) =>
    ipcRenderer.invoke('lrc:updateTexture', textureId, data),
  renderFrame: (canvasWidth: number, canvasHeight: number, layers: unknown[], compositionTime?: number) =>
    ipcRenderer.invoke('lrc:renderFrame', canvasWidth, canvasHeight, layers, compositionTime),
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
    includeAudio?: boolean,
  ) => ipcRenderer.invoke('lrc:exportCompositionVideo', outputPath, composition, fps, duration, hardware, taskId, qualityPreset, exportTaskId, exportItemId, includeAudio),
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
