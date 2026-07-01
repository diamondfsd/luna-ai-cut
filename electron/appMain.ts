import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { checkForUpdates } from './updateService'
import type { HotUpdateCheckResult } from './hotUpdater'
import { checkForHotUpdates, applyHotUpdate, getCurrentHotVersion, clearHotUpdate } from './hotUpdater'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { clearLogs, getLogDir, initLogger, logMainDebug, logMainInfo, logMainError, logMainWarn, logExport, logRendererMessage } from './loggerService'

import {
  cacheFile,
  chooseMockMediaDir,
  chooseDownloadDir,
  chooseExportDir,
  chooseLocalResourcesDir,
  getLocalResourcesDir,
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
import { GoUltraClient } from './goUltraProtocol'
import { LunaUltraProtocol, GoUltraProtocol } from './deviceProtocols'
import { DEFAULT_DEVICE, GO_ULTRA_DEVICE, deviceDefinitionFor, deviceDefinitions } from './deviceDefaults'
import { getMockStatus, mockTcpPortForHost, startMockServer, stopMockServer } from './mockServerService'
import { createPreviewTaskQueue } from './previewTaskQueue'
import { appIconPath, createMainWindow } from './windowService'
import { chatCompletion } from './aiService'
import { openWifiSettings } from './wifiService'
import { registerDeviceDebugHandlers } from './deviceDebugHandlers'
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
const goUltraClients = new Map<string, GoUltraClient>()
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
  for (const client of goUltraClients.values()) {
    client.stopKeepAlive()
    client.close()
  }
  goUltraClients.clear()
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
    logMainWarn(`[保活] 保活失败，通知渲染进程连接丢失`, { host: normalizedHost })
    win?.webContents.send('luna:connection-lost')
  }
  clients.set(key, client)
  return client
}

function lunaProtocol(): LunaUltraProtocol {
  return new LunaUltraProtocol(
    clientFor,
    (host) => controlPortForCurrentSettings(host),
    () => {
      logMainWarn(`[设备协议] 连接丢失回调触发，通知渲染进程`)
      win?.webContents.send('luna:connection-lost')
    },
  )
}

/** Go Ultra 客户端工厂（复用 LuaClient 类似的缓存模式） */
function goUltraClientFor(host = GO_ULTRA_DEVICE.defaultHost): GoUltraClient {
  const normalizedHost = host.trim() || GO_ULTRA_DEVICE.defaultHost
  const key = normalizedHost
  const existing = goUltraClients.get(key)
  if (existing) return existing

  const client = new GoUltraClient(normalizedHost, GO_ULTRA_DEVICE.controlPort)
  client.onConnectionLost = () => {
    logMainWarn(`[GoUltra] 连接丢失`, { host: normalizedHost })
    win?.webContents.send('luna:connection-lost')
  }
  goUltraClients.set(key, client)
  return client
}

function goUltraProtocol(): GoUltraProtocol {
  return new GoUltraProtocol(
    (host) => goUltraClientFor(host),
    () => {
      logMainWarn(`[GoUltra] 连接丢失回调触发，通知渲染进程`)
      win?.webContents.send('luna:connection-lost')
    },
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
  // 渲染进程日志
  ipcMain.on('log:renderer', (_event, level: string, message: string, meta?: unknown) => {
    logRendererMessage(level, message, meta)
  })

  // 注册设备调试服务（一键测试 + 独立日志）
  registerDeviceDebugHandlers(() => win)

  // 导出日志
  ipcMain.handle('log:export', (_event, message: string, meta?: unknown) => {
    logExport('INFO', message, meta)
    return true
  })

  // 主进程日志（供渲染进程直接调用）
  ipcMain.on('log:main', (_event, level: string, message: string, meta?: unknown) => {
    if (level === 'error') logMainError(message, meta)
    else if (level === 'warn') logMainWarn(message, meta)
    else logMainInfo(message, meta)
  })

  // 获取日志目录
  ipcMain.handle('log:getDir', () => getLogDir())
  // 清空日志
  ipcMain.handle('log:clear', () => clearLogs())

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: Partial<AppSettings>) => saveSettings(settings))
  ipcMain.handle('devices:list', () => deviceDefinitions())
  ipcMain.handle('settings:chooseDownloadDir', () => chooseDownloadDir())
  ipcMain.handle('settings:chooseLocalResourcesDir', () => chooseLocalResourcesDir())
  ipcMain.handle('settings:chooseExportDir', () => chooseExportDir())
  ipcMain.handle('settings:chooseMockMediaDir', () => chooseMockMediaDir())
  ipcMain.handle('mock:start', (_event, settings?: Partial<AppSettings>) => startMockServer(settings))
  ipcMain.handle('mock:stop', () => stopMockServer())
  ipcMain.handle('mock:status', () => getMockStatus())
  ipcMain.handle('cache:stats', () => getCacheStats())
  ipcMain.handle('cache:clear', () => clearCache())
  ipcMain.handle('downloads:records', async (_event, files: LunaFile[], _downloadDir?: string) => {
    const settings = await getSettings()
    return getDownloadedRecords(files, getLocalResourcesDir(settings))
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
    const host = options?.host || settings.cameraHost || DEFAULT_HOST
    logMainInfo(`[设备连接] 开始连接设备`, { deviceId, host, options })

    // 根据设备 ID 路由到对应协议
    let protocol: LunaUltraProtocol | GoUltraProtocol
    switch (deviceId) {
      case 'go-ultra':
        protocol = goUltraProtocol()
        break
      case 'luna-ultra':
      default:
        protocol = lunaProtocol()
        break
    }

    try {
      const status = await protocol.connect({ ...options, deviceId })
      logMainInfo(`[设备连接] 连接结果`, { deviceId, host, httpOk: status.httpOk, controlOk: status.controlOk, message: status.message })
      return status
    } catch (error) {
      logMainError(`[设备连接] 连接异常`, { deviceId, host, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })

  ipcMain.handle('luna:checkConnection', async (_event, host?: string) => {
    const settings = await getSettings()
    const normalizedHost = host || settings.cameraHost
    const deviceId = settings.activeDeviceId ?? DEFAULT_DEVICE.id
    logMainInfo(`[HTTP检测] 检查设备连接状态`, { host: normalizedHost, deviceId })
    try {
      let protocol: LunaUltraProtocol | GoUltraProtocol
      switch (deviceId) {
        case 'go-ultra':
          protocol = goUltraProtocol()
          break
        default:
          protocol = lunaProtocol()
          break
      }
      const status = await protocol.checkStatus(normalizedHost)
      logMainInfo(`[HTTP检测] 连接状态结果`, { host: normalizedHost, httpOk: status.httpOk, controlOk: status.controlOk, message: status.message })
      return status
    } catch (error) {
      logMainError(`[HTTP检测] 检查连接异常`, { host: normalizedHost, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })

  ipcMain.handle('luna:listFiles', async (_event, host?: string, storageId?: string) => {
    const settings = await getSettings()
    const normalizedHost = host || settings.cameraHost
    const deviceId = settings.activeDeviceId ?? DEFAULT_DEVICE.id
    const nextStorageId = storageId ?? settings.deviceStorage?.[deviceId] ?? 'all'
    logMainInfo(`[HTTP读取] 开始读取文件列表`, { host: normalizedHost, storageId: nextStorageId, deviceId })
    const t0 = performance.now()
    try {
      let files: LunaFile[]
      switch (deviceId) {
        case 'go-ultra': {
          const protocol = goUltraProtocol()
          files = await protocol.listFiles({ deviceId, host: normalizedHost, storageId: nextStorageId })
          break
        }
        default: {
          const protocol = lunaProtocol()
          files = await protocol.listFiles({ deviceId, host: normalizedHost, storageId: nextStorageId })
        }
      }
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
      logMainInfo(`[HTTP读取] 文件列表读取完成`, { host: normalizedHost, storageId: nextStorageId, fileCount: files.length, elapsedSec: elapsed })
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
    } catch (error) {
      logMainError(`[HTTP读取] 文件列表读取失败`, { host: normalizedHost, storageId: nextStorageId, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })

  ipcMain.handle('luna:cacheFile', async (_event, file: LunaFile) => {
    const key = file.id || file.name
    const existingTask = previewCacheTasks.get(key)
    if (existingTask) {
      logMainDebug(`[缓存] 缓存任务已存在，复用`, { key, fileName: file.name })
      return existingTask
    }
    logMainInfo(`[缓存] 开始缓存文件`, { key, fileName: file.name, kind: file.kind })

    const task = enqueuePreviewTask(async () => {
      let cacheFilePath: string | null = null
      try {
        cacheFilePath = await cacheFile(file)
        if (cacheFilePath) {
          logMainInfo(`[缓存] 文件缓存成功，开始生成缩略图`, { key, fileName: file.name, cacheFilePath })
          // 通过队列生成缩略图（串行，避免卡死）
          const cacheDir = await previewCacheDir()
          const thumbDir = thumbnailDir(cacheDir)
          const thumbnailKey = file.downloadName || file.name
          const thumbPath = await enqueueThumbnailGeneration(cacheFilePath, thumbDir, thumbnailKey, file.kind, file.name)
          if (thumbPath) {
            logMainInfo(`[缓存] 缩略图生成成功`, { key, fileName: file.name })
            // 缩略图生成成功
            win?.webContents.send('luna:thumbnail-ready', {
              fileId: file.id,
              fileName: file.name,
              downloadName: file.downloadName,
              cacheFilePath,
              thumbnailUrl: pathToFileURL(thumbPath).toString(),
            })
          } else {
            logMainWarn(`[缓存] 缩略图生成失败，清理损坏的缓存文件`, { key, fileName: file.name, cacheFilePath })
            // 缩略图生成失败（如源文件损坏），删除缓存文件让下次重试能重新下载
            await rm(cacheFilePath, { force: true, maxRetries: 3 }).catch(() => {})
            win?.webContents.send('luna:thumbnail-ready', {
              fileId: file.id,
              fileName: file.name,
              downloadName: file.downloadName,
              cacheFilePath: null,
              thumbnailUrl: null,
            })
          }
        }
        if (!cacheFilePath) {
          logMainWarn(`[缓存] 缓存文件失败`, { key, fileName: file.name })
        }
        return cacheFilePath !== null
      } catch (err) {
        logMainError(`[缓存] 缓存任务异常`, {
          key,
          fileName: file.name,
          kind: file.kind,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
        return false
      }
    }, 0).finally(() => {
      previewCacheTasks.delete(key)
      logMainDebug(`[缓存] 缓存任务结束`, { key, fileName: file.name })
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
    logMainInfo(`[设备断开] 断开设备连接`, { host: normalizedHost })

    // 清理 Luna 连接
    const match = [...clients.entries()].find(([key]) => key.startsWith(`${normalizedHost}:`))
    const client = match?.[1]
    if (client && match) {
      client.stopKeepAlive()
      client.close()
      clients.delete(match[0])
      logMainInfo(`[设备断开] Luna 连接已关闭`, { host: normalizedHost })
    }

    // 清理 Go Ultra 连接
    const goUltraClient = goUltraClients.get(normalizedHost)
    if (goUltraClient) {
      goUltraClient.stopKeepAlive()
      goUltraClient.close()
      goUltraClients.delete(normalizedHost)
      logMainInfo(`[设备断开] Go Ultra 连接已关闭`, { host: normalizedHost })
    }
  })

  ipcMain.handle('luna:listSampleFiles', async () => {
    const settings = await getSettings()
    return listSampleFiles(settings.mockMediaDir)
  })
  ipcMain.handle('downloads:listFiles', async (_event, _downloadDir?: string) => {
    const settings = await getSettings()
    const resolvedDir = getLocalResourcesDir(settings)
    logMainInfo('[下载列表] 读取目录', { resolvedDir, localResourcesDir: settings.localResourcesDir, downloadDir: settings.downloadDir })
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
  ipcMain.handle('luna:downloadFiles', async (_event, files: LunaFile[], _downloadDir?: string) => {
    const settings = await getSettings()
    logMainInfo(`[下载] 开始下载文件`, { fileCount: files.length, fileNames: files.map(f => f.name).slice(0, 5).join(', ') + (files.length > 5 ? `...(+${files.length - 5})` : '') })
    const needsCameraSession = files.some((file) => !(file.sourceUrl || file.url).startsWith('file:'))
    const client = needsCameraSession ? clientFor(settings.cameraHost, controlPortFor(settings, settings.cameraHost)) : null
    if (client) {
      logMainDebug(`[下载] 需要设备会话，建立连接`, { host: settings.cameraHost })
      await client.connect()
      // 下载期间用更短的间隔保活（默认15s，下载可能较长）
      client.startKeepAlive()
    } else {
      logMainDebug(`[下载] 无需设备会话（本地文件）`)
    }

    const controller = new AbortController()
    activeDownloadControllers.add(controller)
    try {
      return await downloadFiles(files, getLocalResourcesDir(settings), (progress: DownloadProgress) => {
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

  // 手动触发更新检查（全量 + 热更新一并检查）
  ipcMain.handle('update:check', async () => {
    const fullInfo = await checkForUpdates()
    if (fullInfo) return fullInfo

    // 没有全量更新时检查热更新，热更新通过 hot-update:available 事件通知
    const hotInfo = await checkForHotUpdates()
    if (hotInfo && win && !win.isDestroyed()) {
      win.webContents.send('hot-update:available', hotInfo)
    }
    return null
  })

  // ── 热更新 ──

  // 获取当前热更新版本
  ipcMain.handle('hot-update:current-version', () => {
    return getCurrentHotVersion()
  })

  // 检查热更新
  ipcMain.handle('hot-update:check', async (): Promise<HotUpdateCheckResult | null> => {
    return checkForHotUpdates()
  })

  // 应用热更新（下载 + 解压）
  ipcMain.handle('hot-update:apply', async (_event, info: HotUpdateCheckResult): Promise<{ success: boolean; error?: string }> => {
    try {
      logMainInfo(`开始应用热更新: ${info.version}, 下载地址: ${info.downloadUrl}`)
      await applyHotUpdate(info)
      const appliedVersion = getCurrentHotVersion()
      logMainInfo(`热更新应用完成, 本地版本: ${appliedVersion}`)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logMainError(`热更新应用失败: ${message}`)
      return { success: false, error: message }
    }
  })

  // 清除热更新，回退到 asar 内置版本
  ipcMain.handle('hot-update:clear', () => {
    clearHotUpdate()
  })

  // 触发 app 重启
  ipcMain.handle('hot-update:relaunch', () => {
    app.relaunch()
    app.exit(0)
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

  // 延迟 2s 执行首次检查
  setTimeout(async () => {
    // 全量更新检查：受每日限制
    if (existsSync(CHECK_FILE) && readFileSync(CHECK_FILE, 'utf-8').trim() === today) {
      // 今天已检查过全量更新，跳过
    } else {
      const info = await checkForUpdates()
      if (info && win && !win.isDestroyed()) {
        win.webContents.send('update:available', info)
      }
      // 记录检查日期
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(CHECK_FILE, today, 'utf-8')
    }

    // 热更新检查：每次启动都检查（不受每日限制）
    const hotInfo = await checkForHotUpdates()
    if (hotInfo && win && !win.isDestroyed()) {
      win.webContents.send('hot-update:available', hotInfo)
    }
  }, 2_000)
}

app.whenReady().then(() => {
  initLogger()
  logMainInfo('应用启动')
  // 打印系统信息
  logMainInfo('[系统信息]', {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    cpuCount: os.cpus().length,
    totalMemory: `${Math.round(os.totalmem() / (1024 ** 3))}G`,
    userData: app.getPath('userData').replace(process.env.USERPROFILE || process.env.HOME || '', '~'),
  })
  Menu.setApplicationMenu(null)
  registerIpc()
  scheduleUpdateCheck()
  createWindow()

  // 设置窗口标题（含版本号，有热更新则追加 hot build 号）
  const hotVersion = !app.isPackaged ? null : getCurrentHotVersion()
  const titleSuffix = hotVersion ? `-${hotVersion.split('-').pop()}` : ''
  const title = `Luna AI Cut v${app.getVersion()}${titleSuffix}`
  logMainInfo(`设置窗口标题: ${title}`)
  if (win && !win.isDestroyed()) {
    win.setTitle(title)
  }
})
