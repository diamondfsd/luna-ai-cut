import { app, ipcMain, safeStorage, session, webContents } from 'electron'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'

import type {
  LunaKaHttpMethod,
  LunaKaHttpRequestOptions,
} from '../../src/shared/types'
import { LunaKaWebSocketChannel } from './lunaka_websocket_channel'

interface StoredCredentials {
  clientId: string
  services: Record<string, string>
}

interface HttpResult {
  statusCode: number
  body: string
}

const STORE_FILE = 'lunaka-http-client.enc'
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024
const AUTHORIZATION_PATH = '/api/v1/auth/authorize'
const AUTHORIZATION_CHECK_PATH = '/api/v1/auth/check'

export class LunaKaHttpClient {
  private clientId: string | null = null
  private readonly keysByOrigin = new Map<string, string>()
  private readonly connectionTasks = new Map<string, Promise<void>>()
  private loadTask: Promise<void> | null = null
  private writeTask: Promise<void> = Promise.resolve()
  private interceptorInstalled = false
  private readonly webSocketChannel: LunaKaWebSocketChannel

  constructor() {
    this.webSocketChannel = new LunaKaWebSocketChannel({
      getCredentials: async (endpoint) => {
        await this.connect(endpoint)
        await this.ensureLoaded()
        const origin = this.normalizeEndpoint(endpoint).origin
        const authorizationKey = this.keysByOrigin.get(origin)
        if (!authorizationKey || !this.clientId) {
          throw new Error('局域网服务尚未授权')
        }
        return { clientId: this.clientId, authorizationKey }
      },
      isTrustedRenderer: (webContentsId) => this.isTrustedRenderer(webContentsId),
    })
  }

  register(): void {
    ipcMain.handle('luna-ka-http-client:connect', (_event, endpoint: unknown) => {
      if (typeof endpoint !== 'string') throw new Error('手机地址无效')
      return this.connect(endpoint)
    })
    ipcMain.handle(
      'luna-ka-http-client:request',
      (_event, endpoint: unknown, requestPath: unknown, options: unknown) => {
        if (typeof endpoint !== 'string' || typeof requestPath !== 'string') {
          throw new Error('请求地址无效')
        }
        return this.request(endpoint, requestPath, this.validateOptions(options))
      },
    )
    this.webSocketChannel.register()
    this.installAuthorizationHeaderInterceptor()
  }

  async connect(endpoint: string): Promise<void> {
    const base = this.normalizeEndpoint(endpoint)
    const existing = this.connectionTasks.get(base.origin)
    if (existing) return existing;
    const task = this._connect(base);
    this.connectionTasks.set(base.origin, task);
    try {
      await task
    } finally {
      if (this.connectionTasks.get(base.origin) === task) {
        this.connectionTasks.delete(base.origin)
      }
    }
  }

  async request<T>(
    endpoint: string,
    requestPath: string,
    options: LunaKaHttpRequestOptions = {},
  ): Promise<T> {
    const base = this.normalizeEndpoint(endpoint)
    const url = this.resolvePath(base, requestPath)
    await this.connect(base.origin)
    let result = await this._requestAuthorized(base.origin, url, options)
    if (result.statusCode === 401) {
      this.keysByOrigin.delete(base.origin)
      await this.persist()
      await this.connect(base.origin)
      result = await this._requestAuthorized(base.origin, url, options)
    }
    return this.decodeJson<T>(result)
  }

  async authorizationHeadersFor(rawUrl: string): Promise<Record<string, string>> {
    await this.ensureLoaded()
    let url: URL;
    try {
      url = new URL(rawUrl)
    } catch {
      return {}
    }
    const key = this.keysByOrigin.get(url.origin)
    if (!key || !this.clientId) return {}
    return {
      Authorization: `Bearer ${key}`,
      'X-Luna-Client-Id': this.clientId,
    }
  }

  private async _connect(base: URL): Promise<void> {
    await this.ensureLoaded()
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统未提供安全存储，无法保存手机授权')
    }
    const key = this.keysByOrigin.get(base.origin)
    if (key) {
      const check = await this.performRequest(
        new URL(AUTHORIZATION_CHECK_PATH, base),
        'GET',
        undefined,
        this.headersFor(key),
      )
      if (check.statusCode === 204 || check.statusCode === 200) return
      if (check.statusCode !== 401) {
        throw this.httpError(check, '无法验证手机授权')
      }
      this.keysByOrigin.delete(base.origin)
    }

    const clientId = this.clientId ?? randomUUID();
    const response = await this.performRequest(
      new URL(AUTHORIZATION_PATH, base),
      'POST',
      {
        client_id: clientId,
        client_name: app.getName() || 'Luna AI Cut',
      },
      { 'Content-Type': 'application/json' },
      135_000,
    );
    if (response.statusCode !== 200) {
      throw this.httpError(response, '手机未批准本次连接');
    }
    let payload: { client_id?: unknown; authorization_key?: unknown };
    try {
      payload = JSON.parse(response.body) as typeof payload
    } catch {
      throw new Error('手机返回的授权信息无效')
    }
    if (
      payload.client_id !== clientId ||
      typeof payload.authorization_key !== 'string' ||
      payload.authorization_key.length < 32
    ) {
      throw new Error('手机返回的授权信息无效')
    }
    this.clientId = clientId
    this.keysByOrigin.set(base.origin, payload.authorization_key)
    await this.persist()
  }

  private async _requestAuthorized(
    origin: string,
    url: URL,
    options: LunaKaHttpRequestOptions,
  ): Promise<HttpResult> {
    const key = this.keysByOrigin.get(origin)
    if (!key) throw new Error('局域网服务尚未授权')
    const headers = this.headersFor(key)
    const method = options.method ?? 'GET'
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    return this.performRequest(url, method, options.body, headers)
  }

  private headersFor(key: string): Record<string, string> {
    if (!this.clientId) throw new Error('局域网客户端未初始化')
    return {
      Authorization: `Bearer ${key}`,
      'X-Luna-Client-Id': this.clientId,
    }
  }

  private performRequest(
    url: URL,
    method: LunaKaHttpMethod,
    body?: unknown,
    headers: Record<string, string> = {},
    timeoutMs = 20_000,
  ): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http
      const encodedBody = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      const request = transport.request(
        url,
        {
          method,
          headers: {
            Accept: 'application/json',
            Connection: 'close',
            ...headers,
            ...(encodedBody ? { 'Content-Length': encodedBody.length } : {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = []
          let totalBytes = 0
          response.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length
            if (totalBytes > MAX_RESPONSE_BYTES) {
              request.destroy(new Error('手机响应超出大小限制'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }))
          response.on('error', reject)
        },
      )
      request.setTimeout(timeoutMs, () => request.destroy(new Error('连接手机超时')))
      request.on('error', reject)
      if (encodedBody) request.write(encodedBody)
      request.end()
    })
  }

  private decodeJson<T>(result: HttpResult): T {
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw this.httpError(result, '局域网请求失败')
    }
    if (!result.body) return undefined as T
    try {
      return JSON.parse(result.body) as T
    } catch {
      throw new Error('手机返回的数据格式无效')
    }
  }

  private httpError(result: HttpResult, fallback: string): Error {
    let code = ''
    try {
      const payload = JSON.parse(result.body) as { error?: unknown }
      if (typeof payload.error === 'string') code = payload.error
    } catch {
      // Use the status code when the service did not return JSON.
    }
    const messages: Record<string, string> = {
      'authorization-denied': '手机端拒绝了此次授权请求',
      'authorization-request-throttled': '请求过于频繁，请稍后重试',
      'private-network-required': '只能连接同一局域网中的手机',
    }
    return new Error(messages[code] ?? `${fallback}：HTTP ${result.statusCode}`)
  }

  private normalizeEndpoint(value: string): URL {
    const candidate = value.trim()
    if (!candidate) throw new Error('请输入手机地址')
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `http://${candidate}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('仅支持 HTTP 或 HTTPS 地址')
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('手机地址格式无效')
    }
    url.pathname = '/'
    return url
  }

  private resolvePath(endpoint: URL, requestPath: string): URL {
    if (!requestPath.startsWith('/') || requestPath.startsWith('//')) {
      throw new Error('局域网请求路径无效')
    }
    const url = new URL(requestPath, endpoint)
    if (url.origin !== endpoint.origin) throw new Error('请求地址必须属于当前手机服务')
    return url
  }

  private validateOptions(value: unknown): LunaKaHttpRequestOptions {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object') throw new Error('请求选项无效')
    const options = value as Partial<LunaKaHttpRequestOptions>
    const method = options.method ?? 'GET'
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new Error('请求方法无效')
    }
    return { method, body: options.body }
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loadTask) this.loadTask = this.loadCredentials()
    await this.loadTask
  }

  private async loadCredentials(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      this.clientId = randomUUID()
      return
    }
    try {
      const encrypted = await fs.readFile(path.join(app.getPath('userData'), STORE_FILE), 'utf8')
      const data = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as Partial<StoredCredentials>
      if (typeof data.clientId === 'string') this.clientId = data.clientId
      if (data.services && typeof data.services === 'object') {
        for (const [origin, key] of Object.entries(data.services)) {
          if (typeof key === 'string') this.keysByOrigin.set(origin, key)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.clientId = randomUUID()
        this.keysByOrigin.clear()
      }
    }
    this.clientId ??= randomUUID()
  }

  private async persist(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return
    const clientId = this.clientId
    if (!clientId) throw new Error('局域网客户端未初始化')
    const snapshot = JSON.stringify({
      clientId,
      services: Object.fromEntries(this.keysByOrigin),
    } satisfies StoredCredentials)
    const write = this.writeTask.catch(() => undefined).then(async () => {
      const filePath = path.join(app.getPath('userData'), STORE_FILE)
      const temporaryPath = `${filePath}.tmp`
      const encrypted = safeStorage.encryptString(snapshot).toString('base64')
      await fs.writeFile(temporaryPath, encrypted, { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temporaryPath, filePath)
    })
    this.writeTask = write
    await write
  }

  private installAuthorizationHeaderInterceptor(): void {
    if (this.interceptorInstalled) return
    this.interceptorInstalled = true
    void this.ensureLoaded().catch(() => undefined)
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        const trusted = this.isTrustedRenderer(details.webContentsId ?? -1)
        if (!trusted) {
          callback({ requestHeaders: details.requestHeaders })
          return
        }
        let origin: string
        try {
          origin = new URL(details.url).origin
        } catch {
          callback({ requestHeaders: details.requestHeaders })
          return
        }
        const key = this.keysByOrigin.get(origin)
        if (!key || !this.clientId) {
          callback({ requestHeaders: details.requestHeaders })
          return
        }
        callback({
          requestHeaders: {
            ...details.requestHeaders,
            Authorization: `Bearer ${key}`,
            'X-Luna-Client-Id': this.clientId,
          },
        })
      },
    )
  }

  private isTrustedRenderer(webContentsId: number): boolean {
    const source = webContents.fromId(webContentsId)?.getURL()
    if (!source) return false
    if (source.startsWith('file://')) return true
    try {
      const url = new URL(source)
      return url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    } catch {
      return false
    }
  }
}

export const lunaKaHttpClient = new LunaKaHttpClient()

export function register(): void {
  lunaKaHttpClient.register()
}
