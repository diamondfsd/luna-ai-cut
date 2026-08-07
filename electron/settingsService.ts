import { app, dialog } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { DEFAULT_DEVICE } from './deviceDefaults'
import type { AppSettings } from '../src/shared/types'

const SETTINGS_FILE = 'settings.json'
const WORKSPACE_MEDIA_FILE_LIMIT = 2_000
const WORKSPACE_MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif', '.tiff', '.heic', '.heif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.m4v', '.lrv', '.ogg',
  '.mp3', '.wav', '.m4a', '.aac', '.opus', '.flac', '.lottie',
])

const WORKSPACE_MEDIA_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.wmv': 'video/x-ms-wmv',
  '.mts': 'video/mp2t',
  '.insv': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.lrv': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.lottie': 'application/octet-stream',
}

function e2eWorkspaceMediaPaths(): string[] | null {
  const configuredPaths = process.env.LUNA_E2E_WORKSPACE_MEDIA_PATHS?.trim()
  if (!configuredPaths) return null

  return configuredPaths
    .split(path.delimiter)
    .map((filePath) => filePath.trim())
    .filter(Boolean)
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

export function cacheDir(): string {
  return path.join(app.getPath('userData'), 'cache')
}

/** 获取有效的本地资源目录路径 */
export function getLocalResourcesDir(settings: AppSettings): string {
  return settings.localResourcesDir || path.join(settings.downloadDir, 'localResources')
}

export async function previewCacheDir(): Promise<string> {
  // 使用 userData 目录（C:\Users\<用户>\AppData\Roaming\luna-ai-cut），
  // 不跟 downloadDir 走，避免 SD 卡/U 盘等不可写盘符导致 EPERM
  return path.join(app.getPath('userData'), 'cache_previews')
}

function defaultDownloadDir(): string {
  return path.join(app.getPath('pictures'), 'LunaAI-Cut')
}

function defaultExportDir(): string {
  return path.join(defaultDownloadDir(), 'export')
}

function defaultSettings(): AppSettings {
  const dl = defaultDownloadDir()
  return {
    downloadDir: dl,
    localResourcesDir: path.join(dl, 'localResources'),
    exportDir: defaultExportDir(),
    cacheDir: cacheDir(),
    cameraHost: DEFAULT_DEVICE.defaultHost,
    cameraConnectionMode: 'wireless',
    mountedCameraRoot: '',
    activeDeviceId: DEFAULT_DEVICE.id,
    deviceStorage: { [DEFAULT_DEVICE.id]: 'all' },
    developerMode: false,
    defaultWatermarkEnabled: true,
    defaultWatermarkPosition: 'bottom-center',
    workspacePreviewQuality: 'balanced',
    experimentalGpuPreview: false,
    mockMediaDir: '',
    mockHost: DEFAULT_DEVICE.mock.host,
    mockHttpPort: DEFAULT_DEVICE.mock.httpPort,
    mockTcpPort: DEFAULT_DEVICE.mock.tcpPort,
    mockRateMbps: DEFAULT_DEVICE.mock.rateMbps,
  }
}

async function readSettingsFile(): Promise<Partial<AppSettings> | null> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8')) as Partial<AppSettings>
  } catch {
    return null
  }
}

function mergeSettings(saved: Partial<AppSettings> | null): AppSettings {
  const defaults = defaultSettings()
  const merged = {
    ...defaults,
    ...(saved ?? {}),
    cacheDir: cacheDir(),
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
  merged.experimentalGpuPreview = typeof saved?.experimentalGpuPreview === 'boolean'
    ? saved.experimentalGpuPreview
    : defaults.experimentalGpuPreview
  if (!merged.localResourcesDir) {
    merged.localResourcesDir = getLocalResourcesDir(merged)
  }
  return merged
}

async function readSettingsWithoutWriting(): Promise<AppSettings> {
  return mergeSettings(await readSettingsFile())
}

export async function getSettings(): Promise<AppSettings> {
  const saved = await readSettingsFile()
  if (!saved) {
    const defaults = defaultSettings()
    await saveSettings(defaults)
    return defaults
  }
  return mergeSettings(saved)
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await readSettingsWithoutWriting()
  const next = {
    ...current,
    ...partial,
    cacheDir: cacheDir(),
  }
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export async function chooseDownloadDir(): Promise<string | null> {
  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: settings.downloadDir,
    properties: ['openDirectory', 'createDirectory'],
    title: '选择下载目录',
  })

  if (result.canceled || result.filePaths.length === 0) return null

  await saveSettings({ downloadDir: result.filePaths[0] })
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
  // Playwright cannot operate Electron's native file picker. This keeps the
  // product import flow testable while only accepting explicit test input.
  const testPaths = e2eWorkspaceMediaPaths()
  if (testPaths) return testPaths

  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: settings.workspaceImportDir || app.getPath('downloads'),
    properties: ['openFile', 'multiSelections'],
    title: '选择要导入的素材',
    filters: [
      {
        name: '图片、视频和音频',
        extensions: [
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'tiff', 'heic', 'heif',
          'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'm4v', 'lrv', 'ogg',
          'mp3', 'wav', 'm4a', 'aac', 'opus', 'flac', 'lottie',
        ],
      },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) return []

  await saveSettings({ workspaceImportDir: path.dirname(result.filePaths[0]) })
  return result.filePaths
}

export async function chooseWorkspaceMediaDirectory(): Promise<string[]> {
  const settings = await getSettings()
  const result = await dialog.showOpenDialog({
    defaultPath: settings.workspaceImportDir || app.getPath('downloads'),
    properties: ['openDirectory'],
    title: '选择素材文件夹',
  })

  const rootPath = result.filePaths[0]
  if (result.canceled || !rootPath) return []

  await saveSettings({ workspaceImportDir: rootPath })
  const mediaPaths: string[] = []
  const pendingDirectories = [rootPath]

  while (pendingDirectories.length > 0 && mediaPaths.length < WORKSPACE_MEDIA_FILE_LIMIT) {
    const directory = pendingDirectories.shift()
    if (!directory) continue

    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath)
      } else if (entry.isFile() && WORKSPACE_MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        mediaPaths.push(entryPath)
        if (mediaPaths.length >= WORKSPACE_MEDIA_FILE_LIMIT) break
      }
    }
  }

  return mediaPaths
}

export async function readWorkspaceMediaFile(filePath: string): Promise<{
  name: string
  mimeType: string
  lastModified: number
  bytes: ArrayBuffer
}> {
  if (!path.isAbsolute(filePath)) throw new Error('素材路径无效')

  const extension = path.extname(filePath).toLowerCase()
  if (!WORKSPACE_MEDIA_EXTENSIONS.has(extension)) throw new Error('不支持该素材格式')

  const stat = await fs.lstat(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('素材文件无效')

  const bytes = await fs.readFile(filePath)
  return {
    name: path.basename(filePath),
    mimeType: WORKSPACE_MEDIA_MIME_TYPES[extension] ?? 'application/octet-stream',
    lastModified: stat.mtimeMs,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }
}
