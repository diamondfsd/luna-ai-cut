import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkForUpdates } from './updateService'
import { checkForHotUpdates, getCurrentHotVersion } from './hotUpdater'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { initLogger, logMainInfo, logMainError, logMainWarn, logRendererMessage } from './loggerService'
import { attachWindowCrashDiagnostics, installCrashDiagnostics } from './crashDiagnostics'
import { cameraPathsForFiles } from './cameraDeletePaths'

import {
  getLocalResourcesDir,
  getSettings,
  resolveLocalThumbnails,
  saveSettings,
} from './fileService'
import { DEFAULT_HOST, LunaClient } from './lunaProtocol'
import { GoUltraClient } from './goUltraProtocol'
import { LunaUltraProtocol, GoUltraProtocol } from './deviceProtocols'
import { DEFAULT_DEVICE, GO_ULTRA_DEVICE, deviceDefinitionFor } from './deviceDefaults'
import { deviceProfileForId } from '../src/shared/insta360DeviceProfiles'
import { mockTcpPortForHost, stopMockServer } from './mockServerService'
import { createPreviewTaskQueue } from './previewTaskQueue'
import { appIconPath, createMainWindow } from './windowService'
import { cleanupDeviceDebug, registerDeviceDebugHandlers } from './deviceDebugHandlers'
import { cancelExportTask, warmupRenderCore } from './lunaRenderCore'
import { shutdownSpecializedSegmentationWorker } from './specializedSegmentationService'
import { startSegmentationModelPrefetch, stopSegmentationModelPrefetch } from './segmentationModelPrefetchService'
import type {
  AppSettings,
  DeviceConnectOptions,
  LunaFile,
} from '../src/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const e2eUserDataDir = process.env.LUNA_E2E_USER_DATA_DIR
if (!app.isPackaged && e2eUserDataDir) app.setPath('userData', path.resolve(e2eUserDataDir))

installCrashDiagnostics()

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
const activeDownloadControllers = new Set<AbortController>()
const activeExportControllers = new Map<string, AbortController>()
const activeExportEncoders = new Map<string, import('node:child_process').ChildProcessWithoutNullStreams>()
const activeNativeExportTasks = new Set<string>()
const previewCacheTasks = new Map<string, Promise<boolean>>()
const videoFrameRateTasks = new Map<string, Promise<number | null>>()
const enqueuePreviewTask = createPreviewTaskQueue(2)

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

function attachSourceDevice(files: LunaFile[], deviceId: string): LunaFile[] {
  const device = deviceDefinitionFor(deviceId)
  const profile = deviceProfileForId(deviceId)
  return files.map((file) => ({
    ...file,
    sourceDeviceId: file.sourceDeviceId ?? deviceId,
    sourceDeviceName: file.sourceDeviceName ?? device.name,
    cameraType: file.cameraType ?? profile?.cameraType ?? device.name,
    watermarkProfileId: file.watermarkProfileId ?? profile?.id ?? deviceId,
  }))
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
      for (const [, controller] of activeExportControllers) controller.abort()
      activeExportControllers.clear()
    },
  })
  attachWindowCrashDiagnostics(win)
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void warmupRenderCore().then(
        () => logMainInfo('[LRC] 后台预热完成'),
        (error) => logMainWarn('[LRC] 后台预热失败，将在首次使用时重试', {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }, 200)
    setTimeout(() => startSegmentationModelPrefetch(), 1_000)
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
function abortAllExports() {
  // 取消原生 Rust 导出任务（macOS/Windows GPU 路径 + FFmpeg fallback）
  for (const taskId of activeNativeExportTasks) {
    try { cancelExportTask(taskId) } catch { /* ignore */ }
  }
  activeNativeExportTasks.clear()
  // 杀掉 FFmpeg 子进程（旧导出路径）
  for (const encoder of activeExportEncoders.values()) encoder.kill()
  activeExportEncoders.clear()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    abortAllExports()
    stopAllKeepAlive()
    cleanupDeviceDebug()
    void stopMockServer()
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  abortAllExports()
  stopSegmentationModelPrefetch()
  shutdownSpecializedSegmentationWorker()
  stopAllKeepAlive()
  cleanupDeviceDebug()
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
  // appMain.ts 只负责应用生命周期、共享上下文组装和 IPC 模块注册。
  // 具体 IPC 实现必须拆分到 electron/ipc*.ts 或独立服务模块中，
  // 并通过 Vite 的 import.meta.glob 自动发现注册，避免在这里堆业务逻辑。
  const ctx = {
    get win() {
      return win
    },
    clients,
    goUltraClients,
    activeDownloadControllers,
    activeExportControllers,
    activeExportEncoders,
    activeNativeExportTasks,
    previewCacheTasks,
    videoFrameRateTasks,
    enqueuePreviewTask,
    ensureCameraSessionForFile,
    lunaProtocol,
    goUltraProtocol,
  } as const
  const ipcModules = import.meta.glob('./ipc*.ts', { eager: true })
  for (const [, mod] of Object.entries(ipcModules)) {
    const fn = (mod as any).register
    if (typeof fn === 'function') fn(ctx)
  }

  // ── 渲染进程日志广播 ──
  ipcMain.on('log:renderer', (_event, level: string, message: string, meta?: unknown) => {
    logRendererMessage(level, message, meta)
  })
  ipcMain.on('log:main', (_event, level: string, message: string, meta?: unknown) => {
    if (level === 'error') logMainError(message, meta)
    else if (level === 'warn') logMainWarn(message, meta)
    else logMainInfo(message, meta)
  })

  // ── 设备调试 ──
  registerDeviceDebugHandlers(() => win)
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
      files = attachSourceDevice(files, deviceId)
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
      await resolveLocalThumbnails(files, getLocalResourcesDir(nextSettings))
      return files
    } catch (error) {
      logMainError(`[HTTP读取] 文件列表读取失败`, { host: normalizedHost, storageId: nextStorageId, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })

  ipcMain.handle('luna:deleteCameraFiles', async (_event, files: LunaFile[], host?: string) => {
    if (!Array.isArray(files) || files.length === 0) throw new Error('请先选择要删除的相机素材')
    const settings = await getSettings()
    const normalizedHost = host || settings.cameraHost
    const deviceId = settings.activeDeviceId ?? DEFAULT_DEVICE.id
    if (deviceId !== DEFAULT_DEVICE.id) throw new Error('当前设备暂不支持在应用中删除相机素材')

    const cameraPaths = cameraPathsForFiles(files, normalizedHost)
    logMainInfo('[相机删除] 收到删除请求', {
      host: normalizedHost,
      selectedCount: files.length,
      pathCount: cameraPaths.length,
    })
    try {
      return await lunaProtocol().deleteFiles(cameraPaths, {
        deviceId,
        host: normalizedHost,
      })
    } catch (error) {
      logMainError('[相机删除] 删除失败', {
        host: normalizedHost,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
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
    // 开发环境下跳过所有更新检查
    if (!app.isPackaged) return

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

/** 创建应用菜单，保留文本编辑快捷键（剪切/复制/粘贴/全选） */
function createAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    ...(isMac ? [{
      label: '文件',
      submenu: [
        { role: 'close' as const },
      ],
    }] : []),
    {
      label: 'Edit' as const,
      submenu: [
        { role: 'undo' as const, label: '撤销' },
        { role: 'redo' as const, label: '重做' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '剪切' },
        { role: 'copy' as const, label: '复制' },
        { role: 'paste' as const, label: '粘贴' },
        { role: 'selectAll' as const, label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' as const, label: '重新加载' },
        { role: 'toggleDevTools' as const, label: '开发者工具' },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, label: '重置缩放' },
        { role: 'zoomIn' as const, label: '放大' },
        { role: 'zoomOut' as const, label: '缩小' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: '全屏' },
      ],
    },
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
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
  createAppMenu()
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
