import { app, dialog } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { DEFAULT_DEVICE } from '../devices/definitions/deviceDefaults'
import { migrateBaseDirectory } from './settingsMigration'
import { legacySettingsPath, readStoredSettings, readStoredSettingsSync, stableSettingsPath } from './settingsStorage'
import type { AppSettings } from '../../src/shared/types'

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
    localMediaShareDirectories: [],
    localMediaShareFiles: [],
    windowCloseBehavior: 'hide',
    mockMediaDir: '',
    mockHost: DEFAULT_DEVICE.mock.host,
    mockHttpPort: DEFAULT_DEVICE.mock.httpPort,
    mockTcpPort: DEFAULT_DEVICE.mock.tcpPort,
    mockRateMbps: DEFAULT_DEVICE.mock.rateMbps,
  }
}

type StoredSettings = Partial<AppSettings> & { downloadDir?: string }

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
  if (!merged.localResourcesDir) {
    merged.localResourcesDir = getLocalResourcesDir(merged)
  }
  return merged
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
  if (
    stored.fromLegacyPath
    || (saved.downloadDir && !saved.baseDir)
    || saved.experimentalWebGpuExport === true
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
