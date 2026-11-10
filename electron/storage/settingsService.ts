import { app, dialog } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { DEFAULT_DEVICE } from '../devices/definitions/deviceDefaults'
import { migrateBaseDirectory } from './settingsMigration'
import { legacySettingsPath, readStoredSettings, readStoredSettingsSync, stableSettingsPath } from './settingsStorage'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../../src/shared/types/video'
import type { AppSettings, LocalMediaExportPreset, NasSyncSettings, VideoExportSettings, WatermarkPlacement, WatermarkPosition, WatermarkSettings, WorkspaceExportPreset } from '../../src/shared/types'

function settingsPath(): string {
  if (process.env.LUNA_E2E_USER_DATA_DIR) return legacySettingsPath(app.getPath('userData'))
  return stableSettingsPath(app.getPath('appData'))
}

function legacyPath(): string {
  return legacySettingsPath(app.getPath('userData'))
}

let settingsOperation: Promise<void> = Promise.resolve()

function enqueueSettingsOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = settingsOperation.then(operation, operation)
  settingsOperation = next.then(() => undefined, () => undefined)
  return next
}

export function cacheDir(baseDir: string): string {
  return path.join(baseDir, 'cache')
}

export function previewCacheDirForBaseDir(baseDir: string): string {
  return path.join(cacheDir(baseDir), 'previews')
}

export function logDirForBaseDir(baseDir: string): string {
  return path.join(baseDir, 'logs')
}

/** 获取有效的本地资源目录路径 */
export function getLocalResourcesDir(settings: AppSettings): string {
  return settings.localResourcesDir || path.join(settings.baseDir, 'localResources')
}

export function getDirectorPlanDir(settings: AppSettings): string {
  return settings.directorPlanDir || path.join(settings.baseDir, '导演计划')
}

export async function previewCacheDir(): Promise<string> {
  return previewCacheDirForBaseDir((await getSettings()).baseDir)
}

function defaultBaseDir(): string {
  return path.join(app.getPath('pictures'), 'LunaAI-Cut')
}

function defaultExportDir(): string {
  return path.join(defaultBaseDir(), 'export')
}

export function currentBaseDir(): string {
  const fallback = defaultBaseDir()
  const saved = readStoredSettingsSync<StoredSettings>(settingsPath(), legacyPath()).value
  return saved ? migrateBaseDirectory(saved, fallback).baseDir : fallback
}

function defaultSettings(): AppSettings {
  const baseDir = defaultBaseDir()
  return {
    baseDir,
    localResourcesDir: path.join(baseDir, 'localResources'),
    exportDir: defaultExportDir(),
    cacheDir: cacheDir(baseDir),
    cameraHost: DEFAULT_DEVICE.defaultHost,
    cameraConnectionMode: 'wireless',
    mountedCameraRoot: '',
    activeDeviceId: DEFAULT_DEVICE.id,
    deviceStorage: { [DEFAULT_DEVICE.id]: 'all' },
    developerMode: false,
    defaultWatermarkEnabled: true,
    defaultWatermarkPosition: 'bottom-center',
    workspacePreviewQuality: 'balanced',
    cameraPreviewQuality: 'proxy',
    experimentalWebGpuPreview: true,
    // 视频导出统一使用 Rust/wgpu；保留该字段仅用于兼容旧版本设置。
    experimentalWebGpuExport: false,
    organizeDownloadsByDate: false,
    chooseTransferDirectoryBeforeAction: false,
    downloadDirectories: [],
    exportDirectories: [],
    localMediaShareDirectories: [],
    localMediaShareFiles: [],
    localMediaExportPresets: [],
    workspaceExportPresets: [],
    windowCloseBehavior: 'hide',
    nasSync: {
      enabled: false,
      autoSync: false,
      server: '',
      port: 445,
      share: '',
      remotePath: '',
      username: '',
      password: '',
      concurrency: 3,
    },
    mockMediaDir: '',
    mockHost: DEFAULT_DEVICE.mock.host,
    mockHttpPort: DEFAULT_DEVICE.mock.httpPort,
    mockTcpPort: DEFAULT_DEVICE.mock.tcpPort,
    mockRateMbps: DEFAULT_DEVICE.mock.rateMbps,
  }
}

const WATERMARK_POSITIONS = new Set<WatermarkPosition>([
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
])

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeExportConfig(value: unknown): VideoExportSettings | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VideoExportSettings>
  const resolutions = new Set(['original', '1080p', '2k', '4k'])
  const frameRates = new Set(['original', '24', '25', '29.97', '30', '50', '60', '120'])
  const qualities = new Set(['original', 'low', 'medium', 'high', 'custom'])
  const formats = new Set(['video', 'google-live', 'apple-live'])
  const exportFormats = Array.isArray(source.exportFormats)
    ? source.exportFormats.filter((format): format is VideoExportSettings['exportFormats'][number] => formats.has(format))
    : [...DEFAULT_VIDEO_EXPORT_SETTINGS.exportFormats]
  return {
    ...DEFAULT_VIDEO_EXPORT_SETTINGS,
    resolution: resolutions.has(String(source.resolution)) ? source.resolution! : DEFAULT_VIDEO_EXPORT_SETTINGS.resolution,
    frameRate: frameRates.has(String(source.frameRate)) ? source.frameRate! : DEFAULT_VIDEO_EXPORT_SETTINGS.frameRate,
    quality: qualities.has(String(source.quality)) ? source.quality! : DEFAULT_VIDEO_EXPORT_SETTINGS.quality,
    includeAudio: typeof source.includeAudio === 'boolean' ? source.includeAudio : DEFAULT_VIDEO_EXPORT_SETTINGS.includeAudio,
    exportFormats: exportFormats.length > 0 ? exportFormats : [...DEFAULT_VIDEO_EXPORT_SETTINGS.exportFormats],
    exportPhotos: typeof source.exportPhotos === 'boolean' ? source.exportPhotos : DEFAULT_VIDEO_EXPORT_SETTINGS.exportPhotos,
    exportLiveVideo: typeof source.exportLiveVideo === 'boolean' ? source.exportLiveVideo : DEFAULT_VIDEO_EXPORT_SETTINGS.exportLiveVideo,
    liveStartTime: finiteNumber(source.liveStartTime) ? Math.max(0, source.liveStartTime) : DEFAULT_VIDEO_EXPORT_SETTINGS.liveStartTime,
    liveCoverTime: finiteNumber(source.liveCoverTime) ? Math.max(0, source.liveCoverTime) : DEFAULT_VIDEO_EXPORT_SETTINGS.liveCoverTime,
    trimStartTime: finiteNumber(source.trimStartTime) ? Math.max(0, source.trimStartTime) : DEFAULT_VIDEO_EXPORT_SETTINGS.trimStartTime,
    trimEndTime: finiteNumber(source.trimEndTime) ? Math.max(0, source.trimEndTime) : undefined,
    customBitrate: finiteNumber(source.customBitrate) && source.customBitrate > 0 ? source.customBitrate : undefined,
    dolbyVision: typeof source.dolbyVision === 'boolean' ? source.dolbyVision : undefined,
    autoRestoreILog: typeof source.autoRestoreILog === 'boolean' ? source.autoRestoreILog : undefined,
  }
}

function normalizeWatermarkSettings(value: unknown): WatermarkSettings | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<WatermarkSettings>
  if (typeof source.enabled !== 'boolean' || typeof source.style !== 'string' || !WATERMARK_POSITIONS.has(source.position as WatermarkPosition)) {
    return undefined
  }
  return source as WatermarkSettings
}

function normalizePresetIdentity(value: unknown): { id: string; name: string } | null {
  if (!value || typeof value !== 'object') return null
  const source = value as { id?: unknown; name?: unknown }
  if (typeof source.id !== 'string' || !source.id.trim() || typeof source.name !== 'string' || !source.name.trim()) return null
  return { id: source.id.trim().slice(0, 100), name: source.name.trim().slice(0, 60) }
}

function normalizeLocalExportPresets(value: unknown): LocalMediaExportPreset[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.slice(0, 100).flatMap((item) => {
    const identity = normalizePresetIdentity(item)
    if (!identity || seen.has(identity.id) || !item || typeof item !== 'object') return []
    const source = item as Partial<LocalMediaExportPreset>
    const exportConfig = normalizeExportConfig(source.exportConfig)
    const watermarkSettings = normalizeWatermarkSettings(source.watermarkSettings)
    if (!exportConfig || watermarkSettings === undefined || typeof source.appleLivePhoto !== 'boolean') return []
    seen.add(identity.id)
    return [{ ...identity, exportConfig, watermarkSettings, appleLivePhoto: source.appleLivePhoto }]
  })
}

function normalizeWorkspaceExportPresets(value: unknown): WorkspaceExportPreset[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.slice(0, 100).flatMap((item) => {
    const identity = normalizePresetIdentity(item)
    if (!identity || seen.has(identity.id) || !item || typeof item !== 'object') return []
    const exportConfig = normalizeExportConfig((item as Partial<WorkspaceExportPreset>).exportConfig)
    if (!exportConfig) return []
    seen.add(identity.id)
    return [{ ...identity, exportConfig }]
  })
}

function validNasPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535
}

function normalizeDefaultWatermarkPlacement(value: unknown): WatermarkPlacement | undefined {
  if (!value || typeof value !== 'object') return undefined
  const placement = value as Partial<WatermarkPlacement>
  if (placement.mode === 'preset' && WATERMARK_POSITIONS.has(placement.anchor as WatermarkPosition) && finiteNumber(placement.insetOnShortEdge)) {
    return {
      mode: 'preset',
      anchor: placement.anchor as WatermarkPosition,
      insetOnShortEdge: Math.min(0.25, Math.max(0, placement.insetOnShortEdge)),
    }
  }
  if (placement.mode === 'free' && finiteNumber(placement.centerX) && finiteNumber(placement.centerY)) {
    return {
      mode: 'free',
      centerX: Math.min(1, Math.max(0, placement.centerX)),
      centerY: Math.min(1, Math.max(0, placement.centerY)),
    }
  }
  return undefined
}

type LegacyNasSyncDebugSettings = {
  nasSyncDebugMode?: boolean
  nasSyncDebugPrevious?: unknown
}

type StoredSettings = Partial<AppSettings> & {
  downloadDir?: string
  liveRtmpUrl?: unknown
  liveRtmpStreamKey?: unknown
} & LegacyNasSyncDebugSettings

async function readSettingsFile() {
  return readStoredSettings<StoredSettings>(settingsPath(), legacyPath())
}

function mergeSettings(saved: StoredSettings | null): AppSettings {
  const defaults = defaultSettings()
  const savedSettings = migrateBaseDirectory(saved ?? {}, defaults.baseDir)
  const merged = {
    ...defaults,
    ...savedSettings,
    baseDir: savedSettings.baseDir,
    cacheDir: cacheDir(savedSettings.baseDir),
  }
  const legacyLiveSettings = merged as typeof merged & Pick<StoredSettings, 'liveRtmpUrl' | 'liveRtmpStreamKey'>
  delete legacyLiveSettings.liveRtmpUrl
  delete legacyLiveSettings.liveRtmpStreamKey
  const hasLegacyNasDebugMode = saved?.nasSyncDebugMode === true
  merged.defaultWatermarkEnabled = typeof saved?.defaultWatermarkEnabled === 'boolean'
    ? saved.defaultWatermarkEnabled
    : defaults.defaultWatermarkEnabled
  merged.defaultWatermarkPosition = [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ].includes(String(saved?.defaultWatermarkPosition))
    ? saved?.defaultWatermarkPosition
    : defaults.defaultWatermarkPosition
  const savedDefaultWatermarkSize = saved?.defaultWatermarkSizeOnCanvasWidth
  merged.defaultWatermarkSizeOnCanvasWidth = finiteNumber(savedDefaultWatermarkSize)
    ? Math.min(0.8, Math.max(0.08, savedDefaultWatermarkSize))
    : undefined
  merged.defaultWatermarkPlacement = normalizeDefaultWatermarkPlacement(saved?.defaultWatermarkPlacement)
  merged.experimentalWebGpuPreview = typeof saved?.experimentalWebGpuPreview === 'boolean'
    ? saved.experimentalWebGpuPreview : defaults.experimentalWebGpuPreview
  // 浏览器 WebGPU 导出已移除，覆盖旧版本保存的 true，避免升级后继续走慢路径。
  merged.experimentalWebGpuExport = false
  merged.cameraPreviewQuality = saved?.cameraPreviewQuality === 'original' || saved?.cameraPreviewQuality === 'proxy'
    ? saved.cameraPreviewQuality
    : defaults.cameraPreviewQuality
  merged.organizeDownloadsByDate = typeof saved?.organizeDownloadsByDate === 'boolean'
    ? saved.organizeDownloadsByDate
    : defaults.organizeDownloadsByDate
  merged.chooseTransferDirectoryBeforeAction = typeof saved?.chooseTransferDirectoryBeforeAction === 'boolean'
    ? saved.chooseTransferDirectoryBeforeAction
    : defaults.chooseTransferDirectoryBeforeAction
  const normalizeDirectoryList = (value: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(value)) return fallback
    return [...new Set(value
      .filter((directory): directory is string => typeof directory === 'string' && path.isAbsolute(directory.trim()))
      .map((directory) => path.resolve(directory.trim())))]
  }
  merged.downloadDirectories = normalizeDirectoryList(saved?.downloadDirectories, defaults.downloadDirectories ?? [])
  merged.exportDirectories = normalizeDirectoryList(saved?.exportDirectories, defaults.exportDirectories ?? [])
  merged.localMediaExportPresets = normalizeLocalExportPresets(saved?.localMediaExportPresets)
  merged.workspaceExportPresets = normalizeWorkspaceExportPresets(saved?.workspaceExportPresets)
  const savedShareDirectories = saved?.localMediaShareDirectories
  merged.localMediaShareDirectories = Array.isArray(savedShareDirectories)
    ? savedShareDirectories.filter((directory): directory is string => typeof directory === 'string' && directory.trim().length > 0)
    : defaults.localMediaShareDirectories
  const savedShareFiles = saved?.localMediaShareFiles
  merged.localMediaShareFiles = Array.isArray(savedShareFiles)
    ? savedShareFiles.filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0)
    : defaults.localMediaShareFiles
  const savedWindowCloseBehavior = saved?.windowCloseBehavior
  merged.windowCloseBehavior = savedWindowCloseBehavior === 'hide' || savedWindowCloseBehavior === 'quit'
    ? savedWindowCloseBehavior
    : defaults.windowCloseBehavior
  const savedNasSync = saved?.nasSync
  const defaultNasSync = defaults.nasSync as NasSyncSettings
  const savedNasPort = savedNasSync?.port
  merged.nasSync = {
    enabled: typeof savedNasSync?.enabled === 'boolean' ? savedNasSync.enabled : defaultNasSync.enabled,
    autoSync: typeof savedNasSync?.autoSync === 'boolean' ? savedNasSync.autoSync : defaultNasSync.autoSync,
    server: typeof savedNasSync?.server === 'string' ? savedNasSync.server.trim() : defaultNasSync.server,
    port: validNasPort(savedNasPort) ? savedNasPort : defaultNasSync.port,
    share: typeof savedNasSync?.share === 'string' ? savedNasSync.share.trim() : defaultNasSync.share,
    remotePath: typeof savedNasSync?.remotePath === 'string' ? savedNasSync.remotePath.trim() : defaultNasSync.remotePath,
    username: typeof savedNasSync?.username === 'string' ? savedNasSync.username : defaultNasSync.username,
    password: typeof savedNasSync?.password === 'string' ? savedNasSync.password : defaultNasSync.password,
    concurrency: typeof savedNasSync?.concurrency === 'number' && Number.isFinite(savedNasSync.concurrency)
      ? Math.min(10, Math.max(1, Math.round(savedNasSync.concurrency)))
      : defaultNasSync.concurrency,
  }
  if (hasLegacyNasDebugMode) merged.nasSync = restoreLegacyNasSyncConfig(saved?.nasSyncDebugPrevious, defaultNasSync)
  const legacySettings = merged as AppSettings & LegacyNasSyncDebugSettings
  delete legacySettings.nasSyncDebugMode
  delete legacySettings.nasSyncDebugPrevious
  if (!merged.localResourcesDir) {
    merged.localResourcesDir = getLocalResourcesDir(merged)
  }
  return merged
}

function restoreLegacyNasSyncConfig(value: unknown, fallback: NasSyncSettings): NasSyncSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<Record<keyof NasSyncSettings, unknown>>
    : {}
  const server = typeof source.server === 'string' ? source.server.trim() : fallback.server
  const share = typeof source.share === 'string' ? source.share.trim() : fallback.share
  const remotePath = typeof source.remotePath === 'string' ? source.remotePath.trim() : fallback.remotePath
  const configured = Boolean(server && share && remotePath && validNasPort(source.port))
  const enabled = configured && source.enabled === true
  return {
    enabled,
    autoSync: enabled && source.autoSync === true,
    server,
    port: validNasPort(source.port) ? source.port : fallback.port,
    share,
    remotePath,
    username: typeof source.username === 'string' ? source.username : fallback.username,
    password: typeof source.password === 'string' ? source.password : fallback.password,
    concurrency: typeof source.concurrency === 'number' && Number.isFinite(source.concurrency)
      ? Math.min(10, Math.max(1, Math.round(source.concurrency)))
      : fallback.concurrency,
  }
}

function hasLegacyNasSyncDebugSettings(saved: StoredSettings | null): boolean {
  return Boolean(saved && (
    Object.prototype.hasOwnProperty.call(saved, 'nasSyncDebugMode')
    || Object.prototype.hasOwnProperty.call(saved, 'nasSyncDebugPrevious')
  ))
}

async function readSettingsWithoutWriting(): Promise<AppSettings> {
  return mergeSettings((await readSettingsFile()).value)
}

export async function getSettings(): Promise<AppSettings> {
  await settingsOperation
  const stored = await readSettingsFile()
  const saved = stored.value
  if (!saved) {
    const defaults = defaultSettings()
    await saveSettings(defaults)
    return defaults
  }
  const merged = mergeSettings(saved)
  const hasLegacyLiveSettings = Boolean(saved && (
    Object.prototype.hasOwnProperty.call(saved, 'liveRtmpUrl')
    || Object.prototype.hasOwnProperty.call(saved, 'liveRtmpStreamKey')
  ))
  if (
    stored.fromLegacyPath
    || (saved.downloadDir && !saved.baseDir)
    || saved.experimentalWebGpuExport === true
    || hasLegacyNasSyncDebugSettings(saved)
    || hasLegacyLiveSettings
  ) {
    await writeSettingsFile(merged)
  }
  return merged
}

async function writeSettingsFile(settings: AppSettings): Promise<void> {
  const targetPath = settingsPath()
  const directory = path.dirname(targetPath)
  const temporaryPath = `${targetPath}.${process.pid}.tmp`
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf-8')
  try {
    await fs.rename(temporaryPath, targetPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    throw error
  }
}

export function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  return enqueueSettingsOperation(async () => {
    const current = await readSettingsWithoutWriting()
    const next = {
      ...current,
      ...partial,
      experimentalWebGpuPreview: partial.experimentalWebGpuPreview ?? current.experimentalWebGpuPreview,
      // 视频导出统一使用 Rust/wgpu；忽略旧客户端传入的导出加速开关。
      experimentalWebGpuExport: false,
    }
    const legacySettings = next as AppSettings & LegacyNasSyncDebugSettings
    delete legacySettings.nasSyncDebugMode
    delete legacySettings.nasSyncDebugPrevious
    if (next.nasSync) {
      next.nasSync = {
        ...next.nasSync,
        share: next.nasSync.share.trim(),
        remotePath: next.nasSync.remotePath.trim(),
      }
      if (!validNasPort(next.nasSync.port)) throw new Error('NAS 端口必须是 1 到 65535 的整数')
      if (next.nasSync.enabled && (!next.nasSync.share || !next.nasSync.remotePath)) throw new Error('请先连接 NAS 并选择共享和同步目录')
    }
    next.cacheDir = cacheDir(next.baseDir)
    await writeSettingsFile(next)
    return next
  })
}

export async function chooseBaseDir(): Promise<string | null> {
  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: settings.baseDir,
    properties: ['openDirectory', 'createDirectory'],
    title: '选择基础目录',
  })

  if (result.canceled || result.filePaths.length === 0) return null

  await saveSettings({ baseDir: result.filePaths[0] })
  return result.filePaths[0]
}

export async function chooseLocalResourcesDir(): Promise<string | null> {
  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: getLocalResourcesDir(settings),
    properties: ['openDirectory', 'createDirectory'],
    title: '选择本地资源目录',
  })

  if (result.canceled || result.filePaths.length === 0) return null

  await saveSettings({ localResourcesDir: result.filePaths[0] })
  return result.filePaths[0]
}

export async function chooseExportDir(): Promise<string | null> {
  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: settings.exportDir,
    properties: ['openDirectory', 'createDirectory'],
    title: '选择导出目录',
  })

  if (result.canceled || result.filePaths.length === 0) return null

  await saveSettings({ exportDir: result.filePaths[0] })
  return result.filePaths[0]
}

export async function chooseDirectorPlanDir(): Promise<string | null> {
  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: getDirectorPlanDir(settings),
    properties: ['openDirectory', 'createDirectory'],
    title: '选择导演计划目录',
  })

  if (result.canceled || result.filePaths.length === 0) return null

  await saveSettings({ directorPlanDir: result.filePaths[0] })
  return result.filePaths[0]
}

export async function chooseLutDir(): Promise<string | null> {
  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: settings.lutDir,
    properties: ['openDirectory', 'createDirectory'],
    title: '选择 LUT 滤镜目录（.cube 文件目录树）',
  })

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export async function chooseMockMediaDir(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择 Mock 素材目录',
  })

  if (result.canceled || result.filePaths.length === 0) return null

  await saveSettings({ mockMediaDir: result.filePaths[0] })
  return result.filePaths[0]
}

export async function chooseWorkspaceMediaFiles(): Promise<string[]> {
  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: settings.workspaceImportDir || app.getPath('downloads'),
    properties: ['openFile', 'multiSelections'],
    title: '选择要导入工作台的图片或视频',
    filters: [
      {
        name: '图片和视频',
        extensions: [
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'tiff', 'heic', 'heif',
          'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'm4v', 'lrv', 'ogg',
        ],
      },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) return []

  await saveSettings({ workspaceImportDir: path.dirname(result.filePaths[0]) })
  return result.filePaths
}
