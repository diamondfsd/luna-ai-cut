import * as net from 'node:net'

import { DEFAULT_DEVICE } from './deviceDefaults'
import { lunaMediaAdapter } from './deviceMedia'
import { logMainDebug, logMainInfo, logMainWarn, logMainError } from './loggerService'
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
    if (this.isOpen) {
      logMainDebug(`[TCP鉴权] 会话已存在，跳过`, { host: this.host, port: this.port })
      return
    }

    logMainInfo(`[TCP鉴权] 开始建立控制连接`, { host: this.host, port: this.port })
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const socket = await connectSocket(this.host, this.port, 1000)
        this.socket = socket
        await this.sendAuth()
        logMainInfo(`[TCP鉴权] 连接建立成功`, { host: this.host, port: this.port, attempt: attempt + 1 })
        return
      } catch (error) {
        lastError = error
        this.close()
        logMainWarn(`[TCP鉴权] 连接尝试失败`, { host: this.host, port: this.port, attempt: attempt + 1, error: error instanceof Error ? error.message : String(error) })
        await delay(200)
      }
    }

    const errMsg = lastError instanceof Error ? lastError.message : '无法打开 Luna 控制会话'
    logMainError(`[TCP鉴权] 连接最终失败`, { host: this.host, port: this.port, error: errMsg })
    throw lastError instanceof Error ? lastError : new Error('无法打开 Luna 控制会话')
  }

  async refresh(): Promise<void> {
    if (!this.isOpen) {
      logMainWarn(`[TCP鉴权] 刷新时会话已断开，重新连接`, { host: this.host, port: this.port })
      await this.open()
      return
    }

    try {
      await this.sendAuth()
      logMainDebug(`[TCP鉴权] 刷新成功`, { host: this.host, port: this.port })
    } catch (error) {
      logMainWarn(`[TCP鉴权] 刷新失败，尝试重连`, { host: this.host, port: this.port, error: error instanceof Error ? error.message : String(error) })
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
      logMainDebug(`[LunaClient] 鉴权会话未打开，发起连接`, { host: this.host })
      await this.authSession.open()
    } else {
      logMainDebug(`[LunaClient] 鉴权会话已存活，跳过认证`, { host: this.host })
    }
    // 会话已存活则跳过重复认证（sendAuth + drainSocket ~290ms）
  }

  async connect(): Promise<void> {
    logMainInfo(`[LunaClient] 开始连接`, { host: this.host })
    try {
      await this.runAuthExclusive(() => this.connectUnlocked())
      logMainInfo(`[LunaClient] 连接成功`, { host: this.host })
    } catch (error) {
      logMainError(`[LunaClient] 连接失败`, { host: this.host, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  private resetAuthSession(): void {
    this.authSession?.close()
    this.authSession = null
  }

  private async reconnectForAuthUnlocked(attempt: number): Promise<void> {
    logMainWarn(`[LunaClient] 重新认证`, { host: this.host, attempt: attempt + 1 })
    this.stopKeepAlive()
    this.resetAuthSession()
    await delay(300 + attempt * 250)
    await this.connectUnlocked()
  }

  close(): void {
    logMainInfo(`[LunaClient] 关闭连接`, { host: this.host })
    this.stopKeepAlive()
    this.resetAuthSession()
  }

  /** 启动后台保活，定期刷新鉴权会话（防止相机端显示已断开） */
  startKeepAlive(intervalMs = 5000): void {
    logMainInfo(`[保活] 启动后台保活`, { host: this.host, intervalMs })
    this.stopKeepAlive()
    this.keeperTimer = setInterval(async () => {
      try {
        await this.connect()
        logMainDebug(`[保活] 保活成功`, { host: this.host })
      } catch (error) {
        logMainWarn(`[保活] 保活失败，断开连接`, { host: this.host, error: error instanceof Error ? error.message : String(error) })
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
    let httpError: string | null = null
    let controlError: string | null = null

    try {
      // 端口 80（HTTP）：超时 1.5 秒 — 本地网络设备检测无需更久
      const endpoint = httpEndpoint(this.host)
      const socket = await connectSocket(endpoint.host, endpoint.port, 1500)
      socket.destroy()
      httpOk = true
    } catch (error) {
      httpError = error instanceof Error ? error.message : String(error)
      message = `HTTP 服务不可用：${httpError}`
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
        controlError = error instanceof Error ? error.message : String(error)
        if (httpOk) {
          message = `控制端口不可用：${controlError}`
        }
      }
    }

    if (httpOk && controlOk) {
      message = '已检测到 Luna 相机'
    }

    logMainInfo(`[状态检测] 端口检测结果`, { host: this.host, httpOk, controlOk, httpError, controlError, message })
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
    const url = cameraUrl(this.host, cameraPath)
    logMainInfo(`[HTTP读取] 发起文件列表请求`, { url, host: this.host, cameraPath })
    const t0 = performance.now()

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        if (attempt > 0) {
          logMainWarn(`[HTTP读取] 第 ${attempt + 1}/4 次重试`, { url })
          await this.reconnectForAuthUnlocked(attempt)
        } else {
          await this.connectUnlocked()
        }

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'LunaAI-Cut/0.1',
            'Accept-Encoding': 'identity',
            'Cache-Control': 'no-cache',
          },
        })

        lastStatus = response.status
        logMainDebug(`[HTTP读取] 响应状态`, { url, status: response.status, attempt: attempt + 1 })

        if (response.ok) {
          const html = await response.text()
          const baseUrl = url

          // 发现 Camera* 子目录（相机在图片过多时会自动分文件夹）
          const cameraDirs = extractCameraSubdirs(html)
          logMainDebug(`[HTTP读取] 发现 Camera 子目录`, { url, cameraDirs: cameraDirs.length > 0 ? cameraDirs : '无' })

          if (cameraDirs.length > 0) {
            // 读取所有 Camera* 子目录中的文件并聚合
            const results = await Promise.all(
              cameraDirs.map(async (dir) => {
                const dirUrl = cameraUrl(this.host, `${cameraPath}${dir}/`)
                try {
                  logMainDebug(`[HTTP读取] 读取子目录`, { url: dirUrl })
                  const dirResponse = await fetch(dirUrl, {
                    headers: {
                      'User-Agent': 'LunaAI-Cut/0.1',
                      'Accept-Encoding': 'identity',
                      'Cache-Control': 'no-cache',
                    },
                  })
                  if (!dirResponse.ok) {
                    logMainWarn(`[HTTP读取] 子目录请求失败`, { url: dirUrl, status: dirResponse.status })
                    return []
                  }
                  const dirFiles = parseLunaIndex(await dirResponse.text(), dirUrl)
                  logMainDebug(`[HTTP读取] 子目录文件数`, { dir, fileCount: dirFiles.length })
                  return dirFiles
                } catch (error) {
                  logMainWarn(`[HTTP读取] 子目录读取异常`, { dir, error: error instanceof Error ? error.message : String(error) })
                  return []
                }
              }),
            )
            const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
            const allFiles = results.flat()
            logMainInfo(`[HTTP读取] 文件列表读取完成（多子目录）`, { fileCount: allFiles.length, cameraDirs: cameraDirs.length, elapsedSec: elapsed })
            return allFiles
          }

          // 没有 Camera* 子目录，直接从根目录解析文件
          const files = parseLunaIndex(html, baseUrl)
          const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
          logMainInfo(`[HTTP读取] 文件列表读取完成`, { fileCount: files.length, elapsedSec: elapsed })
          return files
        }

        response.body?.cancel().catch(() => undefined)
        logMainWarn(`[HTTP读取] HTTP ${response.status}, 尝试 ${attempt + 1}/4`, { url })
        if (response.status !== 401 && response.status !== 403) break
        this.resetAuthSession()
      } catch (error) {
        lastError = error
        this.resetAuthSession()
        logMainWarn(`[HTTP读取] 请求失败，尝试 ${attempt + 1}/4`, { url, error: error instanceof Error ? error.message : String(error) })
      }
    }

    const failedAt = ((performance.now() - t0) / 1000).toFixed(2)
    if (lastError && lastStatus === null) {
      logMainError(`[HTTP读取] 最终失败（无响应）`, { url, elapsedSec: failedAt, error: lastError instanceof Error ? lastError.message : String(lastError) })
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }
    logMainError(`[HTTP读取] 最终失败`, { url, status: lastStatus, elapsedSec: failedAt })
    throw new Error(`读取文件列表失败：HTTP ${lastStatus ?? '未知'}`)
  }
}

/**
 * 从 Apache 目录列表 HTML 中提取所有 Camera* 子目录名
 */
function extractCameraSubdirs(html: string): string[] {
  const dirs: string[] = []
  for (const match of html.matchAll(INDEX_RE)) {
    const href = match.groups?.href
    if (!href) continue
    const decoded = htmlDecode(href)
    if (decoded === '../') continue
    // Camera01/, Camera02/, Camera03/ ... 兼容 Camera1, Camera999
    if (decoded.endsWith('/') && /^Camera\d+\/$/i.test(decoded)) {
      dirs.push(decoded.replace(/\/$/, ''))
    }
  }
  return dirs.sort()
}

export function parseLunaIndex(html: string, baseUrl = cameraUrl(DEFAULT_HOST)): LunaFile[] {
  const files: LunaFile[] = []

  for (const match of html.matchAll(INDEX_RE)) {
    const groups = match.groups
    if (!groups) continue

    const href = htmlDecode(groups.href)
    const name = htmlDecode(groups.name)
    if (href === '../' || name === '../') continue
    // 跳过目录条目（Apache 目录列表中的子目录以 / 结尾）
    if (href.endsWith('/')) continue

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
