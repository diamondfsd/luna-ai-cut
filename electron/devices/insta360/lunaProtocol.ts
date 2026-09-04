import { DEFAULT_DEVICE } from '../definitions/deviceDefaults'
import { logMainDebug, logMainInfo, logMainWarn, logMainError } from '../../infrastructure/loggerService'
import { Insta360TcpSession, probeInsta360ControlResponse, type Insta360VideoFrameListener } from './insta360TcpProtocol'
import { buildStartLiveStreamBody, CODE_START_LIVE_STREAM, CODE_STOP_LIVE_STREAM } from './lunaControlMessages'
import { parseLunaFilePaths } from './lunaMediaIndex'
import type { CameraDeleteResult, ConnectionStatus, DeviceStorageOption, LunaFile } from '../../../src/shared/types'

export const DEFAULT_HOST = DEFAULT_DEVICE.defaultHost
export const CAMERA_PATH = DEFAULT_DEVICE.storages.find((storage) => storage.default)?.path ?? DEFAULT_DEVICE.storages[0]?.path ?? '/'

const CODE_GET_CURRENT_CAPTURE_STATUS = 15
const STATUS_OK = 200
/** 官方 OpenWifiCmd 的 WIFI_HEART_BEAT 调度周期。 */
export const LUNA_WIFI_HEARTBEAT_INTERVAL_MS = 1500

function tcpHost(host: string): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return host.split(':')[0] || host
  }
}

export class LunaClient {
  private controlSession: Insta360TcpSession | null = null
  private keeperTimer: ReturnType<typeof setInterval> | null = null
  private keepAliveInFlight = false
  private keepAliveFailures = 0
  private authLock: Promise<void> = Promise.resolve()
  private listFilesPromises = new Map<string, Promise<LunaFile[]>>()
  private readonly videoListeners = new Set<Insta360VideoFrameListener>()
  private readonly sessionVideoUnsubscribers = new Map<Insta360VideoFrameListener, () => void>()

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
    if (!this.controlSession) {
      this.controlSession = new Insta360TcpSession(this.host, this.controlPort)
    }
    if (!this.controlSession.isOpen) {
      logMainDebug(`[LunaClient] 控制会话未打开，发起连接`, { host: this.host })
      await this.controlSession.open()
    } else {
      logMainDebug(`[LunaClient] 控制会话已存活`, { host: this.host })
    }
    this.attachVideoListeners()
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
    for (const unsubscribe of this.sessionVideoUnsubscribers.values()) unsubscribe()
    this.sessionVideoUnsubscribers.clear()
    this.controlSession?.close()
    this.controlSession = null
  }

  subscribeVideo(listener: Insta360VideoFrameListener): () => void {
    this.videoListeners.add(listener)
    this.attachVideoListener(listener)
    return () => {
      this.videoListeners.delete(listener)
      this.sessionVideoUnsubscribers.get(listener)?.()
      this.sessionVideoUnsubscribers.delete(listener)
    }
  }

  private attachVideoListeners(): void {
    for (const listener of this.videoListeners) this.attachVideoListener(listener)
  }

  private attachVideoListener(listener: Insta360VideoFrameListener): void {
    if (this.sessionVideoUnsubscribers.has(listener) || !this.controlSession) return
    this.sessionVideoUnsubscribers.set(listener, this.controlSession.subscribeVideo(listener))
  }

  close(): void {
    logMainInfo(`[LunaClient] 关闭连接`, { host: this.host })
    this.stopKeepAlive()
    this.resetControlSession()
  }

  /** 启动后台保活，定期刷新控制会话。 */
  startKeepAlive(intervalMs = LUNA_WIFI_HEARTBEAT_INTERVAL_MS): void {
    logMainInfo(`[保活] 启动后台保活`, { host: this.host, intervalMs })
    this.stopKeepAlive()
    this.keepAliveFailures = 0
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
          logMainWarn(`[保活] TCP 心跳连续失败，断开连接`, { host: this.host, failures: this.keepAliveFailures })
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
        // 官方 WIFI_HEART_BEAT 是无响应、单向的 UCD2 HeartBeat 帧。
        await session.refresh()
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
    let controlOk = false
    let message = '未检测到 Luna 相机'
    let controlError: string | null = null

    logMainInfo(`[状态检测] 开始控制指令探测`, { host: this.host, port: this.controlPort })
    const t2 = performance.now()
    if (this.controlSession?.isOpen) {
      try {
        const response = await this.controlSession.sendCommand(CODE_GET_CURRENT_CAPTURE_STATUS, Buffer.alloc(0), 3000)
        if (response.code !== STATUS_OK) throw new Error(`Luna 控制指令返回 ${response.code}`)
        controlOk = true
        logMainInfo(`[状态检测] 控制指令收到响应帧`, {
          host: this.host,
          commandCode: CODE_GET_CURRENT_CAPTURE_STATUS,
          responseCode: response.code,
          requestId: response.requestId,
          elapsedMs: Math.round(performance.now() - t2),
        })
      } catch (error) {
        controlError = error instanceof Error ? error.message : String(error)
        message = `控制指令无响应：${controlError}`
        logMainWarn(`[状态检测] 控制指令响应探测失败`, { host: this.host, elapsedMs: Math.round(performance.now() - t2), error: controlError })
        this.resetControlSession()
      }
    } else {
      try {
        const response = await probeInsta360ControlResponse(tcpHost(this.host), this.controlPort)
        if (response.code !== STATUS_OK) throw new Error(`Luna 控制指令返回 ${response.code}`)
        controlOk = true
        logMainInfo(`[状态检测] 控制指令收到响应帧`, {
          host: this.host,
          port: this.controlPort,
          commandCode: CODE_GET_CURRENT_CAPTURE_STATUS,
          responseCode: response.code,
          requestId: response.requestId,
          elapsedMs: Math.round(performance.now() - t2),
        })
      } catch (error) {
        controlError = error instanceof Error ? error.message : String(error)
        message = `控制指令无响应：${controlError}`
        logMainWarn(`[状态检测] 控制指令响应探测失败`, { host: this.host, elapsedMs: Math.round(performance.now() - t2), error: controlError })
      }
    }

    if (controlOk) message = '已检测到 Luna 相机'

    logMainInfo(`[状态检测] 控制指令探测完成`, { host: this.host, controlOk, totalElapsedMs: Math.round(performance.now() - t0), controlError, message })
    // Keep the legacy field populated for callers that still render it; connection validity is controlOk only.
    return { host: this.host, httpOk: controlOk, controlOk, message }
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

  async startLiveStream(): Promise<void> {
    await this.runAuthExclusive(async () => {
      await this.connectUnlocked()
      const session = this.controlSession
      if (!session) throw new Error('相机控制连接未建立')
      const response = await session.sendCommand(CODE_START_LIVE_STREAM, buildStartLiveStreamBody(), 5000)
      if (response.code !== 200) throw new Error(`相机拒绝实时视频流请求（${response.code}）`)
      logMainInfo('[相机视频流] 相机已接受开始取流命令', { host: this.host })
    })
  }

  async stopLiveStream(): Promise<void> {
    await this.runAuthExclusive(async () => {
      const session = this.controlSession
      if (!session?.isOpen) return
      const response = await session.sendCommand(CODE_STOP_LIVE_STREAM, Buffer.alloc(0), 5000)
      if (response.code !== 200) throw new Error(`相机停止实时视频流失败（${response.code}）`)
      logMainInfo('[相机视频流] 相机已接受停止取流命令', { host: this.host })
    })
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
