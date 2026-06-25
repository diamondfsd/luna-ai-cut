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

export async function previewCacheDir(): Promise<string> {
  const settings = await getSettings()
  return path.join(settings.downloadDir, 'cache_previews')
}

function defaultDownloadDir(): string {
  return path.join(app.getPath('pictures'), 'LunaAI-Cut')
}

function defaultExportDir(): string {
  return path.join(defaultDownloadDir(), 'export')
}

function defaultSettings(): AppSettings {
  return {
    downloadDir: defaultDownloadDir(),
    exportDir: defaultExportDir(),
    cacheDir: cacheDir(),
    cameraHost: DEFAULT_DEVICE.defaultHost,
    activeDeviceId: DEFAULT_DEVICE.id,
    deviceStorage: { [DEFAULT_DEVICE.id]: 'all' },
    developerMode: false,
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
  return {
    ...defaultSettings(),
    ...(saved ?? {}),
    cacheDir: cacheDir(),
  }
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
