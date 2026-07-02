import { DEFAULT_DEVICE } from './deviceDefaults'
import { lunaMediaAdapter } from './deviceMedia'
import { logMainDebug, logMainInfo, logMainWarn, logMainError } from './loggerService'
import { connectSocket, Insta360TcpSession } from './insta360TcpProtocol'
import type { ConnectionStatus, DeviceStorageOption, LunaFile } from '../src/shared/types'

export const DEFAULT_HOST = DEFAULT_DEVICE.defaultHost
export const CAMERA_PATH = DEFAULT_DEVICE.storages.find((storage) => storage.default)?.path ?? DEFAULT_DEVICE.storages[0]?.path ?? '/'

const INDEX_RE =
  /<a href="(?<href>[^"]+)">(?<name>[^<]+)<\/a>\s+(?<date>\d{2}-[A-Za-z]{3}-\d{4})\s+(?<time>\d{2}:\d{2})\s+(?<size>\S+)/gi

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

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

  return new Date(Number(dateMatch[3]), month, Number(dateMatch[1]), Number(timeMatch[1]), Number(timeMatch[2]), 0)
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

export class LunaClient {
  private controlSession: Insta360TcpSession | null = null
  private keeperTimer: ReturnType<typeof setInterval> | null = null
  private keepAliveFailures = 0
  private authLock: Promise<void> = Promise.resolve()
  private listFilesPromises = new Map<string, Promise<LunaFile[]>>()

  /** 保活失败时的回调，由调用方（main.ts）设置 */
  onKeepAliveFailed: (() => void) | null = null

  constructor(
    readonly host = DEFAULT_HOST,
    private readonly controlPort = DEFAULT_DEVICE.controlPort,
    private readonly storages: DeviceStorageOption[] = DEFAULT_DEVICE.storages,
  ) {}

  get deviceInfo(): ConnectionStatus['deviceInfo'] {
    return this.controlSession?.info ?? undefined
  }

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
    if (!this.controlSession) {
      this.controlSession = new Insta360TcpSession(this.host, this.controlPort)
    }
    if (!this.controlSession.isOpen) {
      logMainDebug(`[LunaClient] 控制会话未打开，发起连接`, { host: this.host })
      await this.controlSession.open()
    } else {
      logMainDebug(`[LunaClient] 控制会话已存活`, { host: this.host })
    }
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

  private resetControlSession(): void {
    this.controlSession?.close()
    this.controlSession = null
  }

  close(): void {
    logMainInfo(`[LunaClient] 关闭连接`, { host: this.host })
    this.stopKeepAlive()
    this.resetControlSession()
  }

  /** 启动后台保活，定期刷新控制会话。 */
  startKeepAlive(intervalMs = 3000): void {
    logMainInfo(`[保活] 启动后台保活`, { host: this.host, intervalMs })
    this.stopKeepAlive()
    this.keeperTimer = setInterval(async () => {
      try {
        await this.keepAliveTick()
        this.keepAliveFailures = 0
        logMainDebug(`[保活] 保活成功`, { host: this.host })
      } catch (error) {
        this.keepAliveFailures += 1
        logMainWarn(`[保活] 保活失败`, {
          host: this.host,
          failures: this.keepAliveFailures,
          error: error instanceof Error ? error.message : String(error),
        })
        if (this.keepAliveFailures >= 2) {
          logMainWarn(`[保活] HTTP 连续探测失败，断开连接`, { host: this.host, failures: this.keepAliveFailures })
          this.stopKeepAlive()
          this.onKeepAliveFailed?.()
        }
      }
    }, intervalMs)
  }

  private async keepAliveTick(): Promise<void> {
    // 1. HTTP 服务探测
    const endpoint = httpEndpoint(this.host)
    const socket = await connectSocket(endpoint.host, endpoint.port, 1500)
    socket.destroy()

    // 2. TCP 控制会话保活 — 发送轻量命令确认 TCP 连接存活
    if (this.controlSession?.isOpen) {
      try {
        // CODE_GET_CURRENT_CAPTURE_STATUS (15) — 轻量查询，用作 TCP 心跳
        await this.controlSession.sendCommand(15, Buffer.alloc(0), 2000)
      } catch {
        logMainWarn(`[保活] TCP 控制会话心跳失败，重置连接`, { host: this.host })
        this.resetControlSession()
      }
    }

    if (!this.controlSession?.isOpen) {
      this.resetControlSession()
      logMainDebug(`[保活] 控制会话已关闭，HTTP 服务仍可用`, { host: this.host })
    }
  }

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
      const endpoint = httpEndpoint(this.host)
      const socket = await connectSocket(endpoint.host, endpoint.port, 1500)
      socket.destroy()
      httpOk = true
    } catch (error) {
      httpError = error instanceof Error ? error.message : String(error)
      message = `HTTP 服务不可用：${httpError}`
    }

    if (this.controlSession?.isOpen) {
      controlOk = true
    } else {
      try {
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
    return { host: this.host, httpOk, controlOk, message, deviceInfo: this.deviceInfo }
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
    logMainInfo(`[文件读取] 发起文件列表请求`, { url, host: this.host, cameraPath })
    const t0 = performance.now()

    try {
      await this.connectUnlocked()
    } catch (error) {
      logMainWarn(`[文件读取] 控制会话不可用，继续使用 HTTP 目录列表`, {
        host: this.host,
        error: error instanceof Error ? error.message : String(error),
      })
      this.resetControlSession()
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        if (attempt > 0) {
          logMainWarn(`[HTTP读取] 第 ${attempt + 1}/4 次重试`, { url })
          await new Promise((resolve) => setTimeout(resolve, 300 + attempt * 250))
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

          const cameraDirs = extractCameraSubdirs(html)
          logMainDebug(`[HTTP读取] 发现 Camera 子目录`, { url, cameraDirs: cameraDirs.length > 0 ? cameraDirs : '无' })

          if (cameraDirs.length > 0) {
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

          const files = parseLunaIndex(html, baseUrl)
          const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
          logMainInfo(`[HTTP读取] 文件列表读取完成`, { fileCount: files.length, elapsedSec: elapsed })
          return files
        }

        let errorBody = ''
        try {
          errorBody = (await response.text()).slice(0, 500)
        } catch { /* 忽略读取错误体异常 */ }
        logMainWarn(`[HTTP读取] HTTP ${response.status}, 尝试 ${attempt + 1}/4`, { url, path: cameraPath, responsePreview: errorBody })
        if (response.status !== 401 && response.status !== 403) break
        this.resetControlSession()
      } catch (error) {
        lastError = error
        this.resetControlSession()
        logMainWarn(`[HTTP读取] 请求失败，尝试 ${attempt + 1}/4`, { url, path: cameraPath, error: error instanceof Error ? error.message : String(error) })
      }
    }

    const failedAt = ((performance.now() - t0) / 1000).toFixed(2)
    if (lastError && lastStatus === null) {
      logMainError(`[HTTP读取] 最终失败（无响应）`, { url, path: cameraPath, elapsedSec: failedAt, error: lastError instanceof Error ? lastError.message : String(lastError) })
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }
    logMainError(`[HTTP读取] 最终失败`, { url, path: cameraPath, status: lastStatus, elapsedSec: failedAt })
    throw new Error(`读取文件列表失败：HTTP ${lastStatus ?? '未知'}`)
  }
}

function extractCameraSubdirs(html: string): string[] {
  const dirs: string[] = []
  for (const match of html.matchAll(INDEX_RE)) {
    const href = match.groups?.href
    if (!href) continue
    const decoded = htmlDecode(href)
    if (decoded === '../') continue
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
