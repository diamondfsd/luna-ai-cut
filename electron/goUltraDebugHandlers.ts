/**
 * Go Ultra 调试工具 — 主进程 IPC 处理器
 *
 * 暴露 Go Ultra 协议调试接口给渲染进程
 */

import { GoUltraClient, AuthState } from './goUltraProtocol'
import { GO_ULTRA_DEVICE } from './deviceDefaults'
import { logMainInfo, logMainError } from './loggerService'

/** 缓存 Go Ultra 调试客户端，复用同一连接 */
const debugClients = new Map<string, GoUltraClient>()

function getOrCreateClient(host: string): GoUltraClient {
  const key = host.trim()
  let client = debugClients.get(key)
  if (!client) {
    client = new GoUltraClient(key, GO_ULTRA_DEVICE.controlPort)
    debugClients.set(key, client)
  }
  return client
}

/** 清理所有调试客户端 */
export function cleanupDebugClients(): void {
  for (const client of debugClients.values()) {
    client.close()
  }
  debugClients.clear()
}

// ============================================================
// 导出 IPC 处理器注册函数
// ============================================================

import type { IpcMainInvokeEvent } from 'electron'

interface DebugAuthResult {
  success: boolean
  authState: string
  message: string
  rawResponse?: string
}

interface DebugConnectResult {
  success: boolean
  message: string
  httpOk: boolean
  controlOk: boolean
  authState: string
}

export function registerGoUltraDebugHandlers(ipcMain: Electron.IpcMain): void {
  /**
   * goUltraDebug:connect — 连接并执行授权流程
   * 参数: { host: string }
   * 返回: DebugConnectResult
   */
  ipcMain.handle('goUltraDebug:connect', async (_event: IpcMainInvokeEvent, { host }: { host: string }): Promise<DebugConnectResult> => {
    logMainInfo('[GoUltraDebug] 开始连接', { host })
    const client = getOrCreateClient(host)

    try {
      await client.connect()
      const state = client.authState
      logMainInfo('[GoUltraDebug] 连接结果', { host, authState: state })
      return {
        success: state === AuthState.AUTHORIZED || state === AuthState.NEED_CAMERA_CONFIRM,
        message: state === AuthState.AUTHORIZED
          ? '连接并授权成功'
          : state === AuthState.NEED_CAMERA_CONFIRM
            ? '基础连接成功，请在 Go Ultra 相机上确认授权'
            : '连接完成',
        httpOk: true,
        controlOk: true,
        authState: state,
      }
    } catch (error) {
      const errMsg = String(error)
      logMainError('[GoUltraDebug] 连接失败', { host, error: errMsg })
      return {
        success: false,
        message: errMsg,
        httpOk: false,
        controlOk: false,
        authState: AuthState.FAILED,
      }
    }
  })

  /**
   * goUltraDebug:checkAuth — 检查授权状态
   * 参数: { host: string }
   * 返回: DebugAuthResult
   */
  ipcMain.handle('goUltraDebug:checkAuth', async (_event: IpcMainInvokeEvent, { host }: { host: string }): Promise<DebugAuthResult> => {
    const client = getOrCreateClient(host)
    const state = client.authState
    const isAuthorized = state === AuthState.AUTHORIZED
    return {
      success: isAuthorized,
      authState: state,
      message: isAuthorized ? '已授权' : `未授权 (${state})`,
    }
  })

  /**
   * goUltraDebug:requestAuth — 发起授权请求（会在 Go Ultra 屏幕上弹窗）
   * 参数: { host: string }
   * 返回: DebugAuthResult
   */
  ipcMain.handle('goUltraDebug:requestAuth', async (_event: IpcMainInvokeEvent, { host }: { host: string }): Promise<DebugAuthResult> => {
    const client = getOrCreateClient(host)
    if (client.authState !== AuthState.NEED_CAMERA_CONFIRM && client.authState !== AuthState.BASIC_AUTH_DONE) {
      // 尝试先连接
      try {
        await client.connect()
      } catch (error) {
        return {
          success: false,
          authState: client.authState,
          message: `连接失败: ${String(error)}`,
        }
      }
    }
    return {
      success: true,
      authState: client.authState,
      message: '请在 Go Ultra 相机上确认授权',
    }
  })

  /**
   * goUltraDebug:listFiles — 列出文件（需要先授权）
   * 参数: { host: string }
   * 返回: { success: boolean, files?: any[], message: string }
   */
  ipcMain.handle('goUltraDebug:listFiles', async (_event: IpcMainInvokeEvent, { host }: { host: string }) => {
    const client = getOrCreateClient(host)
    if (client.authState !== AuthState.AUTHORIZED) {
      return {
        success: false,
        message: `未授权，当前状态: ${client.authState}`,
        files: [],
      }
    }
    try {
      const files = await client.listFiles()
      return {
        success: true,
        message: `找到 ${files.length} 个文件`,
        files: files.map((f) => ({ name: f.name, size: f.bytes, url: f.url })),
      }
    } catch (error) {
      return {
        success: false,
        message: String(error),
        files: [],
      }
    }
  })

  /**
   * goUltraDebug:disconnect — 断开连接
   * 参数: { host: string }
   */
  ipcMain.handle('goUltraDebug:disconnect', (_event: IpcMainInvokeEvent, { host }: { host: string }) => {
    const key = host.trim()
    const client = debugClients.get(key)
    if (client) {
      client.close()
      debugClients.delete(key)
      logMainInfo('[GoUltraDebug] 已断开', { host })
    }
    return { success: true }
  })

  /**
   * goUltraDebug:checkPort — 检查端口
   * 参数: { host: string }
   * 返回: { httpOk, controlOk }
   */
  ipcMain.handle('goUltraDebug:checkPort', async (_event: IpcMainInvokeEvent, { host }: { host: string }) => {
    const client = getOrCreateClient(host)
    try {
      const status = await client.checkStatus()
      return {
        httpOk: status.httpOk,
        controlOk: status.controlOk,
        message: status.message,
      }
    } catch (error) {
      return {
        httpOk: false,
        controlOk: false,
        message: String(error),
      }
    }
  })
}
