import { app, dialog } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { DEFAULT_DEVICE } from './deviceDefaults'
import type { AppSettings } from '../src/shared/types'

const SETTINGS_FILE = 'settings.json'

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
    activeDeviceId: DEFAULT_DEVICE.id,
    deviceStorage: { [DEFAULT_DEVICE.id]: 'all' },
    developerMode: false,
    exportAppleLivePhoto: false,
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
  const merged = {
    ...defaultSettings(),
    ...(saved ?? {}),
    cacheDir: cacheDir(),
  }
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

export async function chooseMockMediaDir(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择 Mock 素材目录',
  })

  if (result.canceled || result.filePaths.length === 0) return null

  await saveSettings({ mockMediaDir: result.filePaths[0] })
  return result.filePaths[0]
}
