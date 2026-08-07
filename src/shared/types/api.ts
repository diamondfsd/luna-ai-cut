import type { AppSettings, CacheStats, CustomLutFile } from './settings'
import type { DeviceDefinition, DeviceConnectOptions, ConnectionStatus, BluetoothDeviceCandidate } from './device'
import type { CameraDeleteResult, LunaFile } from './media'
import type { PreviewResult, MediaMetadata } from './preview'
import type { CustomWatermarkAsset, WatermarkSettings } from './watermark'
import type { DolbyVisionProbeResult, DolbyVisionWatermarkExportRequest, VideoExportSettings } from './video'
import type { DownloadProgress, DownloadRecord, DownloadSummary } from './download'
import type { ExportFileInput, ExportItemInput, ExportProgress, ExportSummary, ExportTaskRecord, OriginalFileExportRequest } from './export'
import type { MockServerStatus } from './mock'
import type {
  DeviceDebugTestResult,
  DeviceDebugPortResult,
  DeviceDebugConnectResult,
  DeviceDebugAuthResult,
  DeviceDebugFileListResult,
  DeviceDebugDiagnosticsResult,
  DeviceDebugOption,
  DeviceDebugEvent,
} from './debug'
import type { UpdateInfo, HotUpdateCheckResult, ReleaseNoteItem } from './update'
import type { WorkspaceColorMetadata, WorkspaceProject, WorkspaceMediaAsset } from './workspace'
import type { WifiDebugResult, WifiDebugStatus, WifiDebugNetwork, WifiConnectOptions } from './wifi'
import type { NetworkDiagnosticsResult } from './networkDiagnostics'
import type {
  AiSelectionProgress,
  AiSelectionSession,
  AiSelectionStartRequest,
  AiSelectionUserOperation,
} from './aiSelection'
import type { AutomaticSegmentationTargetId, SegmentationModelId } from '../segmentationModels'
import type { CameraMediaSourceApi } from './cameraMediaSource'
import type { LocalMediaShareStatus } from './localMediaShare'
import type { WorkspaceBeautyAnalysisRequest, WorkspaceBeautyAnalysisResult } from './beauty'
import type {
  AiEditingAssistantConfig,
  AiEditingAssistantConfigInput,
  AiEditingAssistantGenerateInput,
  WorkspaceVisualAnalysisRequest,
  WorkspaceVisualAnalysisResult,
} from './aiEditing'
import type { WorkspaceSubtitleFontAsset, WorkspaceSubtitleProgress, WorkspaceSubtitleTrack, WorkspaceSubtitleTranscriptionRequest, WorkspaceSubtitleTranscriptionResult } from './subtitles'

export interface WorkspaceSegmentationRequest {
  requestId: string
  filePath: string
  /** 视频素材取帧时间；图片素材忽略。 */
  frameTime?: number
  point?: { x: number; y: number }
  modelId?: SegmentationModelId
  targetId?: AutomaticSegmentationTargetId
  targetClassId?: number
}

export interface WorkspaceInstanceSegmentationRequest {
  requestId: string
  filePath: string
}

export interface WorkspaceInstanceSegmentationResult {
  requestId: string
  width: number
  height: number
  instanceIds: ArrayBuffer
  performance: {
    modelLoadMs: number
    imagePrepareMs: number
    inferenceMs: number
    totalMs: number
  }
}

export interface WorkspaceSegmentationProgress {
  requestId: string
  phase: 'model' | 'preparing' | 'recognizing'
  label: string
  percent: number | null
}

export interface WorkspaceMaskTrackingRequest {
  requestId: string
  filePath: string
  direction: 'forward' | 'backward'
  anchorTime: number
  /** 向前追踪时的最远时间，不设则追踪到视频末尾。 */
  endTime?: number
  maskWidth: number
  maskHeight: number
  maskBytes: ArrayBuffer | Uint8Array
  /** 相似变换适合刚性区域；稠密蒙版用于身体等非刚性区域。 */
  mode?: 'similarity' | 'dense-mask'
  /** 稠密追踪的目标轮廓约束，不会成为最终效果蒙版。 */
  guideMaskBytes?: ArrayBuffer | Uint8Array
  guideMaskWidth?: number
  guideMaskHeight?: number
  initialTransform?: {
    translateX: number
    translateY: number
    scale: number
    rotation: number
  }
}

export interface WorkspaceMaskTrackingProgress {
  requestId: string
  direction: 'forward' | 'backward'
  percent: number
  time: number
  confidence: number
}

export interface WorkspaceMaskTrackingResult {
  requestId: string
  direction: 'forward' | 'backward'
  anchorTime: number
  keyframes: Array<{
    time: number
    translateX: number
    translateY: number
    scale: number
    rotation: number
    confidence: number
  }>
  masks?: Array<{
    time: number
    width: number
    height: number
    bytes: ArrayBuffer
    confidence: number
  }>
  completed: boolean
  stoppedReason?: string
}

export interface WorkspaceObjectRemovalRequest {
  requestId: string
  projectId: string
  assetId: string
  filePath: string
  maskWidth: number
  maskHeight: number
  maskBytes: ArrayBuffer | Uint8Array
  edgeExpansion: number
  feather: number
  quality?: 'fast' | 'high'
}

export interface WorkspaceObjectRemovalResult {
  requestId: string
  resultPath: string
  maskPath: string
  resultBytes: number
  resultSha256: string
  maskBytes: number
  maskSha256: string
  width: number
  height: number
  modelLoadMs: number
  inferenceMs: number
  modelSha256: string
}

export interface WorkspaceSegmentationModelStatus {
  modelId: SegmentationModelId
  cached: boolean
  sizeBytes: number
}

export interface LunaApi {
  startupReady(): void
  log: (level: string, message: string, meta?: unknown) => void
  logExport: (message: string, meta?: unknown) => Promise<boolean>
  getLogDir: () => Promise<string>
  clearLogs: () => Promise<void>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  listDevices(): Promise<DeviceDefinition[]>
  chooseDownloadDir(): Promise<string | null>
  chooseLocalResourcesDir(): Promise<string | null>
  chooseExportDir(): Promise<string | null>
  chooseLutDir(): Promise<string | null>
  chooseMockMediaDir(): Promise<string | null>
  chooseCustomWatermarks(): Promise<CustomWatermarkAsset[]>
  listCustomWatermarks(): Promise<CustomWatermarkAsset[]>
  deleteCustomWatermark(assetId: string): Promise<CustomWatermarkAsset[]>
  startMockServer(settings?: Partial<AppSettings>): Promise<MockServerStatus>
  stopMockServer(): Promise<MockServerStatus>
  getMockServerStatus(): Promise<MockServerStatus>
  getCacheStats(): Promise<CacheStats>
  clearCache(): Promise<CacheStats>
  listCustomLuts(): Promise<CustomLutFile[]>
  deleteCustomLut(filePath: string): Promise<void>
  openWifiSettings(): Promise<void>
  openDevTools(): Promise<void>
  scanBluetoothDevices(timeoutMs?: number): Promise<BluetoothDeviceCandidate[]>
  cancelBluetoothScan(): Promise<void>
  cameraSource: CameraMediaSourceApi
  connectDevice(options?: DeviceConnectOptions): Promise<ConnectionStatus>
  checkConnection(host?: string): Promise<ConnectionStatus>
  listFiles(host?: string, storageId?: string): Promise<LunaFile[]>
  deleteCameraFiles(files: LunaFile[], host?: string): Promise<CameraDeleteResult>
  listSampleFiles(): Promise<LunaFile[]>
  listDownloadedFiles(downloadDir?: string): Promise<LunaFile[]>
  listExportFiles(exportDir?: string): Promise<LunaFile[]>
  previewFile(file: LunaFile, files: LunaFile[]): Promise<PreviewResult>
  previewLivePhoto(sourceUrl: string): Promise<PreviewResult>
  previewWithWatermark(file: LunaFile, sourcePath: string, settings: WatermarkSettings): Promise<PreviewResult>
  getMediaMetadata(file: LunaFile, cachedPath?: string | null): Promise<MediaMetadata>
  getMediaMetadataByPath(filePath: string): Promise<MediaMetadata>
  /** 根据文件路径解析缩略图 URL（图片返回 file://，视频生成缩略图后返回） */
  resolveThumbnail(filePath: string, kind?: string): Promise<string | null>
  requestVideoFrameRate(file: LunaFile, cachedPath?: string | null): Promise<number | null>
  detectILog(filePath: string): Promise<boolean>
  downloadFiles(files: LunaFile[], downloadDir?: string): Promise<DownloadSummary>
  cancelDownloads(): Promise<void>
  exportFiles(files: ExportFileInput[], exportDir: string, watermarkSettings: WatermarkSettings, videoExportSettings?: VideoExportSettings): Promise<ExportSummary>
  cancelExports(): Promise<void>
  cancelExportTask(taskId: string): Promise<void>
  getExportTasks(): Promise<ExportTaskRecord[]>
  getExportTask(taskId: string): Promise<ExportTaskRecord | null>
  clearExportTasks(): Promise<void>
  localMediaShare: {
    getStatus(): Promise<LocalMediaShareStatus>
    start(): Promise<LocalMediaShareStatus>
    stop(): Promise<LocalMediaShareStatus>
  }
  getDownloadedRecords(files: LunaFile[], downloadDir?: string): Promise<DownloadRecord[]>
  revealFile(filePath: string): Promise<void>
  openPath(targetPath: string): Promise<void>
  openPhotosApp(): Promise<void>
  deleteLocalFiles(filePaths: string[]): Promise<{ deleted: string[]; failed: Array<{ path: string; error: string }> }>
  readExifModel(localPath: string): Promise<string | null>
  getWatermarkPath(style: string, kind: 'image' | 'video'): Promise<{ filePath: string; width: number; height: number }>
  getBorderLogoPath(logoId: string): Promise<string>
  disconnect(host?: string): Promise<void>
  cacheFile(params: { sourceUrl: string; previewUrl?: string | null }): Promise<boolean>
  getWifiStatus: () => Promise<WifiDebugResult<WifiDebugStatus>>
  collectNetworkDiagnostics: (host?: string) => Promise<NetworkDiagnosticsResult>
  scanWifi: () => Promise<WifiDebugResult<WifiDebugNetwork[]>>
  connectWifi: (options: WifiConnectOptions) => Promise<WifiDebugResult<WifiDebugStatus>>
  disconnectWifi: () => Promise<WifiDebugResult<WifiDebugStatus>>
  /** 导出任务记录服务 */
  exportTask: {
    create(name: string, items?: ExportItemInput[], taskId?: string): Promise<ExportTaskRecord>
    addItems(taskId: string, items: ExportItemInput[]): Promise<void>
    updateItem(taskId: string, itemId: string, data: { progress?: number; status?: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'; error?: string; destinationPath?: string; label?: string }): Promise<void>
    cancel(taskId: string): Promise<void>
    get(taskId: string): Promise<ExportTaskRecord | undefined>
    list(): Promise<ExportTaskRecord[]>
    clear(): Promise<void>
  }
  aiSelection: {
    chooseDirectory(): Promise<string | null>
    start(request: AiSelectionStartRequest): Promise<AiSelectionSession>
    listSessions(): Promise<AiSelectionSession[]>
    getSession(sessionId: string): Promise<AiSelectionSession | null>
    pause(sessionId: string): Promise<AiSelectionSession>
    resume(sessionId: string): Promise<AiSelectionSession>
    cancel(sessionId: string): Promise<AiSelectionSession>
    applyOperation(sessionId: string, revision: number, operation: AiSelectionUserOperation): Promise<AiSelectionSession>
    analyzePeople(sessionId: string, itemIds: string[]): Promise<AiSelectionSession>
    renamePerson(sessionId: string, groupId: string, name: string): Promise<AiSelectionSession>
    setPersonAvatar(sessionId: string, groupId: string, itemId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<AiSelectionSession>
    mergePeople(sessionId: string, targetGroupId: string, sourceGroupId: string): Promise<AiSelectionSession>
    unmergePerson(sessionId: string, targetGroupId: string, memberIdentityId: string): Promise<AiSelectionSession>
    analyzeContentTags(sessionId: string, itemIds: string[]): Promise<AiSelectionSession>
    analyzeVideos(sessionId: string, itemIds: string[]): Promise<AiSelectionSession>
    undo(sessionId: string): Promise<AiSelectionSession>
    redo(sessionId: string): Promise<AiSelectionSession>
    createWorkspaceProject(sessionId: string, name: string): Promise<WorkspaceProject>
    removeSession(sessionId: string): Promise<void>
    onProgress(callback: (progress: AiSelectionProgress) => void): () => void
    onSessionUpdated(callback: (session: AiSelectionSession) => void): () => void
  }
  aiEditingAssistant: {
    getConfig(): Promise<AiEditingAssistantConfig>
    saveConfig(input: AiEditingAssistantConfigInput): Promise<AiEditingAssistantConfig>
    generate(input: AiEditingAssistantGenerateInput): Promise<string>
    cancel(requestId: string): Promise<void>
  }
  workspace: {
    chooseMediaFiles(): Promise<string[]>
    chooseMediaDirectory(): Promise<string[]>
    readMediaFile(filePath: string): Promise<{
      name: string
      mimeType: string
      lastModified: number
      bytes: ArrayBuffer
    }>
    loadTrimThumbnailCache(videoPath: string, duration: number): Promise<ArrayBuffer | null>
    saveTrimThumbnailCache(videoPath: string, duration: number, bytes: ArrayBuffer): Promise<void>
    saveColorMask(projectId: string, assetId: string, width: number, height: number, bytes: ArrayBuffer, feather: number): Promise<{ path: string; width: number; height: number }>
    loadColorMask(projectId: string, filePath: string): Promise<{ width: number; height: number; bytes: ArrayBuffer }>
    deleteColorMask(projectId: string, filePath: string): Promise<void>
    cleanupColorMasks(projectId: string, retainedPaths: string[]): Promise<{ deleted: number; retained: number }>
    loadPreview(filePath: string): Promise<{ buffer: ArrayBuffer; mimeType: string }>
    getMediaFormatInfo(filePath: string): Promise<{ dolbyVision: boolean; iLog: boolean; raw: boolean }>
    /** 获取媒体文件分辨率（图片/视频统一接口） */
    getMediaResolution(filePath: string): Promise<{ width: number; height: number }>
    getVideoDuration(filePath: string): Promise<number>
    probeDolbyVision(filePath: string): Promise<DolbyVisionProbeResult>
    exportDolbyVisionWatermark(request: DolbyVisionWatermarkExportRequest): Promise<{ path: string }>
    isLivePhoto(filePath: string): Promise<boolean>
    readColorMetadata(filePath: string): Promise<WorkspaceColorMetadata>
    getSegmentationModelStatus(modelId: SegmentationModelId): Promise<WorkspaceSegmentationModelStatus>
    prepareSegmentationModels(modelIds: SegmentationModelId[]): Promise<void>
    segmentImage(request: WorkspaceSegmentationRequest): Promise<{
      requestId: string
      width: number
      height: number
      classId: number
      className: string
      targetId?: AutomaticSegmentationTargetId
      modelId: string
      performance: {
        modelLoadMs: number
        imagePrepareMs: number
        inferenceMs: number
        totalMs: number
      }
      bytes: ArrayBuffer
    }>
    segmentInstances(request: WorkspaceInstanceSegmentationRequest): Promise<WorkspaceInstanceSegmentationResult>
    analyzeBeauty(request: WorkspaceBeautyAnalysisRequest): Promise<WorkspaceBeautyAnalysisResult>
    analyzeVisualEvidence(request: WorkspaceVisualAnalysisRequest): Promise<WorkspaceVisualAnalysisResult>
    transcribeSubtitles(request: WorkspaceSubtitleTranscriptionRequest): Promise<WorkspaceSubtitleTranscriptionResult>
    cancelSubtitleTranscription(requestId: string): Promise<void>
    chooseSubtitleFont(): Promise<WorkspaceSubtitleFontAsset | null>
    exportSubtitlesSrt(request: { sourcePath: string; track: WorkspaceSubtitleTrack; range: { startMs: number; endMs: number } }): Promise<{ path: string } | null>
    cancelSegmentation(requestId: string): Promise<boolean>
    trackMask(request: WorkspaceMaskTrackingRequest): Promise<WorkspaceMaskTrackingResult>
    cancelMaskTracking(requestId: string): Promise<boolean>
    prepareObjectRemoval(): Promise<void>
    releaseObjectRemoval(): Promise<void>
    removeObject(request: WorkspaceObjectRemovalRequest): Promise<WorkspaceObjectRemovalResult>
    cancelObjectRemoval(requestId: string): Promise<boolean>
    discardObjectRemovalFiles(projectId: string, filePaths: string[]): Promise<void>
    loadObjectRemovalMask(projectId: string, filePath: string, expectedBytes: number): Promise<ArrayBuffer>
    listProjects(): Promise<WorkspaceProject[]>
    createProject(name: string, assets: WorkspaceMediaAsset[]): Promise<WorkspaceProject>
    addAssetsToProject(projectId: string, assets: WorkspaceMediaAsset[]): Promise<WorkspaceProject>
    saveProject(project: WorkspaceProject): Promise<WorkspaceProject>
    deleteProject(projectId: string): Promise<void>
    renameProject(projectId: string, newName: string): Promise<WorkspaceProject>
    extractVideoFrame(videoPath: string, outputPath: string, frameTime: number): Promise<{ path: string; name: string }>
    exportRenderedLivePhoto(name: string, imagePath: string, videoPath: string, appleLivePhoto: boolean, preserveInputs?: boolean, recordTask?: boolean, coverTimeSeconds?: number): Promise<{ path: string; name: string }>
    exportOriginalFile(request: OriginalFileExportRequest): Promise<{ path: string }>
    copyFile(sourcePath: string): Promise<{ path: string; name: string }>
    listColorPresets(): Promise<Array<{ id: string; name: string; createdAt: string; updatedAt: string; colorJson: string }>>
    saveColorPreset(name: string, colorJson: string): Promise<{ id: string; name: string; createdAt: string; updatedAt: string; colorJson: string }>
    deleteColorPreset(id: string): Promise<void>
    renameColorPreset(id: string, newName: string): Promise<void>
  }
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void
  onExportProgress(callback: (progress: ExportProgress) => void): () => void
  onWorkspaceSegmentationProgress(callback: (progress: WorkspaceSegmentationProgress) => void): () => void
  onWorkspaceMaskTrackingProgress(callback: (progress: WorkspaceMaskTrackingProgress) => void): () => void
  onWorkspaceSubtitleProgress(callback: (progress: WorkspaceSubtitleProgress) => void): () => void
  onConnectionLost(callback: () => void): () => void
  onThumbnailReady(callback: (data: { fileId: string; fileName?: string; downloadName?: string; cacheFilePath: string | null; thumbnailUrl: string | null }) => void): () => void
  onVideoFrameRateReady(callback: (data: { fileId: string; fileName: string; frameRate: number | null; duration?: number | null; dolbyVision?: boolean | null; dolbyVisionProfile?: number | null; iLog?: boolean | null }) => void): () => void
  checkForUpdates(): Promise<UpdateInfo | null>
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
  listReleaseNotes(): Promise<ReleaseNoteItem[]>
  getHotUpdateVersion(): Promise<string | null>
  checkForHotUpdates(): Promise<HotUpdateCheckResult | null>
  applyHotUpdate(info: HotUpdateCheckResult): Promise<{ success: boolean; error?: string }>
  clearHotUpdate(): Promise<void>
  relaunchApp(): Promise<void>
  onHotUpdateAvailable(callback: (info: HotUpdateCheckResult) => void): () => void
}

export interface DeviceDebugApi {
  runTest(params: { deviceId: string; host: string }): Promise<DeviceDebugTestResult>
  checkPort(params: { deviceId: string; host: string }): Promise<DeviceDebugPortResult>
  connect(params: { deviceId: string; host: string }): Promise<DeviceDebugConnectResult>
  disconnect(params: { deviceId: string; host: string }): Promise<{ success: boolean }>
  checkAuth(params: { deviceId: string; host: string }): Promise<DeviceDebugAuthResult>
  requestAuth(params: { deviceId: string; host: string }): Promise<DeviceDebugAuthResult>
  getAuthState(params: { deviceId: string; host: string }): Promise<{ authState: string }>
  listFiles(params: { deviceId: string; host: string }): Promise<DeviceDebugFileListResult>
  runDiagnostics(params: { deviceId: string; host: string }): Promise<DeviceDebugDiagnosticsResult>
  getDeviceOptions(): Promise<DeviceDebugOption[]>
  log(params: { level: string; message: string; data?: unknown }): Promise<{ success: boolean }>
  getLogPath(): Promise<string>
  onLog(callback: (event: DeviceDebugEvent) => void): () => void
}
