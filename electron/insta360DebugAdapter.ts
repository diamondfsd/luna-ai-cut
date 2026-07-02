import * as net from 'node:net'

import { DEFAULT_DEVICE } from './deviceDefaults'
import { runInsta360TcpDiagnostics } from './insta360TcpDiagnostics'
import { LunaClient } from './lunaProtocol'
import type {
  DebugAuthResult,
  DebugConnectResult,
  DebugFileListResult,
  DebugPortResult,
  IDeviceDebugProtocol,
} from './deviceDebugProtocol'

type AuthState = 'none' | 'basic_auth_done' | 'checking' | 'need_camera_confirm' | 'authorized' | 'failed'

function parseHostname(host: string): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    const idx = host.lastIndexOf(':')
    if (idx > 0) {
      const port = Number.parseInt(host.slice(idx + 1), 10)
      if (Number.isInteger(port) && port > 0 && port <= 65535) return host.slice(0, idx)
    }
    return host.trim() || DEFAULT_DEVICE.defaultHost
  }
}

function checkTcpPort(host: string, port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (ok: boolean): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

async function checkHttpPort(host: string, port = 80): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1500) })
    return response.ok || response.status === 401 || response.status === 403 || response.status === 404
  } catch {
    return false
  }
}

export class Insta360DebugAdapter implements IDeviceDebugProtocol {
  private client: LunaClient | null = null
  private currentHost = ''
  private authState: AuthState = 'none'

  constructor(
    readonly deviceId: string,
    readonly deviceName: string,
    private readonly controlPort = DEFAULT_DEVICE.controlPort,
  ) {}

  getAuthState(): string {
    return this.authState
  }

  async checkPort(host: string): Promise<DebugPortResult> {
    const hostname = parseHostname(host)
    const [httpOk, controlOk] = await Promise.all([
      checkHttpPort(hostname),
      checkTcpPort(hostname, this.controlPort),
    ])
    return {
      httpOk,
      controlOk,
      httpPort: httpOk ? 80 : null,
      controlPort: controlOk ? this.controlPort : null,
      message: `HTTP:${httpOk ? 80 : '不可用'} | 控制:${controlOk ? this.controlPort : '不可用'}`,
    }
  }

  async connect(host: string): Promise<DebugConnectResult> {
    const hostname = parseHostname(host)
    this.currentHost = hostname
    this.client?.close()
    this.client = new LunaClient(hostname, this.controlPort, DEFAULT_DEVICE.storages)

    try {
      await this.client.connect()
      this.authState = 'basic_auth_done'
      const auth = await this.checkAuth()
      const port = await this.checkPort(hostname)
      return {
        success: port.controlOk,
        authState: auth.authState,
        message: auth.success ? `已连接 ${this.deviceName}` : `已连接，${auth.message}`,
        httpOk: port.httpOk,
        controlOk: port.controlOk,
      }
    } catch (error) {
      this.authState = 'failed'
      return {
        success: false,
        authState: this.authState,
        message: error instanceof Error ? error.message : String(error),
        httpOk: false,
        controlOk: false,
      }
    }
  }

  async disconnect(): Promise<void> {
    this.client?.close()
    this.client = null
    this.currentHost = ''
    this.authState = 'none'
  }

  async checkAuth(): Promise<DebugAuthResult> {
    if (!this.currentHost) return { success: false, authState: 'none', message: '未连接' }
    this.authState = 'checking'
    const diagnostics = await runInsta360TcpDiagnostics(this.currentHost, this.controlPort, () => undefined, { authOnly: true })
    const auth = diagnostics.auth
    if (!auth) {
      this.authState = 'basic_auth_done'
      return { success: true, authState: this.authState, message: '控制通道可用，未解析到授权状态' }
    }
    if (auth.authorized === true) {
      this.authState = 'authorized'
      return { success: true, authState: this.authState, message: 'CHECK_AUTHORIZATION 返回已授权' }
    }
    if (auth.needsConfirm) {
      this.authState = 'need_camera_confirm'
      return { success: false, authState: this.authState, message: '需要在相机上确认授权' }
    }
    this.authState = 'basic_auth_done'
    return { success: true, authState: this.authState, message: auth.message || '授权状态未明确，控制通道已建立' }
  }

  async requestAuth(): Promise<DebugAuthResult> {
    if (!this.currentHost) return { success: false, authState: 'none', message: '未连接' }
    const diagnostics = await runInsta360TcpDiagnostics(this.currentHost, this.controlPort, () => undefined, { requestAuthorization: true, authOnly: true })
    this.authState = diagnostics.auth?.authorized ? 'authorized' : 'need_camera_confirm'
    return {
      success: true,
      authState: this.authState,
      message: diagnostics.auth?.authorized ? '授权已完成' : '已发送授权请求，请在相机上确认',
    }
  }

  async waitForAuthConfirm(timeoutMs = 60000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const result = await this.checkAuth()
      if (result.success && result.authState === 'authorized') return true
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    return false
  }

  async listFiles(): Promise<DebugFileListResult> {
    const host = this.currentHost || DEFAULT_DEVICE.defaultHost
    const diagnostics = await runInsta360TcpDiagnostics(host, this.controlPort, () => undefined, { fileListOnly: true })
    const files = diagnostics.files.map((file) => ({
      name: file.name,
      size: file.size,
      url: file.url,
    }))
    return {
      success: diagnostics.tcp.some((item) => item.label.includes('GET_FILE_LIST') && item.ok),
      files,
      http: diagnostics.http,
      message: `TCP 文件列表返回 ${files.length} 个文件，HTTP 可达 ${diagnostics.http.filter((item) => item.ok).length}/${diagnostics.http.length}`,
    }
  }

  async runDiagnostics(
    host: string,
    log: (level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: unknown) => void,
  ) {
    const hostname = parseHostname(host)
    this.currentHost = hostname
    const diagnostics = await runInsta360TcpDiagnostics(hostname, this.controlPort, log, { requestAuthorization: false })
    if (diagnostics.auth?.authorized) this.authState = 'authorized'
    else if (diagnostics.auth?.needsConfirm) this.authState = 'need_camera_confirm'
    else if (diagnostics.tcp.some((item) => item.ok)) this.authState = 'basic_auth_done'
    return diagnostics
  }

  startKeepAlive(intervalMs?: number): void {
    this.client?.startKeepAlive(intervalMs ?? 3000)
  }

  stopKeepAlive(): void {
    this.client?.stopKeepAlive()
  }

  close(): void {
    void this.disconnect()
  }
}
