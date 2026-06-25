import * as net from 'node:net'

import { DEFAULT_DEVICE } from './deviceDefaults'
import { lunaMediaAdapter } from './deviceMedia'
import type { ConnectionStatus, DeviceStorageOption, LunaFile } from '../src/shared/types'

export const DEFAULT_HOST = DEFAULT_DEVICE.defaultHost
export const CAMERA_PATH = DEFAULT_DEVICE.storages.find((storage) => storage.default)?.path ?? DEFAULT_DEVICE.storages[0]?.path ?? '/'

const AUTH_PAYLOADS = [
  Buffer.from([
    0x55, 0x43, 0x44, 0x32, 0x01, 0x0c, 0x05, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x37, 0x05, 0x47, 0x7c,
  ]),
  Buffer.from([
    0x55, 0x43, 0x44, 0x32, 0x01, 0x0c, 0x04, 0x10, 0x0f, 0x00, 0x00, 0x00, 0x08, 0x00, 0x02, 0x01,
    0x00, 0x00, 0x80, 0x00, 0x00, 0x08, 0x30, 0x08, 0x0f, 0x08, 0x0b, 0x7c, 0x00, 0x8e, 0x7c,
  ]),
]

const INDEX_RE =
  /<a href="(?<href>[^"]+)">(?<name>[^<]+)<\/a>\s+(?<date>\d{2}-[A-Za-z]{3}-\d{4})\s+(?<time>\d{2}:\d{2})\s+(?<size>\S+)/gi

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseSize(text: string): number | null {
  const match = text.trim().match(/^(?<number>\d+(?:\.\d+)?)(?<unit>[KMG])?$/i)
  if (!match?.groups) return null

  const number = Number.parseFloat(match.groups.number)
  const unit = match.groups.unit?.toUpperCase()
  const multiplier = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : unit === 'K' ? 1024 : 1
  return Math.floor(number * multiplier)
}

function parseIndexTimestamp(dateText: string, timeText: string): Date | null {
  const dateMatch = dateText.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/)
  const timeMatch = timeText.match(/^(\d{2}):(\d{2})$/)
  if (!dateMatch || !timeMatch) return null

  const month = MONTHS[dateMatch[2]]
  if (month === undefined) return null

  return new Date(
    Number(dateMatch[3]),
    month,
    Number(dateMatch[1]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
  )
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function groupLabels(date: Date | null): Pick<LunaFile, 'capturedAt' | 'groupDay' | 'groupHour'> {
  if (!date || Number.isNaN(date.getTime())) {
    return { capturedAt: null, groupDay: '未知日期', groupHour: '未知时间' }
  }

  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return {
    capturedAt: date.toISOString(),
    groupDay: day,
    groupHour: `${day} ${pad(date.getHours())}:00`,
  }
}

function cameraUrl(host: string, cameraPath = CAMERA_PATH): string {
  return `http://${host}${cameraPath}`
}

function tcpHost(host: string): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return host.split(':')[0] || host
  }
}

function httpEndpoint(host: string, cameraPath = CAMERA_PATH): { host: string; port: number } {
  try {
    const url = new URL(cameraUrl(host, cameraPath))
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 80,
    }
  } catch {
    return { host: tcpHost(host), port: 80 }
  }
}

function connectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  // socket.setTimeout 只监控连接建立后的空闲超时，不控制连接过程本身。
  // 用实际定时器 + socket.destroy 做 TCP 连接超时切断。
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let settled = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(connTimer)
      clearTimeout(fallbackTimer)
      if (err) {
        socket.destroy()
        reject(err)
      } else {
        resolve(socket)
      }
    }

    // 主超时：定时切断 TCP 连接
    const connTimer = setTimeout(() => {
      socket.destroy()
      finish(new Error(`连接 ${host}:${port} 超时`))
    }, timeoutMs)

    // 连接过程 error / connect 事件
    socket.once('connect', () => finish())
    socket.once('error', (err) => finish(err))

    // 兜底定时器（极少情况两个事件都不触发）
    const fallbackTimer = setTimeout(() => finish(new Error(`连接 ${host}:${port} 超时`)), timeoutMs + 3000)
  })
}

function drainSocket(socket: net.Socket, timeoutMs = 220): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = (): void => {
      socket.off('data', onData)
      clearTimeout(timer)
      resolve()
    }
    const onData = (): void => undefined
    const timer = setTimeout(cleanup, timeoutMs)
    socket.on('data', onData)
  })
}

export class LunaAuthSession {
  private socket: net.Socket | null = null
  private readonly host: string
  private readonly port: number

  constructor(host = DEFAULT_HOST, port = DEFAULT_DEVICE.controlPort) {
    this.host = tcpHost(host)
    this.port = port
  }

  get isOpen(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  async open(): Promise<void> {
    if (this.isOpen) return

    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const socket = await connectSocket(this.host, this.port, 1000)
        this.socket = socket
        await this.sendAuth()
        return
      } catch (error) {
        lastError = error
        this.close()
        await delay(200)
      }
    }

    throw lastError instanceof Error ? lastError : new Error('无法打开 Luna 控制会话')
  }

  async refresh(): Promise<void> {
    if (!this.isOpen) {
      await this.open()
      return
    }

    try {
      await this.sendAuth()
    } catch {
      this.close()
      await this.open()
    }
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
  }

  private async sendAuth(): Promise<void> {
    if (!this.socket) throw new Error('控制会话未打开')

    for (const payload of AUTH_PAYLOADS) {
      this.socket.write(payload)
      await delay(30)
    }
    await drainSocket(this.socket)
  }
}

export class LunaClient {
  private authSession: LunaAuthSession | null = null
  private keeperTimer: ReturnType<typeof setInterval> | null = null
  private authLock: Promise<void> = Promise.resolve()
  private listFilesPromises = new Map<string, Promise<LunaFile[]>>()

  /** 保活失败时的回调，由调用方（main.ts）设置 */
  onKeepAliveFailed: (() => void) | null = null

  constructor(
    readonly host = DEFAULT_HOST,
    private readonly controlPort = DEFAULT_DEVICE.controlPort,
    private readonly storages: DeviceStorageOption[] = DEFAULT_DEVICE.storages,
  ) {}

  private async runAuthExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.authLock
    let release: () => void = () => undefined
    this.authLock = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  }

  private async connectUnlocked(): Promise<void> {
    if (!this.authSession) {
      this.authSession = new LunaAuthSession(this.host, this.controlPort)
    }
    if (!this.authSession.isOpen) {
      await this.authSession.open()
    }
    // 会话已存活则跳过重复认证（sendAuth + drainSocket ~290ms）
  }

  async connect(): Promise<void> {
    await this.runAuthExclusive(() => this.connectUnlocked())
  }

  private resetAuthSession(): void {
    this.authSession?.close()
    this.authSession = null
  }

  private async reconnectForAuthUnlocked(attempt: number): Promise<void> {
    this.stopKeepAlive()
    this.resetAuthSession()
    await delay(300 + attempt * 250)
    await this.connectUnlocked()
  }

  close(): void {
    this.stopKeepAlive()
    this.resetAuthSession()
  }

  /** 启动后台保活，每 2 秒刷新一次鉴权会话（防止相机端显示已断开） */
  startKeepAlive(intervalMs = 2000): void {
    this.stopKeepAlive()
    this.keeperTimer = setInterval(async () => {
      try {
        await this.connect()
      } catch {
        // 保活失败立即断开，回到连接页面
        this.stopKeepAlive()
        this.onKeepAliveFailed?.()
      }
    }, intervalMs)
  }

  /** 停止后台保活 */
  stopKeepAlive(): void {
    if (this.keeperTimer !== null) {
      clearInterval(this.keeperTimer)
      this.keeperTimer = null
    }
  }

  async checkStatus(): Promise<ConnectionStatus> {
    let httpOk = false
    let controlOk = false
    let message = '未检测到 Luna 相机'

    try {
      // 端口 80（HTTP）：超时 1.5 秒 — 本地网络设备检测无需更久
      const endpoint = httpEndpoint(this.host)
      const socket = await connectSocket(endpoint.host, endpoint.port, 1500)
      socket.destroy()
      httpOk = true
    } catch (error) {
      message = `HTTP 服务不可用：${error instanceof Error ? error.message : String(error)}`
    }

    if (this.authSession?.isOpen) {
      // 已有活跃的 auth 会话，说明控制端口肯定可用，跳过探测避免干扰会话
      controlOk = true
    } else {
      try {
        // 控制端口只检测通断，超时 1.5s
        const socket = await connectSocket(tcpHost(this.host), this.controlPort, 1500)
        socket.destroy()
        controlOk = true
      } catch (error) {
        if (httpOk) {
          message = `控制端口不可用：${error instanceof Error ? error.message : String(error)}`
        }
      }
    }

    if (httpOk && controlOk) {
      message = '已检测到 Luna 相机'
    }

    return { host: this.host, httpOk, controlOk, message }
  }

  storagePath(storageId?: string): string {
    const storage =
      this.storages.find((item) => item.id === storageId) ??
      this.storages.find((item) => item.default) ??
      this.storages[0]
    return storage?.path ?? CAMERA_PATH
  }

  async listFiles(storageId?: string): Promise<LunaFile[]> {
    const cameraPath = this.storagePath(storageId)
    const existing = this.listFilesPromises.get(cameraPath)
    if (existing) return existing

    const task = this.runAuthExclusive(() => this.listFilesUnlocked(cameraPath))
      .finally(() => {
        this.listFilesPromises.delete(cameraPath)
      })
    this.listFilesPromises.set(cameraPath, task)
    return task
  }

  private async listFilesUnlocked(cameraPath: string): Promise<LunaFile[]> {
    let lastStatus: number | null = null
    let lastError: unknown = null

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        if (attempt > 0) {
          await this.reconnectForAuthUnlocked(attempt)
        } else {
          await this.connectUnlocked()
        }

        const response = await fetch(cameraUrl(this.host, cameraPath), {
          headers: {
            'User-Agent': 'LunaAI-Cut/0.1',
            'Accept-Encoding': 'identity',
            'Cache-Control': 'no-cache',
          },
        })

        lastStatus = response.status
        if (response.ok) {
          const files = parseLunaIndex(await response.text(), cameraUrl(this.host, cameraPath))
          return files
        }

        response.body?.cancel().catch(() => undefined)
        console.warn(`[luna] listFiles HTTP ${response.status}, attempt ${attempt + 1}/4`)
        if (response.status !== 401 && response.status !== 403) break
        this.resetAuthSession()
      } catch (error) {
        lastError = error
        this.resetAuthSession()
        console.warn(`[luna] listFiles failed, attempt ${attempt + 1}/4`, error)
      }
    }

    if (lastError && lastStatus === null) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }
    throw new Error(`读取文件列表失败：HTTP ${lastStatus ?? '未知'}`)
  }
}

export function parseLunaIndex(html: string, baseUrl = cameraUrl(DEFAULT_HOST)): LunaFile[] {
  const files: LunaFile[] = []

  for (const match of html.matchAll(INDEX_RE)) {
    const groups = match.groups
    if (!groups) continue

    const href = htmlDecode(groups.href)
    const name = htmlDecode(groups.name)
    if (href === '../' || name === '../') continue

    const kind = lunaMediaAdapter.mediaKind(name)
    const timestamp = lunaMediaAdapter.capturedAt(name) ?? parseIndexTimestamp(groups.date, groups.time)
    const labels = groupLabels(timestamp)
    const videoKey = lunaMediaAdapter.videoKey(name)
    const livePhotoKey = lunaMediaAdapter.livePhotoKey(name)
    const extension = lunaMediaAdapter.extensionOf(name)
    const url = new URL(href, baseUrl).toString()

    files.push({
      id: name,
      name,
      href,
      sourceUrl: url,
      url,
      dateText: groups.date,
      timeText: groups.time,
      sizeText: groups.size,
      bytes: parseSize(groups.size),
      kind,
      extension,
      videoKey,
      capturedAt: labels.capturedAt,
      groupDay: labels.groupDay,
      groupHour: labels.groupHour,
      previewName: null,
      previewUrl: null,
      cacheFilePath: null,
      downloadFilePath: null,
      thumbnailUrl: null,
      isLivePhoto: Boolean(livePhotoKey),
      livePhotoVideoName: null,
      livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null,
      downloadName: lunaMediaAdapter.downloadName(name),
      canPreview: kind === 'image' || kind === 'video' || kind === 'lrv',
    })
  }

  return lunaMediaAdapter.attachRelatedFiles(files).map((file) => ({
    ...file,
    thumbnailUrl: null,
    livePhotoCacheFilePath: null,
  }))
}
