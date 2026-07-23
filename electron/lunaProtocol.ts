import { DEFAULT_DEVICE } from './deviceDefaults'
import { logMainDebug, logMainInfo, logMainWarn, logMainError } from './loggerService'
import { buildKeepAliveOptionsBody, connectSocket, Insta360TcpSession } from './insta360TcpProtocol'
import { parseLunaFilePaths } from './lunaMediaIndex'
import type { CameraDeleteResult, ConnectionStatus, DeviceStorageOption, LunaFile } from '../src/shared/types'

export const DEFAULT_HOST = DEFAULT_DEVICE.defaultHost
export const CAMERA_PATH = DEFAULT_DEVICE.storages.find((storage) => storage.default)?.path ?? DEFAULT_DEVICE.storages[0]?.path ?? '/'

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
  private keepAliveInFlight = false
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
      if (this.keepAliveInFlight) {
        logMainDebug(`[保活] 上一次保活仍在执行，跳过本轮`, { host: this.host })
        return
      }
      this.keepAliveInFlight = true
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
      } finally {
        this.keepAliveInFlight = false
      }
    }, intervalMs)
  }

  private async keepAliveTick(): Promise<void> {
    await this.runAuthExclusive(async () => {
      if (!this.controlSession?.isOpen) {
        this.resetControlSession()
        logMainInfo(`[保活] 控制会话已关闭，尝试重新建立`, { host: this.host })
        await this.connectUnlocked()
      }
      const session = this.controlSession
      if (!session) throw new Error('控制会话未打开')

      try {
        // UCD2 STREAM hello — 刷新控制通道活跃状态。
        await session.refresh()

        // CODE_GET_CURRENT_CAPTURE_STATUS (15) — 轻量状态查询，用作主心跳。
        await session.sendCommand(15, Buffer.alloc(0), 2000)

        // CODE_GET_OPTIONS (8) — 追加一个轻量 options 查询，模拟真实操作流量，降低相机休眠/断链概率。
        const optionsBody = buildKeepAliveOptionsBody()
        await session.sendCommand(8, optionsBody, 2000)
      } catch (error) {
        logMainWarn(`[保活] TCP 控制会话心跳失败，重置后重连`, {
          host: this.host,
          error: error instanceof Error ? error.message : String(error),
        })
        this.resetControlSession()
        await this.connectUnlocked()
      }
    })
  }

  stopKeepAlive(): void {
    if (this.keeperTimer !== null) {
      clearInterval(this.keeperTimer)
      this.keeperTimer = null
    }
  }

  async checkStatus(): Promise<ConnectionStatus> {
    const t0 = performance.now()
    let httpOk = false
    let controlOk = false
    let message = '未检测到 Luna 相机'
    let httpError: string | null = null
    let controlError: string | null = null

    logMainInfo(`[状态检测] 开始端口探测`, { host: this.host })
    const t2 = performance.now()
    if (this.controlSession?.isOpen) {
      controlOk = true
      logMainInfo(`[状态检测] 控制端口已存活（跳过探测）`, { host: this.host })
    } else {
      try {
        const socket = await connectSocket(tcpHost(this.host), this.controlPort, 1500)
        socket.destroy()
        controlOk = true
        logMainInfo(`[状态检测] 控制端口探测成功`, { host: this.host, port: this.controlPort, elapsedMs: Math.round(performance.now() - t2) })
      } catch (error) {
        controlError = error instanceof Error ? error.message : String(error)
        message = `控制端口不可用：${controlError}`
        logMainWarn(`[状态检测] 控制端口探测失败`, { host: this.host, elapsedMs: Math.round(performance.now() - t2), error: controlError })
      }
    }

    if (controlOk) {
      const t1 = performance.now()
      try {
        const endpoint = httpEndpoint(this.host)
        const socket = await connectSocket(endpoint.host, endpoint.port, 1500)
        socket.destroy()
        httpOk = true
        logMainInfo(`[状态检测] HTTP 端口探测成功`, { host: this.host, hostPort: `${endpoint.host}:${endpoint.port}`, elapsedMs: Math.round(performance.now() - t1) })
      } catch (error) {
        httpError = error instanceof Error ? error.message : String(error)
        message = `HTTP 服务不可用：${httpError}`
        logMainWarn(`[状态检测] HTTP 端口探测失败`, { host: this.host, elapsedMs: Math.round(performance.now() - t1), error: httpError })
      }
    } else {
      logMainWarn(`[状态检测] 控制端口未建立，跳过 HTTP 探测`, { host: this.host, port: this.controlPort })
    }

    if (httpOk && controlOk) {
      message = '已检测到 Luna 相机'
    }

    logMainInfo(`[状态检测] 端口检测完成`, { host: this.host, httpOk, controlOk, totalElapsedMs: Math.round(performance.now() - t0), httpError, controlError, message })
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

  async deleteFilePaths(cameraPaths: string[]): Promise<CameraDeleteResult> {
    return this.runAuthExclusive(async () => {
      await this.connectUnlocked()
      const session = this.controlSession
      if (!session) throw new Error('相机控制连接未建立')
      logMainInfo('[相机删除] 开始删除素材', { host: this.host, fileCount: cameraPaths.length })
      const result = await session.deleteFilePaths(cameraPaths)
      logMainInfo('[相机删除] 删除操作完成', {
        host: this.host,
        deleted: result.deleted.length,
        failed: result.failed.length,
      })
      return result
    })
  }

  private async listFilesUnlocked(cameraPath: string): Promise<LunaFile[]> {
    logMainInfo(`[文件读取] 发起 TCP 文件列表请求`, { host: this.host, cameraPath })
    const t0 = performance.now()

    await this.connectUnlocked()
    const session = this.controlSession
    if (!session) throw new Error('相机控制连接未建立')

    const cameraPaths = await session.listFilePaths(cameraPath)
    const files = parseLunaFilePaths(cameraPaths, `http://${this.host}/`)
    logMainInfo(`[TCP读取] 文件列表读取完成`, {
      host: this.host,
      cameraPath,
      pathCount: cameraPaths.length,
      fileCount: files.length,
      elapsedMs: Math.round(performance.now() - t0),
    })
    return files
  }
}
