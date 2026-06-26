import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkForUpdates } from './updateService'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

import {
  cacheFile,
  chooseMockMediaDir,
  chooseDownloadDir,
  chooseExportDir,
  clearCache,
  deleteLocalFiles,
  downloadFiles,
  exportFiles,
  listExportFiles,
  getCacheStats,
  getDownloadedRecords,
  listDownloadedFiles,
  getMediaMetadata,
  getVideoFrameRate,
  getSettings,
  previewCacheDir,
  previewFile,
  previewLivePhoto,
  previewWithWatermark,
  openPath,
  resolveLocalThumbnails,
  revealFile,
  saveSettings,
} from './fileService'
import { listSampleFiles } from './localMedia'
import { DEFAULT_HOST, LunaClient } from './lunaProtocol'
import { LunaUltraProtocol } from './deviceProtocols'
import { DEFAULT_DEVICE, deviceDefinitionFor, deviceDefinitions } from './deviceDefaults'
import { getMockStatus, mockTcpPortForHost, startMockServer, stopMockServer } from './mockServerService'
import { createPreviewTaskQueue } from './previewTaskQueue'
import { appIconPath, createMainWindow } from './windowService'
import { chatCompletion } from './aiService'
import { openWifiSettings } from './wifiService'
import {
  checkWifiPort,
  connectWifiNetwork,
  disconnectWifiNetwork,
  getWifiDebugStatus,
  requestWifiHttp,
  scanWifiNetworks,
} from './wifiDebugService'
import { cancelBluetoothScan, scanBluetoothDevices } from './bluetoothDebugService'
import { enqueueThumbnailGeneration, thumbnailDir } from './thumbnailService'
import type {
  AiConfig,
  AppSettings,
  DeviceConnectOptions,
  DownloadProgress,
  LunaFile,
  VideoExportSettings,
  WatermarkSettings,
  WifiConnectOptions,
  WifiHttpRequestOptions,
  WifiPortCheckOptions,
} from '../src/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
const clients = new Map<string, LunaClient>()
let activeDownloadControllers = new Set<AbortController>()
let activeExportControllers = new Set<AbortController>()
const previewCacheTasks = new Map<string, Promise<boolean>>()
const videoFrameRateTasks = new Map<string, Promise<number | null>>()
const enqueuePreviewTask = createPreviewTaskQueue(10)

/** 停止所有客户端的保活并清理 */
function stopAllKeepAlive(): void {
  for (const client of clients.values()) {
    client.stopKeepAlive()
    client.close()
  }
  clients.clear()
}

function clientKey(host: string, controlPort: number): string {
  return `${host.trim() || DEFAULT_HOST}:${controlPort}`
}

function mockCameraHost(settings: AppSettings): string {
  const device = deviceDefinitionFor(settings.activeDeviceId)
  return `${settings.mockHost || device.mock.host}:${settings.mockHttpPort || device.mock.httpPort}`
}

function controlPortFor(settings: AppSettings, host: string): number {
  const device = deviceDefinitionFor(settings.activeDeviceId)
  return settings.developerMode && (host.trim() || DEFAULT_HOST) === mockCameraHost(settings)
    ? settings.mockTcpPort || device.mock.tcpPort
    : device.controlPort
}

function clientFor(host = DEFAULT_HOST, controlPort = DEFAULT_DEVICE.controlPort): LunaClient {
  const normalizedHost = host.trim() || DEFAULT_HOST
  const key = clientKey(normalizedHost, controlPort)
  const existing = clients.get(key)
  if (existing) return existing

  const client = new LunaClient(normalizedHost, controlPort)
  // 保活失败时通知渲染进程
  client.onKeepAliveFailed = () => {
    win?.webContents.send('luna:connection-lost')
  }
  clients.set(key, client)
  return client
}

function lunaProtocol(): LunaUltraProtocol {
  return new LunaUltraProtocol(
    clientFor,
    (host) => controlPortForCurrentSettings(host),
    () => win?.webContents.send('luna:connection-lost'),
  )
}

function controlPortForCurrentSettings(host: string): number {
  return mockTcpPortForHost(host) ?? DEFAULT_DEVICE.controlPort
}

function sourceHostFor(url: string | null | undefined): string | null {
  if (!url || url.startsWith('file:')) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

async function ensureCameraSessionForUrl(url: string | null | undefined): Promise<void> {
  const host = sourceHostFor(url)
  if (!host) return
  const settings = await getSettings()
  const client = clientFor(host, controlPortFor(settings, host))
  await client.connect()
  client.startKeepAlive()
}

async function ensureCameraSessionForFile(file: LunaFile, url = file.sourceUrl || file.url): Promise<void> {
  await ensureCameraSessionForUrl(url)
}

function createWindow(): void {
  win = createMainWindow({
    devServerUrl: VITE_DEV_SERVER_URL,
    iconPath: appIconPath(process.env.APP_ROOT),
    preloadPath: path.join(__dirname, 'preload.mjs'),
    rendererDist: RENDERER_DIST,
    hasActiveDownloads: () => activeDownloadControllers.size > 0,
    hasActiveExports: () => activeExportControllers.size > 0,
    abortDownloads: () => {
      for (const controller of activeDownloadControllers) controller.abort()
      activeDownloadControllers.clear()
    },
    abortExports: () => {
      for (const controller of activeExportControllers) controller.abort()
      activeExportControllers.clear()
    },
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAllKeepAlive()
    void stopMockServer()
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  stopAllKeepAlive()
  void stopMockServer()
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: Partial<AppSettings>) => saveSettings(settings))
  ipcMain.handle('devices:list', () => deviceDefinitions())
  ipcMain.handle('settings:chooseDownloadDir', () => chooseDownloadDir())
  ipcMain.handle('settings:chooseExportDir', () => chooseExportDir())
  ipcMain.handle('settings:chooseMockMediaDir', () => chooseMockMediaDir())
  ipcMain.handle('mock:start', (_event, settings?: Partial<AppSettings>) => startMockServer(settings))
  ipcMain.handle('mock:stop', () => stopMockServer())
  ipcMain.handle('mock:status', () => getMockStatus())
  ipcMain.handle('cache:stats', () => getCacheStats())
  ipcMain.handle('cache:clear', () => clearCache())
  ipcMain.handle('downloads:records', async (_event, files: LunaFile[], downloadDir?: string) => {
    const settings = await getSettings()
    return getDownloadedRecords(files, downloadDir || settings.downloadDir)
  })

  ipcMain.handle('wifi:openSettings', () => openWifiSettings())
  if (VITE_DEV_SERVER_URL) {
    ipcMain.handle('wifiDebug:getStatus', () => getWifiDebugStatus())
    ipcMain.handle('wifiDebug:scan', () => scanWifiNetworks())
    ipcMain.handle('wifiDebug:connect', (_event, options: WifiConnectOptions) => connectWifiNetwork(options))
    ipcMain.handle('wifiDebug:disconnect', () => disconnectWifiNetwork())
    ipcMain.handle('wifiDebug:checkPort', (_event, options: WifiPortCheckOptions) => checkWifiPort(options))
    ipcMain.handle('wifiDebug:httpRequest', (_event, options: WifiHttpRequestOptions) => requestWifiHttp(options))
  }
  ipcMain.handle('bluetooth:scanNative', async (_event, timeoutMs?: number) => {
    const result = await scanBluetoothDevices(timeoutMs)
    if (result.code === 'CANCELLED') return []  // 取消不抛错，返回空列表
    if (!result.success) throw new Error(result.message)
    return result.data ?? []
  })
  ipcMain.handle('bluetooth:cancelScan', () => {
    cancelBluetoothScan()
  })
  ipcMain.handle('devtools:open', () => {
    const bw = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    bw?.webContents.openDevTools({ mode: 'detach' })
  })

  ipcMain.handle('device:connect', async (_event, options?: DeviceConnectOptions) => {
    const settings = await getSettings()
    const deviceId = options?.deviceId ?? settings.activeDeviceId ?? DEFAULT_DEVICE.id
    if (deviceId !== DEFAULT_DEVICE.id) throw new Error(`未支持的设备协议：${deviceId}`)
    return lunaProtocol().connect({ ...options, deviceId })
  })

  ipcMain.handle('luna:checkConnection', async (_event, host?: string) => {
    const settings = await getSettings()
    const normalizedHost = host || settings.cameraHost
    return lunaProtocol().checkStatus(normalizedHost)
  })

  ipcMain.handle('luna:listFiles', async (_event, host?: string, storageId?: string) => {
    const settings = await getSettings()
    const normalizedHost = host || settings.cameraHost
    const deviceId = settings.activeDeviceId ?? DEFAULT_DEVICE.id
    const nextStorageId = storageId ?? settings.deviceStorage?.[deviceId] ?? 'all'
    const files = await lunaProtocol().listFiles({ deviceId, host: normalizedHost, storageId: nextStorageId })
    await saveSettings({
      cameraHost: normalizedHost,
      deviceStorage: {
        ...(settings.deviceStorage ?? {}),
        [deviceId]: nextStorageId,
      },
    })
    // 将已存在于下载目录或缓存的本地路径写回文件对象
    const nextSettings = await getSettings()
    if (nextSettings.downloadDir) {
      await resolveLocalThumbnails(files, nextSettings.downloadDir)
    }
    return files
  })

  ipcMain.handle('luna:cacheFile', async (_event, file: LunaFile) => {
    const key = file.id || file.name
    const existingTask = previewCacheTasks.get(key)
    if (existingTask) return existingTask

    const task = enqueuePreviewTask(async () => {
      const cacheFilePath = await cacheFile(file)
      if (cacheFilePath) {
        // 通过队列生成缩略图（串行，避免卡死）
        const cacheDir = await previewCacheDir()
        const thumbDir = thumbnailDir(cacheDir)
        const thumbnailKey = file.downloadName || file.name
        const thumbPath = await enqueueThumbnailGeneration(cacheFilePath, thumbDir, thumbnailKey, file.kind, file.name)
        win?.webContents.send('luna:thumbnail-ready', {
          fileId: file.id,
          fileName: file.name,
          downloadName: file.downloadName,
          cacheFilePath,
          thumbnailUrl: thumbPath ? pathToFileURL(thumbPath).toString() : pathToFileURL(cacheFilePath).toString(),
        })
      }
      return cacheFilePath !== null
    }, 0).finally(() => {
      previewCacheTasks.delete(key)
    })
    previewCacheTasks.set(key, task)
    return task
  })

  ipcMain.handle('luna:requestVideoFrameRate', async (_event, file: LunaFile, cachedPath?: string | null) => {
    const sourcePath = cachedPath ?? file.downloadFilePath ?? file.localPath ?? null
    const key = `${file.id || file.name}:${sourcePath ?? ''}`
    const existingTask = videoFrameRateTasks.get(key)
    if (existingTask) return existingTask

    const task = enqueuePreviewTask(async () => {
      const result = await getVideoFrameRate(file, sourcePath)
      if (result.frameRate !== null || result.duration !== null) {
        win?.webContents.send('luna:video-frame-rate-ready', {
          fileId: file.id,
          fileName: file.name,
          frameRate: result.frameRate,
          duration: result.duration,
        })
      }
      return result.frameRate
    }, 0).finally(() => {
      videoFrameRateTasks.delete(key)
    })
    videoFrameRateTasks.set(key, task)
    return task
  })

  ipcMain.handle('luna:disconnect', (_event, host?: string) => {
    const normalizedHost = (host?.trim() || DEFAULT_HOST)
    const match = [...clients.entries()].find(([key]) => key.startsWith(`${normalizedHost}:`))
    const client = match?.[1]
    if (client && match) {
      client.stopKeepAlive()
      client.close()
      clients.delete(match[0])
    }
  })

  ipcMain.handle('luna:listSampleFiles', async () => {
    const settings = await getSettings()
    return listSampleFiles(settings.mockMediaDir)
  })
  ipcMain.handle('downloads:listFiles', async (_event, downloadDir?: string) => {
    const settings = await getSettings()
    const resolvedDir = downloadDir || settings.downloadDir
    const files = await listDownloadedFiles(resolvedDir)
    if (resolvedDir) {
      // 优先检测已有缩略图，设置 thumbnailUrl（同步返回给渲染层）
      await resolveLocalThumbnails(files, resolvedDir)
    }
    return files
  })

  ipcMain.handle('exports:listFiles', async (_event, exportDir?: string) => {
    const settings = await getSettings()
    const resolvedDir = exportDir || settings.exportDir || ''
    if (!resolvedDir) return []
    return listExportFiles(resolvedDir)
  })

  ipcMain.handle('luna:previewFile', async (_event, file: LunaFile) => {
    return enqueuePreviewTask(async () => {
      await ensureCameraSessionForFile(file)
      return previewFile(file)
    }, 2)
  })
  ipcMain.handle('luna:previewLivePhoto', async (_event, file: LunaFile) => {
    return enqueuePreviewTask(async () => {
      await ensureCameraSessionForFile(file)
      return previewLivePhoto(file)
    }, 2)
  })
  ipcMain.handle('luna:previewWithWatermark', async (_event, file: LunaFile, sourcePath: string, settings: import('../src/shared/types').WatermarkSettings) => {
    return previewWithWatermark(file, sourcePath, settings)
  })
  ipcMain.handle('luna:metadata', async (_event, file: LunaFile, cachedPath?: string | null) => {
    return enqueuePreviewTask(async () => {
      await ensureCameraSessionForFile(file)
      return getMediaMetadata(file, cachedPath)
    }, 1)
  })
  ipcMain.handle('files:reveal', (_event, filePath: string) => revealFile(filePath))
  ipcMain.handle('files:openPath', (_event, targetPath: string) => openPath(targetPath))
  ipcMain.handle('files:deleteLocal', (_event, filePaths: string[]) => deleteLocalFiles(filePaths))
  ipcMain.handle('ai:chat', async (_event, config: AiConfig, systemPrompt: string, messages: Array<{ role: string; content: string }>) => {
    return chatCompletion(config, systemPrompt, messages as Array<{ role: 'user' | 'assistant'; content: string }>)
  })
  ipcMain.handle('luna:downloadFiles', async (_event, files: LunaFile[], downloadDir?: string) => {
    const settings = await getSettings()
    const needsCameraSession = files.some((file) => !(file.sourceUrl || file.url).startsWith('file:'))
    const client = needsCameraSession ? clientFor(settings.cameraHost, controlPortFor(settings, settings.cameraHost)) : null
    if (client) {
      await client.connect()
      // 下载期间用更短的间隔保活（默认15s，下载可能较长）
      client.startKeepAlive()
    }

    const controller = new AbortController()
    activeDownloadControllers.add(controller)
    try {
      return await downloadFiles(files, downloadDir || settings.downloadDir, (progress: DownloadProgress) => {
        win?.webContents.send('download:progress', progress)
      }, controller.signal)
    } finally {
      activeDownloadControllers.delete(controller)
      // 不停止 Keeper — listFiles 时已启动，让它在整个会话期间持续运行
    }
  })

  ipcMain.handle('luna:exportFiles', (_event, files: Array<{ name: string; kind: string; localPath?: string }>, exportDir: string, watermarkSettings: WatermarkSettings, videoExportSettings?: VideoExportSettings) => {
    const controller = new AbortController()
    activeExportControllers.add(controller)
    return exportFiles(files, exportDir, watermarkSettings, (progress) => {
      win?.webContents.send('export:progress', progress)
    }, controller.signal, videoExportSettings)
      .finally(() => activeExportControllers.delete(controller))
  })

  ipcMain.handle('luna:cancelDownloads', () => {
    for (const controller of activeDownloadControllers) {
      controller.abort()
    }
    activeDownloadControllers.clear()
  })

  ipcMain.handle('luna:cancelExports', () => {
    for (const controller of activeExportControllers) {
      controller.abort()
    }
    activeExportControllers.clear()
  })

  // 手动触发更新检查
  ipcMain.handle('update:check', async () => {
    return checkForUpdates()
  })

  // 获取更新说明列表
  ipcMain.handle('release-notes:list', async (): Promise<Array<{ version: string; content: string }>> => {
    const notesDir = app.isPackaged
      ? join(process.resourcesPath)
      : join(app.getAppPath())
    const prefix = 'RELEASE_NOTES_v'
    try {
      const files = readdirSync(notesDir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.md'))

      // 按语义化版本号从新到旧排序
      files.sort((a, b) => {
        const va = a.match(/(\d+)\.(\d+)\.(\d+)/)
        const vb = b.match(/(\d+)\.(\d+)\.(\d+)/)
        if (!va || !vb) return b.localeCompare(a)
        for (let i = 1; i <= 3; i++) {
          const diff = Number(vb[i]) - Number(va[i])
          if (diff !== 0) return diff
        }
        return 0
      })

      return files.slice(0, 5).map(f => {
        const version = f.slice(prefix.length, -'.md'.length)
        const content = readFileSync(join(notesDir, f), 'utf-8')
        return { version, content }
      })
    } catch {
      return []
    }
  })
}

/**
 * 每天最多检查一次更新
 */
function scheduleUpdateCheck(): void {
  const CHECK_FILE = join(app.getPath('userData'), '.last-update-check')
  const today = new Date().toISOString().slice(0, 10) // "2026-06-25"

  // 今天已经检查过了，跳过
  if (existsSync(CHECK_FILE) && readFileSync(CHECK_FILE, 'utf-8').trim() === today) {
    return
  }

  // 延迟 10s 执行首次检查
  setTimeout(async () => {
    const info = await checkForUpdates()
    if (info && win && !win.isDestroyed()) {
      win.webContents.send('update:available', info)
    }
    // 记录检查日期
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(CHECK_FILE, today, 'utf-8')
  }, 10_000)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpc()
  scheduleUpdateCheck()
  createWindow()
})
