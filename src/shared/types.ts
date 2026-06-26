export type MediaKind = 'image' | 'video' | 'lrv' | 'unknown'

export interface LunaFile {
  id: string
  storageId?: string
  storageLabel?: string
  name: string
  href: string
  sourceUrl: string
  url: string
  dateText: string
  timeText: string
  sizeText: string
  bytes: number | null
  kind: MediaKind
  extension: string
  capturedAt: string | null
  groupDay: string
  groupHour: string
  videoKey: string | null
  previewName: string | null
  previewUrl: string | null
  cacheFilePath: string | null
  downloadFilePath: string | null
  thumbnailUrl: string | null
  isLivePhoto: boolean
  livePhotoVideoName: string | null
  livePhotoVideoUrl: string | null
  livePhotoCacheFilePath: string | null
  downloadName: string
  canPreview: boolean
  localPath?: string
  frameRate?: number
  duration?: number
}

export interface ConnectionStatus {
  deviceId?: string
  deviceName?: string
  host: string
  httpOk: boolean
  controlOk: boolean
  message: string
}

export type DeviceConnectionPhase = 'idle' | 'checking' | 'connected' | 'error'

export interface DeviceStorageOption {
  id: string
  label: string
  path: string
  default?: boolean
}

export interface DeviceWatermarkStyleConfig {
  value: WatermarkStyle
  label: string
  /** 水印文件名（不含目录和扩展名，如 ic_watermark_luna_ultra） */
  fileName: string
}

export interface DeviceDefinition {
  id: string
  name: string
  vendor: string
  defaultHost: string
  httpPort: number
  controlPort: number
  mock: {
    host: string
    httpPort: number
    tcpPort: number
    rateMbps: number
  }
  bluetooth?: {
    namePrefixes: string[]
    scanServiceUuids: string[]
    optionalServiceUuids: string[]
    serviceUuid: string
    writeCharacteristicUuid: string
    notifyCharacteristicUuid: string
    wakePayloadHex: string
  }
  storages: DeviceStorageOption[]
  /** 设备可选水印样式列表 */
  watermarkStyles?: DeviceWatermarkStyleConfig[]
}

export interface DeviceConnectOptions {
  deviceId?: string
  host?: string
  storageId?: string
}

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export type WatermarkPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
export type WatermarkStyle = 'luna_ultra' | 'luna_ultra_cn'

export interface WatermarkSettings {
  enabled: boolean
  style: WatermarkStyle
  /** 水印宽度占传感器最长边的百分比（1-40），默认 20 */
  watermarkPercent: number
  position: WatermarkPosition
}

/** 视频导出分辨率选项 */
export type VideoResolution = 'original' | '1080p' | '2k' | '4k'

/** 视频导出帧率选项 */
export type VideoFrameRate = 'original' | '24' | '25' | '29.97' | '30' | '50' | '60' | '120'

/** 视频导出码率预设选项 */
export type VideoQuality = 'original' | 'low' | 'medium' | 'high' | 'custom'

/** 视频导出参数设置 */
export interface VideoExportSettings {
  resolution: VideoResolution
  frameRate: VideoFrameRate
  quality: VideoQuality
  /** 自定义码率（kbps），仅 quality 为 'custom' 时生效 */
  customBitrate?: number
}

/** 默认视频导出设置（分辨率默认 1080p） */
export const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = {
  resolution: '1080p',
  frameRate: 'original',
  quality: 'original',
}

export interface AppSettings {
  downloadDir: string
  exportDir?: string
  cacheDir: string
  cameraHost: string
  activeDeviceId?: string
  /**
   * Per-device media library storage filter. "all" means all configured storages.
   */
  deviceStorage?: Record<string, string>
  /**
   * Per-device watermark settings. Keyed by device ID.
   */
  deviceWatermark?: Record<string, WatermarkSettings>
  developerMode?: boolean
  mockMediaDir?: string
  mockHost?: string
  mockHttpPort?: number
  mockTcpPort?: number
  mockRateMbps?: number
  aiConfig?: AiConfig
}

export interface CacheStats {
  dir: string
  files: number
  bytes: number
}

export interface PreviewResult {
  fileName: string
  kind: MediaKind
  source: string | null
  cachedPath: string | null
  message?: string
}

export interface MetadataEntry {
  key: string
  value: string
}

export interface MetadataGroup {
  name: string
  entries: MetadataEntry[]
}

export interface MediaMetadata {
  groups: MetadataGroup[]
}

export interface DownloadProgress {
  fileName: string
  index: number
  totalFiles: number
  downloaded: number
  total: number | null
  percent: number | null
  speedBps: number
  status: 'queued' | 'downloading' | 'done' | 'exists' | 'failed' | 'canceled'
  destinationPath?: string
}

export interface DownloadRecord {
  fileName: string
  path: string
  bytes: number | null
  downloadedAt: string
}

export interface ExportProgress {
  fileName: string
  index: number
  totalFiles: number
  percent: number | null
  status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  destinationPath?: string
  error?: string
  /** 导出任务唯一 ID（前端生成，同文件多次导出时做 key） */
  exportId?: string
}

export interface ExportSummary {
  completed: Array<{ name: string; path: string }>
  failed: Array<{ name: string; error: string }>
  canceled: Array<{ name: string }>
}

export interface DownloadSummary {
  completed: Array<{ name: string; path: string }>
  failed: Array<{ name: string; error: string }>
  canceled: Array<{ name: string }>
}

export interface MockServerStatus {
  running: boolean
  rootDir: string
  host: string
  httpPort: number
  tcpPort: number
  rateMbps: number
  cameraHost: string
  message: string
}

export interface BluetoothDeviceCandidate {
  deviceId: string
  deviceName: string
  rssi?: number
  serviceUuids?: string[]
  localName?: string
}

export type WifiDebugPlatform = 'darwin' | 'win32' | 'linux' | string

export interface WifiDebugStatus {
  platform: WifiDebugPlatform
  interfaceName: string | null
  connected: boolean
  ssid: string | null
  bssid: string | null
  signal: string | null
  security: string | null
  ipAddress: string | null
  raw?: string
}

export interface WifiDebugNetwork {
  ssid: string
  bssid: string | null
  signal: string | null
  security: string | null
  channel: string | null
  raw?: string
}

export interface WifiConnectOptions {
  ssid: string
  password?: string
  bssid?: string
  hidden?: boolean
  timeoutMs?: number
}

export interface WifiPortCheckOptions {
  host: string
  port: number
  timeoutMs?: number
}

export interface WifiHttpRequestOptions {
  host: string
  port: number
  path: string
  timeoutMs?: number
}

export interface WifiPortCheckResult {
  host: string
  port: number
  open: boolean
  latencyMs: number
}

export interface WifiHttpRequestResult {
  url: string
  ok: boolean
  status: number
  statusText: string
  latencyMs: number
  body: string
  json: unknown | null
}

export interface WifiDebugResult<T> {
  success: boolean
  message: string
  data?: T
  code?: string
  raw?: string
}

export interface WifiDebugApi {
  getStatus(): Promise<WifiDebugResult<WifiDebugStatus>>
  scan(): Promise<WifiDebugResult<WifiDebugNetwork[]>>
  connect(options: WifiConnectOptions): Promise<WifiDebugResult<WifiDebugStatus>>
  disconnect(): Promise<WifiDebugResult<WifiDebugStatus>>
  checkPort(options: WifiPortCheckOptions): Promise<WifiDebugResult<WifiPortCheckResult>>
  httpRequest(options: WifiHttpRequestOptions): Promise<WifiDebugResult<WifiHttpRequestResult>>
}

export interface UpdateInfo {
  /** 最新版本号，如 "1.2.1" */
  version: string
  /** 最新版本 DMG/EXE 安装包下载 URL */
  downloadUrl: string
  /** GitHub Release 页面 URL */
  releaseUrl: string
  /** Release 标题或简介 */
  releaseNotes?: string
  /** 发布时间 */
  publishedAt?: string
}

export interface LunaApi {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  listDevices(): Promise<DeviceDefinition[]>
  chooseDownloadDir(): Promise<string | null>
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
  requestVideoFrameRate(file: LunaFile, cachedPath?: string | null): Promise<number | null>
  downloadFiles(files: LunaFile[], downloadDir?: string): Promise<DownloadSummary>
  cancelDownloads(): Promise<void>
  exportFiles(files: Array<{ name: string; kind: string; localPath?: string; exportId?: string }>, exportDir: string, watermarkSettings: WatermarkSettings, videoExportSettings?: VideoExportSettings): Promise<ExportSummary>
  cancelExports(): Promise<void>
  getDownloadedRecords(files: LunaFile[], downloadDir?: string): Promise<DownloadRecord[]>
  revealFile(filePath: string): Promise<void>
  openPath(targetPath: string): Promise<void>
  deleteLocalFiles(filePaths: string[]): Promise<{ deleted: string[]; failed: Array<{ path: string; error: string }> }>
  aiChat(config: AiConfig, systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<string>
  disconnect(host?: string): Promise<void>
  cacheFile(file: LunaFile): Promise<boolean>
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void
  onExportProgress(callback: (progress: ExportProgress) => void): () => void
  onConnectionLost(callback: () => void): () => void
  onThumbnailReady(callback: (data: { fileId: string; fileName?: string; downloadName?: string; cacheFilePath: string; thumbnailUrl: string }) => void): () => void
  onVideoFrameRateReady(callback: (data: { fileId: string; fileName: string; frameRate: number | null; duration?: number | null }) => void): () => void
  /** 检查是否有新版本可用 */
  checkForUpdates(): Promise<UpdateInfo | null>
  /** 监听有新版本的事件通知 */
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
  /** 获取更新说明列表（按版本倒序，最多 5 条） */
  listReleaseNotes(): Promise<ReleaseNoteItem[]>
}

export interface ReleaseNoteItem {
  version: string
  content: string
}
