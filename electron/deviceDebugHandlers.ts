/**
 * 设备调试服务 IPC 处理器
 *
 * 通过协议注册表创建对应设备的调试协议适配器，
 * 缓存连接状态的协议实例以支持后续授权、文件读取等操作。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { runDeviceTest, writeDeviceDebugLog, getDeviceDebugLogPath, closeDeviceDebugLog } from './deviceDebugService'
import { createDebugProtocol, cleanupAllDebugProtocols, DEBUG_DEVICE_OPTIONS } from './debugProtocolRegistry'
import type { IDeviceDebugProtocol } from './deviceDebugProtocol'

// ============================================================
// 协议适配器缓存
// 按 host 缓存激活的调试协议实例，供后续操作复用
// ============================================================

const activeProtocols = new Map<string, IDeviceDebugProtocol>()

/** 获取或创建缓存的协议适配器 */
function getOrCreateProtocol(deviceId: string, host: string): IDeviceDebugProtocol {
  const key = `${deviceId}@${host}`
  let protocol = activeProtocols.get(key)
  if (!protocol) {
    protocol = createDebugProtocol(deviceId)
    activeProtocols.set(key, protocol)
  }
  return protocol
}

/** 移除协议适配器缓存 */
function removeProtocol(deviceId: string, host: string): void {
  const key = `${deviceId}@${host}`
  const protocol = activeProtocols.get(key)
  if (protocol) {
    protocol.close()
    activeProtocols.delete(key)
  }
}

// ============================================================
// IPC 处理器注册
// ============================================================

export function registerDeviceDebugHandlers(mainWindow: () => BrowserWindow | null): void {
  /**
   * deviceDebug:runTest — 运行一键测试
   * 测试完成后自动释放适配器
   */
  ipcMain.handle('deviceDebug:runTest', async (_event, params: { deviceId: string; host: string }) => {
    const { deviceId, host } = params
    const protocol = getOrCreateProtocol(deviceId, host)

    const result = await runDeviceTest(protocol, host, (level, message, data) => {
      // 通过 WebContents 实时推送日志到渲染进程
      const win = mainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('deviceDebug:log', { level, message, data })
      }
    })

    // 测试完成后释放
    removeProtocol(deviceId, host)

    return result
  })

  /**
   * deviceDebug:checkPort — 端口检测
   */
  ipcMain.handle('deviceDebug:checkPort', async (_event, params: { deviceId: string; host: string }) => {
    const protocol = getOrCreateProtocol(params.deviceId, params.host)
    try {
      return await protocol.checkPort(params.host)
    } finally {
      // 端口检测不保持连接，释放
      removeProtocol(params.deviceId, params.host)
    }
  })

  /**
   * deviceDebug:connect — 连接设备（保持连接状态）
   */
  ipcMain.handle('deviceDebug:connect', async (_event, params: { deviceId: string; host: string }) => {
    // 先清理旧连接
    removeProtocol(params.deviceId, params.host)

    const protocol = getOrCreateProtocol(params.deviceId, params.host)
    try {
      return await protocol.connect(params.host)
    } catch (error) {
      removeProtocol(params.deviceId, params.host)
      throw error
    }
  })

  /**
   * deviceDebug:disconnect — 断开设备
   */
  ipcMain.handle('deviceDebug:disconnect', async (_event, params: { deviceId: string; host: string }) => {
    removeProtocol(params.deviceId, params.host)
    return { success: true }
  })

  /**
   * deviceDebug:checkAuth — 检查授权状态
   */
  ipcMain.handle('deviceDebug:checkAuth', async (_event, params: { deviceId: string; host: string }) => {
    const protocol = getOrCreateProtocol(params.deviceId, params.host)
    return await protocol.checkAuth()
  })

  /**
   * deviceDebug:requestAuth — 请求授权
   */
  ipcMain.handle('deviceDebug:requestAuth', async (_event, params: { deviceId: string; host: string }) => {
    const protocol = getOrCreateProtocol(params.deviceId, params.host)
    return await protocol.requestAuth()
  })

  /**
   * deviceDebug:getAuthState — 获取授权状态
   */
  ipcMain.handle('deviceDebug:getAuthState', async (_event, params: { deviceId: string; host: string }) => {
    const protocol = getOrCreateProtocol(params.deviceId, params.host)
    return { authState: protocol.getAuthState() }
  })

  /**
   * deviceDebug:listFiles — 读取文件列表
   */
  ipcMain.handle('deviceDebug:listFiles', async (_event, params: { deviceId: string; host: string }) => {
    const protocol = getOrCreateProtocol(params.deviceId, params.host)
    return await protocol.listFiles()
  })

  /**
   * deviceDebug:getDeviceOptions — 获取支持的调试设备列表
   */
  ipcMain.handle('deviceDebug:getDeviceOptions', () => {
    return DEBUG_DEVICE_OPTIONS
  })

  /**
   * deviceDebug:log — 写入设备调试日志
   */
  ipcMain.handle('deviceDebug:log', (_event, params: { level: string; message: string; data?: unknown }) => {
    writeDeviceDebugLog(params.level, params.message, params.data)
    return { success: true }
  })

  /**
   * deviceDebug:getLogPath — 获取日志文件路径
   */
  ipcMain.handle('deviceDebug:getLogPath', () => {
    return getDeviceDebugLogPath()
  })
}

/** 清理所有资源 */
export function cleanupDeviceDebug(): void {
  // 关闭所有缓存的协议适配器
  for (const protocol of activeProtocols.values()) {
    protocol.close()
  }
  activeProtocols.clear()
  cleanupAllDebugProtocols()
  closeDeviceDebugLog()
}
