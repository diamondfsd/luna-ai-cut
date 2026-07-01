/**
 * Go Ultra 设备调试协议适配器
 *
 * 实现 IDeviceDebugProtocol 接口，封装 GoUltraClient
 * 用于设备调试页面
 */

import { GoUltraClient, AuthState } from './goUltraProtocol'
import { GO_ULTRA_DEVICE } from './deviceDefaults'
import { logMainInfo } from './loggerService'
import type { IDeviceDebugProtocol, DebugPortResult, DebugConnectResult, DebugAuthResult, DebugFileListResult } from './deviceDebugProtocol'

/** 解析 host:port，返回纯 hostname */
function parseHostname(h: string): string {
  const idx = h.lastIndexOf(':')
  if (idx > 0) {
    const port = parseInt(h.slice(idx + 1), 10)
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return h.slice(0, idx)
    }
  }
  return h
}

/** 缓存 Go Ultra 调试客户端，复用同一连接 */
const debugClients = new Map<string, GoUltraClient>()

export class GoUltraDebugAdapter implements IDeviceDebugProtocol {
  readonly deviceId = 'go-ultra'
  readonly deviceName = 'GO Ultra'

  private currentHost = ''

  getAuthState(): string {
    const client = this.getClient()
    return client?.authState ?? AuthState.NONE
  }

  private getClient(): GoUltraClient | null {
    if (!this.currentHost) return null
    return debugClients.get(this.currentHost) ?? null
  }

  private getOrCreateClient(host: string): GoUltraClient {
    const key = parseHostname(host)
    this.currentHost = key
    let client = debugClients.get(key)
    if (!client) {
      client = new GoUltraClient(key, GO_ULTRA_DEVICE.controlPort)
      debugClients.set(key, client)
    }
    return client
  }

  async checkPort(host: string): Promise<DebugPortResult> {
    const hostname = parseHostname(host)
    const client = this.getOrCreateClient(hostname)

    try {
      const status = await client.checkStatus()
      return {
        httpOk: status.httpOk,
        controlOk: status.controlOk,
        httpPort: status.httpOk ? 80 : null,
        controlPort: status.controlOk ? GO_ULTRA_DEVICE.controlPort : null,
        message: status.message,
      }
    } catch (error) {
      return {
        httpOk: false,
        controlOk: false,
        httpPort: null,
        controlPort: null,
        message: String(error),
      }
    }
  }

  async connect(host: string): Promise<DebugConnectResult> {
    const hostname = parseHostname(host)

    try {
      const client = this.getOrCreateClient(hostname)
      await client.connect()
      const state = client.authState
      logMainInfo('[GoUltraDebug] 连接结果', { host: hostname, authState: state })

      return {
        success: state === AuthState.AUTHORIZED || state === AuthState.NEED_CAMERA_CONFIRM,
        authState: state,
        message: state === AuthState.AUTHORIZED
          ? '连接并授权成功'
          : state === AuthState.NEED_CAMERA_CONFIRM
            ? '基础连接成功，请在 Go Ultra 相机上确认授权'
            : '连接完成',
        httpOk: true,
        controlOk: true,
      }
    } catch (error) {
      const errMsg = String(error)
      logMainInfo('[GoUltraDebug] 连接失败', { host: hostname, error: errMsg })
      return {
        success: false,
        authState: AuthState.FAILED,
        message: errMsg,
        httpOk: false,
        controlOk: false,
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.currentHost) {
      const client = debugClients.get(this.currentHost)
      if (client) {
        client.close()
        debugClients.delete(this.currentHost)
      }
      this.currentHost = ''
    }
  }

  async checkAuth(): Promise<DebugAuthResult> {
    const client = this.getClient()
    if (!client) {
      return { success: false, authState: AuthState.NONE, message: '未连接' }
    }

    const state = client.authState
    const isAuthorized = state === AuthState.AUTHORIZED
    return {
      success: isAuthorized,
      authState: state,
      message: isAuthorized ? '已授权' : `未授权 (${state})`,
    }
  }

  async requestAuth(): Promise<DebugAuthResult> {
    const client = this.getClient()
    if (!client) {
      return { success: false, authState: AuthState.NONE, message: '未连接' }
    }

    if (client.authState !== AuthState.NEED_CAMERA_CONFIRM && client.authState !== AuthState.BASIC_AUTH_DONE) {
      // 尝试重新连接以触发授权流程
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
  }

  async waitForAuthConfirm(timeoutMs: number = 60000): Promise<boolean> {
    const client = this.getClient()
    if (!client) return false

    try {
      return await client.waitForAuthorization(timeoutMs)
    } catch {
      return false
    }
  }

  async listFiles(): Promise<DebugFileListResult> {
    const client = this.getClient()
    if (!client) {
      return { success: false, files: [], message: '设备未连接' }
    }

    if (client.authState !== AuthState.AUTHORIZED) {
      return {
        success: false,
        files: [],
        message: `未授权，当前状态: ${client.authState}`,
      }
    }

    try {
      const files = await client.listFiles()
      const mapped = files.map((f) => ({
        name: f.name,
        size: f.bytes,
        url: f.url,
      }))
      return {
        success: true,
        files: mapped,
        message: `找到 ${mapped.length} 个文件`,
      }
    } catch (error) {
      return {
        success: false,
        files: [],
        message: String(error),
      }
    }
  }

  startKeepAlive(intervalMs?: number): void {
    this.getClient()?.startKeepAlive(intervalMs ?? 5000)
  }

  stopKeepAlive(): void {
    this.getClient()?.stopKeepAlive()
  }

  close(): void {
    this.disconnect()
  }

  /** 清理所有调试客户端（静态方法） */
  static cleanupAll(): void {
    for (const client of debugClients.values()) {
      client.close()
    }
    debugClients.clear()
  }
}
