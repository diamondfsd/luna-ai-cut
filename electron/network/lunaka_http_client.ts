import { app, ipcMain, session, webContents } from 'electron'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'

import type {
  LunaKaHttpMethod,
  LunaKaHttpRequestOptions,
} from '../../src/shared/types'
import { currentBaseDir } from '../storage/settingsService'
import { LunaKaWebSocketChannel } from './lunaka_websocket_channel'
import { lunaKaHttpErrorMessage } from './lunaKaHttpError'
import { lunaKaDeviceName } from './lunaka_device_name'

interface StoredCredentials {
  clientId: string
  pairedDevices?: Record<string, string>
  /** Origin keyed keys are read only when migrating credentials from older builds. */
  services?: Record<string, string>
}

interface PhoneServiceInfo {
  service?: unknown
  api_version?: unknown
  device_id?: unknown
}

interface HttpResult {
  statusCode: number
  body: string
}

const STORE_FILE = 'lunaka-http-client.json'
const PAIRED_DEVICES_FILE = 'lan-paired-devices.json'
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024
const AUTHORIZATION_PATH = '/api/v1/auth/authorize'
const PAIRING_PATH = '/api/v1/auth/pair'
const AUTHORIZATION_CHECK_PATH = '/api/v1/auth/check'
const PHONE_DEVICE_ID = /^luna-mobile-[A-Za-z0-9_-]{20,40}$/

export class LunaKaHttpClient {
  private clientId: string | null = null
  private readonly keysByOrigin = new Map<string, string>()
  private readonly keysByDeviceId = new Map<string, string>()
  private readonly deviceIdsByOrigin = new Map<string, string>()
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
    ipcMain.handle('luna-ka-http-client:has-pairing', (_event, endpoint: unknown) => {
      if (endpoint !== undefined && typeof endpoint !== 'string') return false
      return this.hasPairing(endpoint as string | undefined)
    })
    ipcMain.handle('luna-ka-http-client:connect', (_event, endpoint: unknown) => {
      if (typeof endpoint !== 'string') throw new Error('手机地址无效')
      return this.connect(endpoint)
    })
    ipcMain.handle('luna-ka-http-client:pair', (_event, endpoint: unknown, code: unknown) => {
      if (typeof endpoint !== 'string' || typeof code !== 'string') {
        throw new Error('手机或配对码无效')
      }
      return this.pair(endpoint, code)
    })
    ipcMain.handle(
      'luna-ka-http-client:request',
      async (_event, endpoint: unknown, requestPath: unknown, options: unknown) => {
        if (typeof endpoint !== 'string' || typeof requestPath !== 'string') {
          throw new Error('请求地址无效')
        }
        try {
          return await this.request(endpoint, requestPath, this.validateOptions(options))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('请在手机设置中打开配对码')
            || message.includes('手机配对已失效')
            || message.includes('局域网服务尚未授权')) {
            // Resolve an IPC error value so Electron does not log the same
            // expected pairing state on every background sync poll. The
            // preload bridge rethrows it in the renderer, where pairing UI
            // handles it as a normal state transition.
            return { __lunaKaHttpClientError: message }
          }
          throw error
        }
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

  async hasPairing(endpoint?: string): Promise<boolean> {
    await this.ensureLoaded()
    if (!endpoint) return this.keysByDeviceId.size > 0 || this.keysByOrigin.size > 0

    let base: URL
    try {
      base = this.normalizeEndpoint(endpoint)
    } catch {
      return false
    }
    try {
      const phone = await this.readPhoneInfo(base)
      if (phone.deviceId) {
        return this.keysByDeviceId.has(phone.deviceId) || this.keysByOrigin.has(base.origin)
      }
      return this.keysByOrigin.has(base.origin)
    } catch {
      return false
    }
  }

  async pair(endpoint: string, pairingCode: string): Promise<{ deviceId: string }> {
    const base = this.normalizeEndpoint(endpoint)
    const code = pairingCode.trim()
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位配对码')
    await this.ensureLoaded()
    const phone = await this.readPhoneInfo(base)
    if (!phone.deviceId) throw new Error('手机版本不支持配对码，请更新手机应用')
    const response = await this.performRequest(
      new URL(PAIRING_PATH, base),
      'POST',
      {
        client_id: this.clientId,
        client_name: await lunaKaDeviceName(),
        pairing_code: code,
      },
      { 'Content-Type': 'application/json' },
    )
    if (response.statusCode !== 200) {
      throw this.httpError(response, '配对失败，请检查配对码')
    }
    let payload: { client_id?: unknown; device_id?: unknown; authorization_key?: unknown }
    try {
      payload = JSON.parse(response.body) as typeof payload
    } catch {
      throw new Error('手机返回的配对信息无效')
    }
    if (payload.client_id !== this.clientId || payload.device_id !== phone.deviceId
      || typeof payload.authorization_key !== 'string' || payload.authorization_key.length < 32) {
      throw new Error('手机返回的配对信息无效')
    }
    this.keysByDeviceId.set(phone.deviceId, payload.authorization_key)
    this.deviceIdsByOrigin.set(base.origin, phone.deviceId)
    this.keysByOrigin.set(base.origin, payload.authorization_key)
    await this.persist()
    await this.connect(base.origin)
    return { deviceId: phone.deviceId }
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
      this.removeOriginCredential(base.origin)
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
    const phone = await this.readPhoneInfo(base)
    if (phone.deviceId) {
      this.deviceIdsByOrigin.set(base.origin, phone.deviceId)
      const pairedKey = this.keysByDeviceId.get(phone.deviceId)
      if (pairedKey) {
        this.keysByOrigin.set(base.origin, pairedKey)
        const check = await this.performRequest(
          new URL(AUTHORIZATION_CHECK_PATH, base),
          'GET',
          undefined,
          this.headersFor(pairedKey),
        )
        if (check.statusCode === 204 || check.statusCode === 200) return
        if (check.statusCode !== 401) throw this.httpError(check, '无法验证手机授权')
        this.keysByDeviceId.delete(phone.deviceId)
        this.removeOriginCredential(base.origin)
        await this.persist()
        throw new Error('手机配对已失效，请重新配对')
      }

      // Migrate a token from an older origin-keyed store to the stable phone ID.
      const migratedKey = this.keysByOrigin.get(base.origin)
      if (migratedKey) {
        const check = await this.performRequest(
          new URL(AUTHORIZATION_CHECK_PATH, base),
          'GET',
          undefined,
          this.headersFor(migratedKey),
        )
        if (check.statusCode === 204 || check.statusCode === 200) {
          this.keysByDeviceId.set(phone.deviceId, migratedKey)
          await this.persist()
          return
        }
        this.removeOriginCredential(base.origin)
      }
      throw new Error('请在手机设置中打开配对码，再输入配对')
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
        client_name: await lunaKaDeviceName(),
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

  private async readPhoneInfo(base: URL): Promise<{ deviceId: string | null }> {
    const response = await this.performRequest(new URL('/', base), 'GET')
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw this.httpError(response, '无法连接手机')
    }
    let payload: PhoneServiceInfo
    try {
      payload = JSON.parse(response.body) as PhoneServiceInfo
    } catch {
      throw new Error('手机返回的服务信息无效')
    }
    if (payload.service !== 'luna-ka-api' || payload.api_version !== 1) {
      throw new Error('当前设备不是受支持的 Luna 咔服务')
    }
    return {
      deviceId: typeof payload.device_id === 'string' && PHONE_DEVICE_ID.test(payload.device_id)
        ? payload.device_id
        : null,
    }
  }

  private removeOriginCredential(origin: string): void {
    this.keysByOrigin.delete(origin)
    this.deviceIdsByOrigin.delete(origin)
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
    return new Error(lunaKaHttpErrorMessage(result.statusCode, result.body, fallback))
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
    try {
      const filePath = path.join(currentBaseDir(), PAIRED_DEVICES_FILE)
      let serialized: string
      try {
        serialized = await fs.readFile(filePath, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        serialized = await fs.readFile(path.join(app.getPath('userData'), STORE_FILE), 'utf8')
      }
      const data = JSON.parse(serialized) as Partial<StoredCredentials>
      if (
        typeof data.clientId === 'string' &&
        /^[A-Za-z0-9._:-]{8,128}$/.test(data.clientId)
      ) {
        this.clientId = data.clientId
      }
      if (data.pairedDevices && typeof data.pairedDevices === 'object') {
        for (const [deviceId, key] of Object.entries(data.pairedDevices)) {
          if (!PHONE_DEVICE_ID.test(deviceId) || typeof key !== 'string' || key.length < 32 || key.length > 256) continue
          this.keysByDeviceId.set(deviceId, key)
        }
      }
      if (data.services && typeof data.services === 'object') {
        for (const [origin, key] of Object.entries(data.services)) {
          if (typeof key !== 'string' || key.length < 32 || key.length > 256) continue
          try {
            if (new URL(origin).origin === origin) this.keysByOrigin.set(origin, key)
          } catch {
            // Ignore malformed origins in the local credential file.
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.clientId = randomUUID()
        this.keysByOrigin.clear()
        this.keysByDeviceId.clear()
      }
    }
    this.clientId ??= randomUUID()
  }

  private async persist(): Promise<void> {
    const clientId = this.clientId
    if (!clientId) throw new Error('局域网客户端未初始化')
    const snapshot = JSON.stringify({
      clientId,
      pairedDevices: Object.fromEntries(this.keysByDeviceId),
      services: Object.fromEntries(this.keysByOrigin),
    } satisfies StoredCredentials)
    const write = this.writeTask.catch(() => undefined).then(async () => {
      const directory = currentBaseDir()
      const filePath = path.join(directory, PAIRED_DEVICES_FILE)
      const temporaryPath = `${filePath}.tmp`
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await fs.writeFile(temporaryPath, `${snapshot}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      if (process.platform !== 'win32') await fs.chmod(temporaryPath, 0o600)
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
