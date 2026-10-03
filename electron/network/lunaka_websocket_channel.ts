import { ipcMain, webContents, type WebContents } from 'electron'
import WebSocket from 'ws'

import type {
  LunaKaChannelMessageEvent,
  LunaKaChannelStatusEvent,
} from '../../src/shared/types'

interface ChannelCredentials {
  clientId: string
  authorizationKey: string
}

interface LunaKaWebSocketChannelOptions {
  getCredentials(endpoint: string): Promise<ChannelCredentials>
  isTrustedRenderer(webContentsId: number): boolean
}

const CHANNEL_PATH = '/api/v1/channel'
const CHANNEL_PROTOCOL = 'luna-ka.channel.v1'
const MAX_MESSAGE_BYTES = 1024 * 1024

export class LunaKaWebSocketChannel {
  private readonly channels = new Map<string, WebSocket>()
  private readonly connectionTasks = new Map<string, Promise<void>>()
  private readonly subscribers = new Map<string, Set<number>>()

  constructor(private readonly options: LunaKaWebSocketChannelOptions) {}

  register(): void {
    ipcMain.handle('luna-ka-http-client:channel:connect', (event, endpoint: unknown) => {
      this.assertTrustedRenderer(event.sender.id)
      if (typeof endpoint !== 'string') throw new Error('手机地址无效')
      return this.connect(endpoint, event.sender.id)
    })
    ipcMain.handle('luna-ka-http-client:channel:send', (event, endpoint: unknown, message: unknown) => {
      this.assertTrustedRenderer(event.sender.id)
      if (typeof endpoint !== 'string') throw new Error('手机地址无效')
      return this.send(endpoint, event.sender.id, message)
    })
    ipcMain.handle('luna-ka-http-client:channel:disconnect', (event, endpoint: unknown) => {
      this.assertTrustedRenderer(event.sender.id)
      if (typeof endpoint !== 'string') throw new Error('手机地址无效')
      return this.disconnect(endpoint, event.sender.id)
    })
  }

  async connect(endpoint: string, rendererId: number): Promise<void> {
    const base = this.normalizeEndpoint(endpoint)
    const existingTask = this.connectionTasks.get(base.origin)
    if (existingTask) {
      await existingTask
      this.addSubscriber(base.origin, rendererId)
      return
    }

    const task = this.open(base, rendererId)
    this.connectionTasks.set(base.origin, task)
    try {
      await task
    } finally {
      if (this.connectionTasks.get(base.origin) === task) {
        this.connectionTasks.delete(base.origin)
      }
    }
  }

  async send(endpoint: string, rendererId: number, message: unknown): Promise<void> {
    await this.connect(endpoint, rendererId)
    const origin = this.normalizeEndpoint(endpoint).origin
    const socket = this.channels.get(origin)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('局域网双向通道未连接')
    }
    const encoded = JSON.stringify(message)
    if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
      throw new Error('WebSocket 消息无效或超出 1 MiB 限制')
    }
    socket.send(encoded)
  }

  async disconnect(endpoint: string, rendererId: number): Promise<void> {
    const origin = this.normalizeEndpoint(endpoint).origin
    const subscribers = this.subscribers.get(origin)
    subscribers?.delete(rendererId)
    if (subscribers && subscribers.size > 0) return
    this.subscribers.delete(origin)
    const socket = this.channels.get(origin)
    if (!socket) return
    this.channels.delete(origin)
    socket.close(1000, 'client-disconnected')
  }

  private async open(base: URL, rendererId: number): Promise<void> {
    const existing = this.channels.get(base.origin)
    if (existing?.readyState === WebSocket.OPEN) {
      this.addSubscriber(base.origin, rendererId)
      return
    }

    const credentials = await this.options.getCredentials(base.origin)
    this.addSubscriber(base.origin, rendererId)
    const channelUrl = new URL(CHANNEL_PATH, base)
    channelUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(channelUrl, CHANNEL_PROTOCOL, {
      headers: {
        Authorization: `Bearer ${credentials.authorizationKey}`,
        'X-Luna-Client-Id': credentials.clientId,
      },
      handshakeTimeout: 20_000,
      maxPayload: MAX_MESSAGE_BYTES,
    })
    this.channels.set(base.origin, socket)

    await new Promise<void>((resolve, reject) => {
      let opened = false
      socket.once('open', () => {
        opened = true
        this.emitStatus({ endpoint: base.origin, state: 'open' })
        resolve()
      })
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          socket.close(1003, 'json-text-only')
          return
        }
        const bytes = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data as ArrayBuffer)
        if (bytes.byteLength > MAX_MESSAGE_BYTES) {
          socket.close(1009, 'message-too-large')
          return
        }
        try {
          const message = JSON.parse(bytes.toString('utf8')) as unknown
          this.emitMessage({ endpoint: base.origin, message })
        } catch {
          socket.close(1007, 'invalid-json')
        }
      })
      socket.on('error', (error) => {
        this.emitStatus({ endpoint: base.origin, state: 'error', reason: error.message })
        if (!opened) reject(error)
      })
      socket.once('close', (code, reason) => {
        if (this.channels.get(base.origin) === socket) this.channels.delete(base.origin)
        const reasonText = reason.toString('utf8')
        this.emitStatus({
          endpoint: base.origin,
          state: 'closed',
          code,
          ...(reasonText ? { reason: reasonText } : {}),
        })
        if (!opened) reject(new Error(`WebSocket 连接失败：${reasonText || code}`))
      })
    }).catch((error: unknown) => {
      if (this.channels.get(base.origin) === socket) this.channels.delete(base.origin)
      this.removeSubscriber(base.origin, rendererId)
      socket.terminate()
      throw error
    })
  }

  private addSubscriber(origin: string, rendererId: number): void {
    const subscribers = this.subscribers.get(origin) ?? new Set<number>()
    subscribers.add(rendererId)
    this.subscribers.set(origin, subscribers)
  }

  private removeSubscriber(origin: string, rendererId: number): void {
    const subscribers = this.subscribers.get(origin)
    subscribers?.delete(rendererId)
    if (subscribers?.size === 0) this.subscribers.delete(origin)
  }

  private emitMessage(payload: LunaKaChannelMessageEvent): void {
    this.forEachSubscriber(payload.endpoint, (target) => {
      target.send('luna-ka-http-client:channel:message', payload)
    })
  }

  private emitStatus(payload: LunaKaChannelStatusEvent): void {
    this.forEachSubscriber(payload.endpoint, (target) => {
      target.send('luna-ka-http-client:channel:status', payload)
    })
  }

  private forEachSubscriber(origin: string, callback: (target: WebContents) => void): void {
    const subscribers = this.subscribers.get(origin)
    if (!subscribers) return
    for (const id of subscribers) {
      const target = webContents.fromId(id)
      if (!target || target.isDestroyed() || !this.options.isTrustedRenderer(id)) {
        subscribers.delete(id)
        continue
      }
      callback(target)
    }
    if (subscribers.size === 0) this.subscribers.delete(origin)
  }

  private assertTrustedRenderer(rendererId: number): void {
    if (!this.options.isTrustedRenderer(rendererId)) {
      throw new Error('局域网通道只允许应用内页面访问')
    }
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
}
