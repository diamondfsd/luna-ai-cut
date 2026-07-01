/**
 * Luna Ultra 设备调试协议适配器
 *
 * 实现 IDeviceDebugProtocol 接口，封装 LunaClient
 * 用于设备调试页面
 */

import * as net from 'node:net'

import { LunaClient } from './lunaProtocol'
import { DEFAULT_DEVICE } from './deviceDefaults'
import { runInsta360TcpDiagnostics } from './insta360TcpDiagnostics'
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

export class LunaDebugAdapter implements IDeviceDebugProtocol {
  readonly deviceId = 'luna-ultra'
  readonly deviceName = 'Luna Ultra'

  private client: LunaClient | null = null
  private _authState = 'none'
  private currentHost = ''
  private _connected = false

  getAuthState(): string {
    return this._authState
  }

  private getOrCreateClient(host: string): LunaClient {
    if (this.client && this.currentHost === host && this._connected) {
      return this.client
    }
    if (this.client) {
      this.client.close()
    }
    this._connected = false
    const hostname = parseHostname(host)
    this.client = new LunaClient(hostname, DEFAULT_DEVICE.controlPort, DEFAULT_DEVICE.storages)
    this.currentHost = hostname
    return this.client
  }

  async checkPort(host: string): Promise<DebugPortResult> {
    const hostname = parseHostname(host)
    let httpOk = false
    let controlOk = false
    let httpPortFound: number | null = null
    let controlPortFound: number | null = null
    let message = ''

    // 扫描常见 HTTP 端口
    const httpPorts = [80, 8080, 8000, 18080, 8888, 8088]
    for (const port of httpPorts) {
      try {
        const url = `http://${hostname}:${port}/`
        const resp = await fetch(url, { signal: AbortSignal.timeout(1000) })
        if (resp.ok || resp.status === 403 || resp.status === 401) {
          httpOk = true
          httpPortFound = port
          break
        }
      } catch {
        // 继续
      }
    }

    // 扫描常见控制端口
    const ctrlPorts = [6666, 6667, 6668, 5555, 7777, 8887]
    for (const port of ctrlPorts) {
      try {
        await new Promise<void>((resolve, reject) => {
          const s = new net.Socket()
          const timer = setTimeout(() => { s.destroy(); reject(new Error('超时')) }, 1000)
          s.connect(port, hostname, () => { clearTimeout(timer); s.destroy(); resolve() })
          s.on('error', () => { clearTimeout(timer); reject(new Error('连接失败')) })
        })
        controlOk = true
        controlPortFound = port
        break
      } catch {
        // 继续
      }
    }

    const parts: string[] = []
    if (httpOk) parts.push(`HTTP:${httpPortFound}`)
    else parts.push('HTTP:❌')
    if (controlOk) parts.push(`控制:${controlPortFound}`)
    else parts.push('控制:❌')
    message = parts.join(' | ')

    return { httpOk, controlOk, httpPort: httpPortFound, controlPort: controlPortFound, message }
  }

  async connect(host: string): Promise<DebugConnectResult> {
    const hostname = parseHostname(host)

    try {
      const client = this.getOrCreateClient(hostname)
      await client.connect()
      this._connected = true
      this._authState = 'basic_auth_done'
      logMainInfo('[LunaDebug] 连接成功', { host: hostname })

      // 额外验证 HTTP 读取是否正常
      let httpOk = false
      let controlOk = true
      try {
        const resp = await fetch(`http://${hostname}/DCIM/`, { signal: AbortSignal.timeout(5000) })
        httpOk = resp.ok
      } catch {
        httpOk = false
      }

      return {
        success: true,
        authState: this._authState,
        message: 'Luna Ultra 连接成功',
        httpOk,
        controlOk,
      }
    } catch (error) {
      this._authState = 'failed'
      logMainInfo('[LunaDebug] 连接失败', { host: hostname, error: String(error) })
      return {
        success: false,
        authState: 'failed',
        message: String(error),
        httpOk: false,
        controlOk: false,
      }
    }
  }

  async disconnect(): Promise<void> {
    this.client?.close()
    this.client = null
    this._connected = false
    this._authState = 'none'
    this.currentHost = ''
  }

  async checkAuth(): Promise<DebugAuthResult> {
    // Luna Ultra 无需授权流程
    return {
      success: true,
      authState: this._authState,
      message: 'Luna Ultra 无需授权',
    }
  }

  async requestAuth(): Promise<DebugAuthResult> {
    // Luna Ultra 无需授权流程
    return {
      success: true,
      authState: this._authState,
      message: 'Luna Ultra 无需授权',
    }
  }

  async waitForAuthConfirm(_timeoutMs?: number): Promise<boolean> {
    // Luna Ultra 无需等待授权确认
    return true
  }

  async listFiles(): Promise<DebugFileListResult> {
    if (!this.client) {
      return { success: false, files: [], message: '设备未连接' }
    }

    try {
      const files = await this.client.listFiles()
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

  async runDiagnostics(
    host: string,
    log: (level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: unknown) => void,
  ) {
    const hostname = parseHostname(host)
    return await runInsta360TcpDiagnostics(hostname, DEFAULT_DEVICE.controlPort, log)
  }

  startKeepAlive(intervalMs?: number): void {
    this.client?.startKeepAlive(intervalMs ?? 5000)
  }

  stopKeepAlive(): void {
    this.client?.stopKeepAlive()
  }

  close(): void {
    this.disconnect()
  }
}
