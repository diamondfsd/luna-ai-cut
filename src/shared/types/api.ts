import type { AppSettings, CacheStats, AiConfig } from './settings'
import type { DeviceDefinition, DeviceConnectOptions, ConnectionStatus, BluetoothDeviceCandidate } from './device'
import type { LunaFile } from './media'
import type { PreviewResult, MediaMetadata } from './preview'
import type { WatermarkSettings } from './watermark'
import type { VideoExportSettings } from './video'
import type { DownloadProgress, DownloadRecord, DownloadSummary } from './download'
import type { ExportFileInput, ExportProgress, ExportSummary, ExportTaskRecord } from './export'
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

export interface LunaApi {
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
  chooseMockMediaDir(): Promise<string | null>
  startMockServer(settings?: Partial<AppSettings>): Promise<MockServerStatus>
  stopMockServer(): Promise<MockServerStatus>
  getMockServerStatus(): Promise<MockServerStatus>
  getCacheStats(): Promise<CacheStats>
  clearCache(): Promise<CacheStats>
  openWifiSettings(): Promise<void>
  openDevTools(): Promise<void>
  scanBluetoothDevices(timeoutMs?: number): Promise<BluetoothDeviceCandidate[]>
  cancelBluetoothScan(): Promise<void>
  connectDevice(options?: DeviceConnectOptions): Promise<ConnectionStatus>
  checkConnection(host?: string): Promise<ConnectionStatus>
  listFiles(host?: string, storageId?: string): Promise<LunaFile[]>
  listSampleFiles(): Promise<LunaFile[]>
  listDownloadedFiles(downloadDir?: string): Promise<LunaFile[]>
  listExportFiles(exportDir?: string): Promise<LunaFile[]>
  previewFile(file: LunaFile, files: LunaFile[]): Promise<PreviewResult>
  previewLivePhoto(file: LunaFile): Promise<PreviewResult>
  previewWithWatermark(file: LunaFile, sourcePath: string, settings: WatermarkSettings): Promise<PreviewResult>
  getMediaMetadata(file: LunaFile, cachedPath?: string | null): Promise<MediaMetadata>
  /** 根据文件路径解析缩略图 URL（图片返回 file://，视频生成缩略图后返回） */
  resolveThumbnail(filePath: string, kind?: string): Promise<string | null>
  requestVideoFrameRate(file: LunaFile, cachedPath?: string | null): Promise<number | null>
  downloadFiles(files: LunaFile[], downloadDir?: string): Promise<DownloadSummary>
  cancelDownloads(): Promise<void>
  exportFiles(files: ExportFileInput[], exportDir: string, watermarkSettings: WatermarkSettings, videoExportSettings?: VideoExportSettings): Promise<ExportSummary>
  cancelExports(): Promise<void>
  cancelExportTask(taskId: string): Promise<void>
  getExportTasks(): Promise<ExportTaskRecord[]>
  getExportTask(taskId: string): Promise<ExportTaskRecord | null>
  clearExportTasks(): Promise<void>
  getDownloadedRecords(files: LunaFile[], downloadDir?: string): Promise<DownloadRecord[]>
  revealFile(filePath: string): Promise<void>
  openPath(targetPath: string): Promise<void>
  deleteLocalFiles(filePaths: string[]): Promise<{ deleted: string[]; failed: Array<{ path: string; error: string }> }>
  aiChat(config: AiConfig, systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<string>
  readExifModel(localPath: string): Promise<string | null>
  disconnect(host?: string): Promise<void>
  cacheFile(file: LunaFile): Promise<boolean>
  workspace: {
    loadPreview(filePath: string): Promise<{ buffer: ArrayBuffer; mimeType: string }>
    readColorMetadata(filePath: string): Promise<WorkspaceColorMetadata>
    listProjects(): Promise<WorkspaceProject[]>
    createProject(name: string, assets: WorkspaceMediaAsset[]): Promise<WorkspaceProject>
    addAssetsToProject(projectId: string, assets: WorkspaceMediaAsset[]): Promise<WorkspaceProject>
    saveProject(project: WorkspaceProject): Promise<WorkspaceProject>
    exportImage(name: string, dataUrl: string): Promise<{ path: string; name: string }>
    copyFile(sourcePath: string): Promise<{ path: string; name: string }>
    exportColor(sourcePath: string, color: Record<string, number>, exportMeta?: { exportId: string; taskName: string }): Promise<{ path: string; name: string }>
    previewColor(sourcePath: string, color: Record<string, number>, options?: { maxSize?: number; seekSeconds?: number }): Promise<{ path: string; dataUrl: string }>
    startVideoExport(meta: { exportId: string; taskName: string; outputName: string; width: number; height: number; fps: number }): Promise<{ exportId: string; outputPath: string; taskId: string; taskStart: number }>
    sendVideoExportFrame(exportId: string, frameData: ArrayBuffer): Promise<void>
    endVideoExport(exportId: string, meta: { taskId: string; taskStart: number; outputPath: string }): Promise<{ path: string; name: string }>
  }
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void
  onExportProgress(callback: (progress: ExportProgress) => void): () => void
  onConnectionLost(callback: () => void): () => void
  onThumbnailReady(callback: (data: { fileId: string; fileName?: string; downloadName?: string; cacheFilePath: string; thumbnailUrl: string }) => void): () => void
  onVideoFrameRateReady(callback: (data: { fileId: string; fileName: string; frameRate: number | null; duration?: number | null }) => void): () => void
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
