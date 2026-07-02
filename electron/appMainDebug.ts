/**
 * appMainDebug.ts — 设备调试版主进程
 *
 * 精简版，仅包含设备调试功能：
 * - 创建设备调试窗口
 * - 注册设备调试 IPC 处理器
 * - 无热更新、无 AI、无蓝牙、无缩略图、无导出等
 */

import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { registerDeviceDebugHandlers, cleanupDeviceDebug } from './deviceDebugHandlers'
import { deviceDefinitions } from './deviceDefaults'
import { getSettings, openPath } from './fileService'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '..')

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist-debug')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    title: 'Luna Device Debug',
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    icon: path.join(process.env.APP_ROOT, 'build-debug', process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  // 阻止 HTML <title> 覆盖窗口标题
  win.on('page-title-updated', (event) => event.preventDefault())

  win.on('closed', () => { win = null })

  if (VITE_DEV_SERVER_URL) {
    // 开发模式加载 Vite 服务器地址，并路由到设备调试页面
    win.loadURL(`${VITE_DEV_SERVER_URL}/#/device-debug`)
  } else {
    // 生产模式加载构建产物，hash 路由直接定位到设备调试页面
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), {
      hash: '/device-debug',
    })
  }

  // 自动打开开发者工具，方便排查白屏等问题
  win.webContents.openDevTools()

  return win
}

function registerIpc(): void {
  // 注册设备调试处理器
  registerDeviceDebugHandlers(() => win)

  // 注册 DeviceConnectionContext 依赖的基础处理器
  // 设置读写（返回默认值）
  ipcMain.handle('settings:get', async () => {
    return await getSettings()
  })
  ipcMain.handle('settings:save', async (_event, _settings: Record<string, unknown>) => {
    return await getSettings()
  })
  // 设备列表
  ipcMain.handle('devices:list', async () => {
    return deviceDefinitions()
  })

  // 文件操作（用于打开日志文件等）
  ipcMain.handle('files:openPath', (_event, targetPath: string) => openPath(targetPath))
}

app.whenReady().then(() => {
  // 调试独立包不需要原生菜单
  Menu.setApplicationMenu(null)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanupDeviceDebug()
})
