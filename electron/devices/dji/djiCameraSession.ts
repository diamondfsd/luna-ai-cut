import { getSettings, saveSettings } from '../../storage/fileService'
import type { BrowserWindow } from 'electron'
import net from 'node:net'
import type { CameraMediaSourceFilePageCallback, CameraMediaSourceOptions, CameraMediaSourcePreparationResult, CameraMediaSourceStatus, ConnectionStatus, LunaFile } from '../../../src/shared/types'
import { djiProfileForDevice, type DjiModelProfile } from './djiModels'
import type { DjiWifiCredentials } from './djiBleSession'
import { encodeDjiMessage, hex, newInstallIdentity, packString, type DjiMessage } from './djiBytes'
import { isPrimaryMedia, isProxyMedia, mediaStem, parseCompositeManifest, type DjiManifestFile } from './djiManifest'
import { DjiUdpTransport, decodeDumlMessagesFromUdp, decodeDumlMessagesFromUdpStream, type DjiUdpCommand, type DjiUdpPacket } from './djiUdpTransport'
import { DefaultDjiWirelessPreparation, type DjiWirelessPreparation, waitForDjiHostReachable } from './djiWirelessPreparation'
import { mockTcpPortForHost, mockUdpPortForHost } from '../../devtools/mock/mockServerService'
import { labelsFor } from '../../media/filePathUtils'
import { lunaMediaAdapter } from '../common/deviceMedia'
import { djiErrorDetails, djiMessageDetails } from './djiLog'
import { logMainDebug, logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import {
  DJI_MANIFEST_PAGE_SIZE,
  hasManifestPageAfter,
  manifestBatchHasStabilized,
  olderManifestCursor,
  seedManifestCursor,
  stepManifestPage,
} from './djiManifestPagination'

interface DjiEndpoint {
  host: string
  httpPort: number
  udpPort: number
  tcpPort: number
}

function endpointFor(host: string, profile: DjiModelProfile): DjiEndpoint {
  const normalized = host.includes('://') ? host : `http://${host}`
  const url = new URL(normalized)
  const isMock = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  const cameraHost = `${url.hostname}:${url.port || (isMock ? profile.mockHttpPort : profile.httpPort)}`
  return {
    host: url.hostname,
    httpPort: Number(url.port || (isMock ? profile.mockHttpPort : profile.httpPort)),
    udpPort: isMock ? (mockUdpPortForHost(cameraHost) ?? profile.mockUdpPort) : profile.udpPort,
    tcpPort: isMock ? (mockTcpPortForHost(cameraHost) ?? profile.mockTcpPort) : profile.tcpPort,
  }
}

function httpBase(endpoint: DjiEndpoint): string {
  return `http://${endpoint.host}:${endpoint.httpPort}`
}

function mediaUrl(endpoint: DjiEndpoint, storage: number, cameraPath: string): string {
  // Match Osmosis' camera URL exactly. DJI's embedded HTTP server expects the path separators in the
  // query value and some firmware builds do not decode an encoded "%2F" in this parameter.
  return `${httpBase(endpoint)}/v2?storage=${storage}&path=${cameraPath}`
}

function sizeText(bytes: number | null): string {
  if (bytes === null) return '-'
  if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)}G`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}K`
  return String(bytes)
}

function storageLabel(storageId: string): string {
  return storageId === 'sdcard' ? 'SD 卡' : '内置存储'
}

function storageNumber(storageId: string): number {
  return storageId === 'sdcard' ? 0 : 1
}

function listQuery(counter: number, cursor: number): Buffer {
  const query = hex('4a002a10010000000000010000002d000d0100ffffffffffffffff000100000000000000000000000000')
  query[4] = counter & 0xff
  query.writeUInt32LE(cursor >>> 0, 10)
  return query
}

const MANIFEST_TRIGGER = hex('4a040e1001000000000001000000')
const INITIAL_INTERNAL_CURSOR = 0x40000001
const MAX_MANIFEST_PAGES = 256
const MANIFEST_MAX_WINDOW_MS = 800
const MANIFEST_QUIET_WINDOW_MS = 400

interface ManifestPage {
  sd: DjiManifestFile[]
  internal: DjiManifestFile[]
  fallback: DjiManifestFile[]
}

type DjiManifestPageCallback = (freshFiles: DjiManifestFile[], loadedFiles: DjiManifestFile[], pageNumber: number) => void | Promise<void>

function djiCommand(cmdSet: number, cmdId: number, payload: Buffer, id = 0x8026, flags = 0x40): DjiUdpCommand {
  return { target: 0x0102, id, cmdSet, cmdId, flags, payload }
}

function isManifestDataPacket(packet: DjiUdpPacket): boolean {
  if (packet.packetType === 0x03) return true
  return decodeDumlMessagesFromUdp(packet).some((message) =>
    message.cmdSet === 0x00 && message.cmdId === 0x27 && message.payload[0] === 0x4a && message.payload[1] === 0x01,
  )
}

const PREVIEW_LIVE_STATE = hex('0300000000040000000701')
const PREVIEW_START_TRIGGER = hex('0400')
const PREVIEW_READY_TRIGGER = hex('0101')
const PREVIEW_APP_PRESENCE = hex('1700162373415050000000000002')
const PREVIEW_APP_HEARTBEAT = hex('1a00000000')
const PREVIEW_CAMERA_HEARTBEAT = hex('040000000000000000')
const PREVIEW_PRESENCE_DELAY_MS = 20
const PREVIEW_IDENTITY_DELAY_MS = 92
const PREVIEW_READY_DELAY_MS = 127
const PREVIEW_VIDEO_ENABLE_DELAY_MS = 4
const PREVIEW_HEARTBEAT_DELAY_MS = 6
const PREVIEW_HEARTBEAT_GAPS_MS = [4, 6]
const PREVIEW_LIVE_STATE_DELAY_MS = 7
const PREVIEW_HEARTBEAT_INTERVAL_MS = 1000
const PREVIEW_REGISTRATION_INTERVAL_MS = 1000

function previewAppDeviceInfo(): Buffer {
  const payload = Buffer.alloc(64)
  payload.write('APP', 1, 'ascii')
  payload[34] = 0x02
  payload[41] = 0x02
  payload[42] = 0x08
  return payload
}

function previewCommand(
  target: number,
  cmdSet: number,
  cmdId: number,
  payload: Buffer,
  flags = 0x40,
  routingClass = 0,
  routingTail = 0,
): DjiUdpCommand {
  return {
    target,
    id: 0x8004,
    cmdSet,
    cmdId,
    flags,
    payload,
    routingClass,
    routingTail,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export class DjiCameraSession {
  readonly profile: DjiModelProfile
  private readonly endpoint: DjiEndpoint
  private udp: DjiUdpTransport
  private readonly wirelessPreparation: DjiWirelessPreparation
  private credentials: DjiWifiCredentials | null = null
  private connected = false
  private playbackPrepared = false
  private playbackConfirmed = false
  private previewActive = false
  private previewRequested = false
  private previewStartPromise: Promise<void> | null = null
  private previewGeneration = 0
  private previewAppHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private previewCameraHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private previewRegistrationTimer: ReturnType<typeof setInterval> | null = null
  private previewHeartbeatCounter = 0

  constructor(private readonly deviceId: string, host: string, private readonly installIdentity: string, wirelessPreparation?: DjiWirelessPreparation, win: BrowserWindow | null = null) {
    this.profile = djiProfileForDevice(deviceId)
    this.endpoint = endpointFor(host, this.profile)
    this.udp = new DjiUdpTransport(this.endpoint.host, this.endpoint.udpPort)
    this.wirelessPreparation = wirelessPreparation ?? new DefaultDjiWirelessPreparation(deviceId, host, installIdentity, undefined, win)
  }

  get host(): string {
    return `${this.endpoint.host}:${this.endpoint.httpPort}`
  }

  async connect(options: CameraMediaSourceOptions = { mode: 'wireless', deviceId: this.deviceId, host: this.host }): Promise<CameraMediaSourceStatus> {
    const startedAt = Date.now()
    logMainInfo('[DJI 连接] 相机会话连接开始', {
      deviceId: this.deviceId,
      host: this.host,
      httpPort: this.endpoint.httpPort,
      tcpPort: this.endpoint.tcpPort,
      udpPort: this.endpoint.udpPort,
      alreadyConnected: this.connected,
      preparation: options.wireless?.preparation ?? 'bluetooth-auto',
      autoJoin: options.wireless?.autoJoin === true,
      preferExistingConnection: options.preferExistingConnection === true,
      hasSsid: Boolean(options.wireless?.ssid?.trim()),
      hasPassword: Boolean(options.wireless?.password),
    })
    if (!this.connected) {
      try {
      const preparation = await this.wirelessPreparation.prepare(options)
      this.credentials = preparation.credentials ?? null
      logMainInfo('[DJI 连接] Wi-Fi 准备完成', {
        deviceId: this.deviceId,
        host: this.host,
        preparation: preparation.mode,
        elapsedMs: Date.now() - startedAt,
      })
      if (!options.wireless?.autoJoin) {
        await waitForDjiHostReachable(this.endpoint.host, this.deviceId)
      }
      await this.tcpPoke()
      logMainInfo('[DJI 连接] TCP 唤醒完成', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
      })
      await this.udp.handshake()
      logMainInfo('[DJI 连接] UDP 握手完成', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
      })
      await this.registerCamera()
      this.connected = true
      const status = this.status(`${preparation.message}，UDP 会话已建立`)
      logMainInfo('[DJI 连接] 相机会话连接完成', {
        deviceId: this.deviceId,
        host: this.host,
        preparation: preparation.mode,
        elapsedMs: Date.now() - startedAt,
      })
      return status
      } catch (error) {
        logMainError('[DJI 连接] 相机会话连接失败', {
          deviceId: this.deviceId,
          host: this.host,
          elapsedMs: Date.now() - startedAt,
          connected: this.connected,
          ...djiErrorDetails(error),
        })
        throw error
      }
    }
    logMainDebug('[DJI 连接] 复用已建立的相机会话', {
      deviceId: this.deviceId,
      host: this.host,
      elapsedMs: Date.now() - startedAt,
    })
    return this.status('DJI 相机连接已保持')
  }

  subscribePreviewPackets(listener: (packet: DjiUdpPacket) => void): () => void {
    return this.udp.subscribePackets((packet) => {
      if (packet.packetType === 0x02) listener(packet)
    })
  }

  startPreview(): Promise<void> {
    if (this.previewActive) return Promise.resolve()
    if (this.previewStartPromise) return this.previewStartPromise

    const generation = ++this.previewGeneration
    const task = this.startPreviewInternal(generation).finally(() => {
      if (this.previewStartPromise === task) this.previewStartPromise = null
    })
    this.previewStartPromise = task
    return task
  }

  async stopPreview(): Promise<void> {
    const startPromise = this.previewStartPromise
    const wasRunning = this.previewActive || this.previewRequested || Boolean(startPromise)
    ++this.previewGeneration
    this.stopPreviewTimers()
    this.previewRequested = false
    await startPromise?.catch(() => undefined)
    if (!wasRunning || !this.connected) return

    try {
      await this.udp.sendCommand(djiCommand(0x02, 0x0c, hex('01010000'), 0x8004))
      logMainDebug('[DJI 预览] 已发送停止预览命令', { deviceId: this.deviceId })
    } catch (error) {
      logMainWarn('[DJI 预览] 停止预览命令失败，继续清理本地会话', {
        deviceId: this.deviceId,
        ...djiErrorDetails(error),
      })
    }
  }

  private async startPreviewInternal(generation: number): Promise<void> {
    const startedAt = Date.now()
    try {
      if (!this.connected) await this.connect()
      if (!this.isPreviewGenerationCurrent(generation)) return
      this.udp.stopKeepAlive()
      this.stopPreviewTimers()
      this.previewRequested = true
      this.udp.startAckTimer(20)

      // Live view and media browsing use different camera-wide modes. Leave browsing first so a
      // preview opened after the media grid does not keep the camera in playback.
      await this.udp.commandAndCollect(
        djiCommand(0x02, 0x0c, hex('01010000'), 0x8004),
        450,
      )
      if (!this.isPreviewGenerationCurrent(generation)) return
      this.playbackPrepared = false
      this.playbackConfirmed = false

      await this.sendPreviewCommand(generation, previewCommand(0xf002, 0x00, 0x2b, PREVIEW_START_TRIGGER, 0x40, 0x60, 0x75))
      await this.previewDelay(generation, PREVIEW_PRESENCE_DELAY_MS)
      await this.sendPreviewCommand(generation, previewCommand(0x2802, 0x00, 0x88, PREVIEW_APP_PRESENCE))
      await this.sendPreviewCommand(generation, previewCommand(0x0302, 0x03, 0xda, hex('05ffffffff')))
      await this.previewDelay(generation, PREVIEW_IDENTITY_DELAY_MS)
      await this.sendPreviewCommand(generation, previewCommand(0x4802, 0x00, 0x81, previewAppDeviceInfo(), 0x80))
      await this.previewDelay(generation, PREVIEW_READY_DELAY_MS)
      await this.sendPreviewCommand(generation, previewCommand(0xf002, 0x00, 0x2b, PREVIEW_READY_TRIGGER))
      await this.previewDelay(generation, PREVIEW_VIDEO_ENABLE_DELAY_MS)
      await this.sendPreviewCommand(generation, previewCommand(0x4802, 0x00, 0x82, Buffer.from([0x00]), 0x80))
      await this.previewDelay(generation, PREVIEW_HEARTBEAT_DELAY_MS)

      this.previewHeartbeatCounter = 0
      for (const [index, marker] of [0x01, 0x05, 0x05].entries()) {
        await this.sendPreviewCommand(generation, previewCommand(
          0x2802,
          0x00,
          0x4f,
          Buffer.from([marker, 0x00, this.previewHeartbeatCounter, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff]),
        ))
        const gap = PREVIEW_HEARTBEAT_GAPS_MS[index]
        if (gap != null) await this.previewDelay(generation, gap)
      }
      this.previewHeartbeatCounter = 1
      await this.previewDelay(generation, PREVIEW_LIVE_STATE_DELAY_MS)
      await this.sendPreviewCommand(generation, previewCommand(0x0102, 0x01, 0x01, PREVIEW_LIVE_STATE, 0x00))
      if (!this.isPreviewGenerationCurrent(generation)) return

      this.previewActive = true
      this.previewCameraHeartbeatTimer = setInterval(() => {
        void this.sendPreviewCommand(generation, previewCommand(0x0102, 0x00, 0x4f, PREVIEW_CAMERA_HEARTBEAT)).catch((error: unknown) => {
          logMainWarn('[DJI 预览] 相机心跳发送失败', { deviceId: this.deviceId, error: error instanceof Error ? error.message : String(error) })
        })
      }, PREVIEW_HEARTBEAT_INTERVAL_MS)
      this.previewAppHeartbeatTimer = setInterval(() => {
        const payload = Buffer.from(PREVIEW_APP_HEARTBEAT)
        payload[4] = this.previewHeartbeatCounter & 0xff
        this.previewHeartbeatCounter = (this.previewHeartbeatCounter + 1) & 0xff
        void this.sendPreviewCommand(generation, previewCommand(0x2802, 0x00, 0x88, payload, 0x80)).catch((error: unknown) => {
          logMainWarn('[DJI 预览] 应用心跳发送失败', { deviceId: this.deviceId, error: error instanceof Error ? error.message : String(error) })
        })
      }, PREVIEW_HEARTBEAT_INTERVAL_MS)
      this.previewRegistrationTimer = setInterval(() => {
        void Promise.all([
          this.sendPreviewCommand(generation, previewCommand(0x4802, 0x00, 0x81, previewAppDeviceInfo(), 0x80)),
          this.sendPreviewCommand(generation, previewCommand(0x4802, 0x00, 0x82, Buffer.from([0x00]), 0x80)),
        ]).catch((error: unknown) => {
          logMainWarn('[DJI 预览] 预览注册续期失败', { deviceId: this.deviceId, error: error instanceof Error ? error.message : String(error) })
        })
      }, PREVIEW_REGISTRATION_INTERVAL_MS)
      logMainInfo('[DJI 预览] 预览启动序列已发送', {
        deviceId: this.deviceId,
        host: this.host,
        heartbeatIntervalMs: PREVIEW_HEARTBEAT_INTERVAL_MS,
        elapsedMs: Date.now() - startedAt,
      })
    } catch (error) {
      this.stopPreviewTimers()
      this.udp.stopAckTimer()
      logMainError('[DJI 预览] 预览启动失败', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  private async sendPreviewCommand(generation: number, command: DjiUdpCommand): Promise<void> {
    if (!this.isPreviewGenerationCurrent(generation)) return
    await this.udp.sendCommand(command)
  }

  private async previewDelay(generation: number, milliseconds: number): Promise<void> {
    await delay(milliseconds)
    if (!this.isPreviewGenerationCurrent(generation)) return
  }

  private isPreviewGenerationCurrent(generation: number): boolean {
    return generation === this.previewGeneration
  }

  private stopPreviewTimers(): void {
    if (this.previewAppHeartbeatTimer) clearInterval(this.previewAppHeartbeatTimer)
    if (this.previewCameraHeartbeatTimer) clearInterval(this.previewCameraHeartbeatTimer)
    if (this.previewRegistrationTimer) clearInterval(this.previewRegistrationTimer)
    this.previewAppHeartbeatTimer = null
    this.previewCameraHeartbeatTimer = null
    this.previewRegistrationTimer = null
    this.previewActive = false
    this.previewHeartbeatCounter = 0
    this.udp.stopAckTimer()
  }

  async prepareConnection(options: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult> {
    const startedAt = Date.now()
    logMainInfo('[DJI 连接] 连接准备入口开始', {
      deviceId: this.deviceId,
      host: this.host,
      preparation: options.wireless?.preparation ?? 'bluetooth-auto',
      autoJoin: options.wireless?.autoJoin === true,
      hasSsid: Boolean(options.wireless?.ssid?.trim()),
      hasPassword: Boolean(options.wireless?.password),
    })
    try {
      const preparation = await this.wirelessPreparation.prepare(options)
      this.credentials = preparation.credentials ?? null
      const result = {
        mode: 'wireless' as const,
        preparation: preparation.mode,
        credentials: preparation.credentials,
        requiresManualWifi: preparation.requiresManualWifi,
        capabilities: this.wirelessPreparation.capabilities,
        message: preparation.message,
      }
      logMainInfo('[DJI 连接] 连接准备入口完成', {
        deviceId: this.deviceId,
        host: this.host,
        preparation: preparation.mode,
        hasCredentials: Boolean(preparation.credentials),
        elapsedMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      logMainError('[DJI 连接] 连接准备入口失败', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  async check(options?: CameraMediaSourceOptions): Promise<CameraMediaSourceStatus> {
    const startedAt = Date.now()
    logMainInfo('[DJI 连接] 连接检查开始', { deviceId: this.deviceId, host: this.host })
    try {
      await this.connect(options)
      logMainInfo('[DJI 连接] 连接检查成功', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
      })
      return this.status('DJI 相机连接正常')
    } catch (error) {
      logMainWarn('[DJI 连接] 连接检查失败', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      return this.status(error instanceof Error ? error.message : String(error), false)
    }
  }

  async listFiles(storageId = 'all', options?: CameraMediaSourceOptions, onPage?: CameraMediaSourceFilePageCallback): Promise<LunaFile[]> {
    const startedAt = Date.now()
    logMainInfo('[DJI 媒体] 媒体清单读取开始', {
      deviceId: this.deviceId,
      host: this.host,
      storageId,
      connected: this.connected,
    })
    try {
      if (!this.connected) await this.connect(options)
      await this.ensurePlayback()
      const files = await this.requestManifest(storageId, async (freshFiles, loadedFiles, pageNumber) => {
        if (!onPage) return
        const primary = freshFiles
          .filter(isPrimaryMedia)
          .filter((file) => storageId === 'all' || file.storageId === storageId)
        if (primary.length === 0) return
        const proxies = loadedFiles.filter(isProxyMedia)
        await onPage({
          pageNumber,
          files: await mapWithConcurrency(primary, 4, (file) => this.toLunaFile(file, proxies)),
        })
      })
      const primary = files.filter(isPrimaryMedia)
      const proxies = files.filter(isProxyMedia)
      const result = await mapWithConcurrency(primary, 4, (file) => this.toLunaFile(file, proxies))
      logMainInfo('[DJI 媒体] 媒体清单读取完成', {
        deviceId: this.deviceId,
        host: this.host,
        storageId,
        manifestCount: files.length,
        primaryCount: primary.length,
        proxyCount: proxies.length,
        resultCount: result.length,
        previewUrlCount: result.filter((file) => Boolean(file.previewUrl)).length,
        thumbnailUrlCount: result.filter((file) => Boolean(file.thumbnailUrl)).length,
        elapsedMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      logMainError('[DJI 媒体] 媒体清单读取失败', {
        deviceId: this.deviceId,
        host: this.host,
        storageId,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  async close(): Promise<void> {
    const startedAt = Date.now()
    logMainInfo('[DJI 连接] 关闭相机会话开始', {
      deviceId: this.deviceId,
      host: this.host,
      connected: this.connected,
      playbackPrepared: this.playbackPrepared,
    })
    await this.stopPreview()
    this.connected = false
    const shouldLeavePlayback = this.playbackPrepared && this.profile.playback !== 'pocket3'
    this.udp.stopKeepAlive()
    if (shouldLeavePlayback) {
      try {
        await this.udp.sendCommand(djiCommand(0x02, 0x0c, hex('01010000'), 0x8004))
        logMainDebug('[DJI 媒体] 已发送退出回放命令', { deviceId: this.deviceId })
      } catch (error) {
        logMainWarn('[DJI 媒体] 退出回放命令失败，继续关闭会话', {
          deviceId: this.deviceId,
          ...djiErrorDetails(error),
        })
      }
    }
    this.playbackPrepared = false
    this.playbackConfirmed = false
    this.udp.close()
    try {
      await this.wirelessPreparation.close()
    } catch (error) {
      logMainError('[DJI 连接] 关闭蓝牙准备会话失败', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
    logMainInfo('[DJI 连接] 关闭相机会话完成', {
      deviceId: this.deviceId,
      host: this.host,
      elapsedMs: Date.now() - startedAt,
    })
  }

  private async registerCamera(): Promise<void> {
    const commands = [
      {
        name: '注册应用',
        message: { target: 0x0802, id: 0x8001, cmdSet: 0x00, cmdId: 0x81, flags: 0x40, payload: hex('00415050000000000000000000000000000000000000000000000000000000000000000000000200000000000000020800000000000000000000') },
      },
      {
        name: '发送应用在线状态',
        message: { target: 0x0102, id: 0x8002, cmdSet: 0x00, cmdId: 0x88, flags: 0x40, payload: hex('170046237c415050000000000002') },
      },
      {
        name: '初始化设备状态',
        message: { target: 0x0302, id: 0x8003, cmdSet: 0x03, cmdId: 0xda, flags: 0x40, payload: hex('05ffffffff') },
      },
    ] as const
    const startedAt = Date.now()
    logMainInfo('[DJI 连接] 相机注册开始', { deviceId: this.deviceId, commandCount: commands.length })
    for (const [index, command] of commands.entries()) {
      const commandStartedAt = Date.now()
      logMainDebug(`[DJI 连接] 发送注册阶段：${command.name}`, {
        deviceId: this.deviceId,
        index: index + 1,
        ...djiMessageDetails(command.message),
      })
      try {
        await this.udp.sendCommand(command.message)
        logMainDebug(`[DJI 连接] 注册阶段完成：${command.name}`, {
          deviceId: this.deviceId,
          index: index + 1,
          elapsedMs: Date.now() - commandStartedAt,
        })
      } catch (error) {
        logMainError(`[DJI 连接] 注册阶段失败：${command.name}`, {
          deviceId: this.deviceId,
          index: index + 1,
          elapsedMs: Date.now() - commandStartedAt,
          ...djiErrorDetails(error),
        })
        throw error
      }
    }
    logMainInfo('[DJI 连接] 相机注册完成', { deviceId: this.deviceId, elapsedMs: Date.now() - startedAt })
  }

  private async tcpPoke(): Promise<void> {
    const startedAt = Date.now()
    const frame = encodeDjiMessage({
      target: 0x0702,
      id: 0x8092,
      cmdSet: 0x07,
      cmdId: 0x45,
      flags: 0x40,
      payload: Buffer.concat([packString(this.installIdentity), packString('osmo')]),
    })
    logMainDebug('[DJI 连接] TCP 唤醒开始', {
      deviceId: this.deviceId,
      host: this.endpoint.host,
      port: this.endpoint.tcpPort,
      payloadBytes: frame.length,
      timeoutMs: 1200,
    })
    await new Promise<void>((resolve) => {
      const socket = net.createConnection({ host: this.endpoint.host, port: this.endpoint.tcpPort })
      let finished = false
      let outcome = 'pending'
      const finish = (reason: string): void => {
        if (finished) return
        finished = true
        outcome = reason
        socket.destroy()
        resolve()
      }
      socket.setTimeout(1200, () => finish('timeout'))
      socket.once('error', (error) => {
        logMainDebug('[DJI 连接] TCP 唤醒发生 socket 错误', {
          deviceId: this.deviceId,
          host: this.endpoint.host,
          port: this.endpoint.tcpPort,
          ...djiErrorDetails(error),
        })
        finish('error')
      })
      socket.once('connect', () => {
        logMainDebug('[DJI 连接] TCP 唤醒已建立连接，开始发送握手帧', {
          deviceId: this.deviceId,
          host: this.endpoint.host,
          port: this.endpoint.tcpPort,
          elapsedMs: Date.now() - startedAt,
        })
        socket.write(frame, () => setTimeout(() => finish('write-complete'), 40))
      })
      socket.once('timeout', () => logMainDebug('[DJI 连接] TCP 唤醒等待超时', { deviceId: this.deviceId }))
      socket.once('close', () => logMainDebug('[DJI 连接] TCP 唤醒结束', {
        deviceId: this.deviceId,
        host: this.endpoint.host,
        port: this.endpoint.tcpPort,
        outcome,
        elapsedMs: Date.now() - startedAt,
      }))
    })
  }

  private async requestManifest(storageId: string, onPage?: DjiManifestPageCallback): Promise<DjiManifestFile[]> {
    const startedAt = Date.now()
    logMainInfo('[DJI 媒体] 请求相机媒体清单', {
      deviceId: this.deviceId,
      storageId,
      pageSize: DJI_MANIFEST_PAGE_SIZE,
      maxPages: MAX_MANIFEST_PAGES,
    })
    const files: DjiManifestFile[] = []
    const seen = new Set<string>()
    let cursor = INITIAL_INTERNAL_CURSOR
    let pageNumber = 0
    let reconnects = 0

    while (pageNumber < MAX_MANIFEST_PAGES) {
      const page = await this.requestManifestPage(cursor, storageId)
      const pageFiles = page.sd.length > 0 || page.internal.length > 0
        ? [...page.sd, ...page.internal]
        : page.fallback

      // A camera may drop the datalink after a couple of pages. Rebuild only the current session and
      // retry the same cursor once; a genuinely empty final page then exits on the second attempt.
      if (pageNumber > 0 && pageFiles.length === 0 && reconnects < 1) {
        reconnects += 1
        logMainWarn('[DJI 媒体] 旧页请求未收到清单，重建会话后重试', { deviceId: this.deviceId, pageNumber, cursor })
        await this.reopenDatalinkSession()
        continue
      }
      reconnects = 0

      if (pageFiles.length === 0) break
      const pageStep = pageNumber === 0
        ? stepManifestPage(Number.MAX_SAFE_INTEGER, pageFiles, seen)
        : stepManifestPage(cursor, pageFiles, seen)
      files.push(...pageStep.fresh)

      await onPage?.(pageStep.fresh, files, pageNumber + 1)

      const pageCursor = pageNumber === 0
        ? seedManifestCursor(page.internal)
        : pageStep.nextCursor
      const internalPageIsFull = page.internal.length >= DJI_MANIFEST_PAGE_SIZE
      logMainInfo('[DJI 媒体] 清单分页完成', {
        deviceId: this.deviceId,
        pageNumber: pageNumber + 1,
        pageFileCount: pageFiles.length,
        sdCount: page.sd.length,
        internalCount: page.internal.length,
        freshCount: pageStep.fresh.length,
        totalCount: files.length,
        cursor: pageCursor,
        moreAvailable: internalPageIsFull && pageCursor > 0 && pageStep.fresh.length > 0,
      })

      if (pageNumber === 0) {
        cursor = pageCursor
        if (!hasManifestPageAfter(page.internal.length, cursor)) break
      } else {
        const advanced = olderManifestCursor(cursor, pageFiles) !== null
        cursor = pageStep.nextCursor
        if (!internalPageIsFull || !advanced || !pageStep.moreAvailable) break
      }
      pageNumber += 1
    }

    if (pageNumber >= MAX_MANIFEST_PAGES) {
      logMainWarn('[DJI 媒体] 清单分页达到安全上限', { deviceId: this.deviceId, maxPages: MAX_MANIFEST_PAGES, totalCount: files.length })
    }

    const selected = storageId === 'all' ? files : files.filter((file) => file.storageId === storageId)
    logMainInfo('[DJI 媒体] 清单读取完成', {
      deviceId: this.deviceId,
      storageId,
      pageCount: pageNumber + (files.length > 0 ? 1 : 0),
      fileCount: selected.length,
      elapsedMs: Date.now() - startedAt,
    })
    return selected
  }

  private async requestManifestPage(internalCursor: number, storageId: string): Promise<ManifestPage> {
    const startedAt = Date.now()
    const packets: DjiUdpPacket[] = []
    let lastManifestCount = -1
    let stableBatches = 0
    let stopReason = '达到最大接收窗口'

    // The camera sends the manifest through a reliable downlink. Keep the same query -> trigger ->
    // internal-query cadence as Osmosis and ACK every receive window.
    const initialPackets = await this.udp.commandAndCollect(djiCommand(0x00, 0x26, listQuery(1, 0x00000001)), MANIFEST_MAX_WINDOW_MS)
    packets.push(...initialPackets)
    await this.udp.sendAck()
    for (let batch = 1; batch < 15; batch += 1) {
      const batchStartedAt = Date.now()
      // Keep the query/trigger cadence intact, then stop a receive burst early once the
      // reliable downlink has gone quiet. The maximum window still protects delayed fragments.
      const received = batch >= 3
        ? await this.udp.collectUntilQuiet(MANIFEST_MAX_WINDOW_MS, MANIFEST_QUIET_WINDOW_MS, isManifestDataPacket)
        : await this.udp.collect(MANIFEST_MAX_WINDOW_MS)
      packets.push(...received)
      await this.udp.sendAck()
      let sentCommand: string | null = null
      if (batch === 1) {
        await this.udp.sendCommand(djiCommand(0x00, 0x26, MANIFEST_TRIGGER))
        sentCommand = 'manifest-trigger'
      }
      if (batch === 2) {
        await this.udp.sendCommand(djiCommand(0x00, 0x26, listQuery(2, internalCursor)))
        sentCommand = 'internal-storage-query'
      }
      const internalCount = this.parseManifestCounter(packets, 2, 'storage_internal').length
      if (manifestBatchHasStabilized(batch, internalCount, lastManifestCount)) {
        stableBatches += 1
        stopReason = '清单数量连续一轮稳定'
        logMainDebug('[DJI 媒体] 清单接收提前结束', { internalCursor, batch, internalCount, stopReason })
        break
      } else {
        stableBatches = 0
      }
      lastManifestCount = internalCount
      logMainDebug('[DJI 媒体] 清单接收窗口完成', {
        internalCursor,
        batch,
        receivedPackets: received.length,
        totalPackets: packets.length,
        parsedInternalCount: internalCount,
        stableBatches,
        sentCommand,
        elapsedMs: Date.now() - batchStartedAt,
      })
    }

    const sd = this.parseManifestCounter(packets, 1, 'sdcard')
    const internal = this.parseManifestCounter(packets, 2, 'storage_internal')
    const fallbackChunks = this.manifestChunks(packets)
    const fallbackStorage = storageId === 'all' ? 'sdcard' : storageId
    const fallback = sd.length === 0 && internal.length === 0 && fallbackChunks.length > 0
      ? parseCompositeManifest(Buffer.concat(fallbackChunks), fallbackStorage)
      : []
    const packetTypes = packets.reduce<Record<string, number>>((counts, packet) => {
      const key = `0x${packet.packetType.toString(16).padStart(2, '0')}`
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {})
    logMainDebug('[DJI 媒体] 清单分页收包完成', {
      internalCursor,
      packetCount: packets.length,
      packetTypes,
      sdCount: sd.length,
      internalCount: internal.length,
      fallbackCount: fallback.length,
      stopReason,
      elapsedMs: Date.now() - startedAt,
    })
    return { sd, internal, fallback }
  }

  private async reopenDatalinkSession(): Promise<void> {
    this.udp.stopKeepAlive()
    this.udp.close()
    this.udp = new DjiUdpTransport(this.endpoint.host, this.endpoint.udpPort)
    this.playbackPrepared = false
    this.playbackConfirmed = false
    await this.udp.handshake()
    await this.registerCamera()
    await this.ensurePlayback()
  }

  private manifestChunks(packets: DjiUdpPacket[], counter?: number): Buffer[] {
    const streamMessages = decodeDumlMessagesFromUdpStream(packets)
    const packetMessages = packets.flatMap((packet) => decodeDumlMessagesFromUdp(packet))
    const extract = (messages: DjiMessage[]): Buffer[] => {
      const chunks: Buffer[] = []
      for (const message of messages) {
        if (message.cmdSet !== 0x00 || message.cmdId !== 0x27 || message.payload.length < 10) continue
        const payload = message.payload
        if (payload[0] !== 0x4a || payload[1] !== 0x01 || (counter !== undefined && payload[4] !== counter)) continue
        chunks.push(payload.subarray(10))
      }
      return chunks
    }
    const streamChunks = extract(streamMessages)
    if (streamChunks.length > 0) return streamChunks
    return extract(packetMessages)
  }

  private parseManifestCounter(packets: DjiUdpPacket[], counter: number, storageId: string): DjiManifestFile[] {
    const chunks = this.manifestChunks(packets, counter)
    return chunks.length > 0 ? parseCompositeManifest(Buffer.concat(chunks), storageId) : []
  }

  private async ensurePlayback(): Promise<void> {
    if (this.playbackPrepared) {
      logMainDebug('[DJI 媒体] 复用已准备好的回放浏览会话', {
        deviceId: this.deviceId,
        playbackConfirmed: this.playbackConfirmed,
      })
      return
    }

    const startedAt = Date.now()
    logMainInfo('[DJI 媒体] 进入回放浏览模式开始', {
      deviceId: this.deviceId,
      model: this.profile.id,
      playbackProtocol: this.profile.playback,
    })
    try {
      if (this.profile.playback === 'pocket3') {
        await this.enterPocket3Playback()
        this.playbackConfirmed = true
      } else {
        this.playbackConfirmed = await this.enterStandardPlayback()
      }

      const presence = djiCommand(0x00, 0x88, hex('170046237c415050000000000002'), 0x8002)
      const reassert = djiCommand(0x02, 0x0c, hex('01010001'), 0x8004)
      await this.udp.startKeepAlive(presence, this.playbackConfirmed && this.profile.playback !== 'pocket3' ? reassert : undefined)
      this.playbackPrepared = true
      logMainInfo('[DJI 媒体] 已进入回放浏览会话', {
        deviceId: this.deviceId,
        playbackConfirmed: this.playbackConfirmed,
        keepAliveReassert: this.playbackConfirmed && this.profile.playback !== 'pocket3',
        elapsedMs: Date.now() - startedAt,
      })
    } catch (error) {
      logMainError('[DJI 媒体] 进入回放浏览模式失败', {
        deviceId: this.deviceId,
        model: this.profile.id,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  private async enterStandardPlayback(): Promise<boolean> {
    const command = djiCommand(0x02, 0x0c, hex('01010001'), 0x8004)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const startedAt = Date.now()
      const packets = await this.udp.commandAndCollect(command, 900)
      let commandStatus: number | null = null
      let cameraReportsPlayback = false
      for (const packet of packets) {
        for (const message of decodeDumlMessagesFromUdp(packet)) {
          if (message.cmdSet === 0x02 && message.cmdId === 0x0c && message.payload.length > 0) {
            commandStatus = message.payload[0]
          }
          if (message.cmdSet === 0x02 && message.cmdId === 0x80 && message.payload.length >= 4) {
            cameraReportsPlayback = (message.payload.readUInt32LE(0) & 0x40000000) !== 0
          }
        }
      }
      logMainDebug('[DJI 媒体] 回放模式响应', {
        deviceId: this.deviceId,
        attempt,
        packetCount: packets.length,
        commandStatus,
        cameraReportsPlayback,
        elapsedMs: Date.now() - startedAt,
      })
      if (cameraReportsPlayback) {
        logMainInfo('[DJI 媒体] 检测到相机回放状态位', { deviceId: this.deviceId, attempt })
        return true
      }
      // On the standard Pocket 4 path, a successful 0x02/0x0c reply is enough to accept the mode
      // change. The playback bit is still preferred when the camera pushes it during this window;
      // the "ACK does not change mode" exception is Pocket 3, which uses the separate 0x01/0x01 path.
      if (commandStatus === 0) {
        logMainInfo('[DJI 媒体] 相机确认进入回放模式', { deviceId: this.deviceId, attempt })
        return true
      }
      if (commandStatus !== null && commandStatus !== 0) {
        logMainInfo('[DJI 媒体] 相机拒绝进入回放', { deviceId: this.deviceId, status: commandStatus, attempt })
        return false
      }
      if (attempt < 3) await delay(120)
    }
    logMainInfo('[DJI 媒体] 回放命令已发送但未收到状态确认', { deviceId: this.deviceId })
    return false
  }

  private async enterPocket3Playback(): Promise<void> {
    const command = (payload: Buffer): DjiUdpCommand => ({
      target: 0x0102,
      id: 0x8004,
      cmdSet: 0x01,
      cmdId: 0x01,
      flags: 0x00,
      payload,
    })
    const prelude = hex('0300000000040000000701')
    const enter = hex('0000000000040000000401')
    const commands = Array.from({ length: 27 }, (_, index) => command(index < 6 ? prelude : enter))
    const startedAt = Date.now()
    logMainInfo('[DJI 媒体] Pocket 3 进入回放模式开始', {
      deviceId: this.deviceId,
      commandCount: commands.length,
      intervalMs: 50,
    })
    const packets = await this.udp.commandSequenceAndCollect(commands, 2000, 50)
    logMainInfo('[DJI 媒体] Pocket 3 回放模式命令完成', {
      deviceId: this.deviceId,
      packetCount: packets.length,
      elapsedMs: Date.now() - startedAt,
    })
  }

  private async toLunaFile(file: DjiManifestFile, proxies: DjiManifestFile[]): Promise<LunaFile> {
    const storageNumberValue = storageNumber(file.storageId)
    const sourceUrl = mediaUrl(this.endpoint, storageNumberValue, file.path)
    const bytes = file.bytes
    const proxyPath = file.proxyPath ?? (file.extension === 'MP4' || file.extension === 'MOV' || file.extension === 'OSV' || file.extension === 'INSV'
      ? `${file.path.slice(0, file.path.lastIndexOf('.'))}.${file.name.startsWith('CAM_') ? 'XRF' : 'LRF'}`
      : null)
    const proxy = proxies.find((candidate) => mediaStem(candidate.name) === mediaStem(file.name) && candidate.storageId === file.storageId)
    const previewPath = proxy?.path ?? proxyPath
    const previewUrl = previewPath ? mediaUrl(this.endpoint, storageNumberValue, previewPath) : null
    const kind = file.extension === 'JPG' || file.extension === 'JPEG' || file.extension === 'DNG' || file.extension === 'HEIC' ? 'image' : 'video'
    const capturedAt = lunaMediaAdapter.capturedAt(file.name)
    const labels = labelsFor(capturedAt)
    const baseId = `dji:${this.profile.id}:${file.storageId}:${file.path}`
    return {
      id: baseId,
      storageId: file.storageId,
      storageLabel: storageLabel(file.storageId),
      sourceDeviceId: this.profile.deviceId,
      sourceDeviceName: this.profile.name,
      cameraType: this.profile.name,
      name: file.name,
      href: sourceUrl,
      sourceUrl,
      url: sourceUrl,
      dateText: labels.dateText,
      timeText: labels.timeText,
      sizeText: sizeText(bytes),
      bytes,
      kind,
      extension: file.extension.toLowerCase(),
      capturedAt: labels.capturedAt,
      groupDay: labels.groupDay,
      groupHour: labels.groupHour,
      videoKey: null,
      ...(file.durationSeconds && file.durationSeconds > 0 ? { duration: file.durationSeconds } : {}),
      previewName: proxy?.name ?? (previewPath ? previewPath.slice(previewPath.lastIndexOf('/') + 1) : null),
      previewUrl,
      cacheFilePath: null,
      downloadFilePath: null,
      thumbnailUrl: file.thumbPath ? mediaUrl(this.endpoint, storageNumberValue, file.thumbPath) : null,
      isLivePhoto: false,
      livePhotoVideoName: null,
      livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null,
      downloadName: file.name,
      canPreview: true,
      rawCompanion: null,
    }
  }

  private status(message: string, connected = true): CameraMediaSourceStatus {
    const base: ConnectionStatus = {
      deviceId: this.profile.deviceId,
      deviceName: this.profile.name,
      host: this.host,
      httpOk: connected,
      controlOk: connected,
      message,
      deviceInfo: this.credentials ? { deviceName: this.profile.name, ssid: this.credentials.ssid, rawStrings: [] } : { deviceName: this.profile.name, rawStrings: [] },
    }
    return {
      ...base,
      mode: 'wireless',
      connected,
      sourceId: `dji:${this.profile.id}:${this.host}`,
      capabilities: {
        list: true,
        preview: true,
        copyToLocal: true,
        create: false,
        update: false,
        delete: false,
        watch: true,
        connection: this.wirelessPreparation.capabilities,
      },
    }
  }
}

const djiSessions = new Map<string, DjiCameraSession>()

async function installIdentity(): Promise<string> {
  const settings = await getSettings()
  if (settings.djiInstallIdentity) return settings.djiInstallIdentity
  const identity = newInstallIdentity()
  await saveSettings({ djiInstallIdentity: identity })
  return identity
}

export async function djiSessionFor(deviceId: string, host: string, win: BrowserWindow | null = null): Promise<DjiCameraSession> {
  const key = `${deviceId}:${host}`
  const existing = djiSessions.get(key)
  if (existing) {
    logMainDebug('[DJI 连接] 复用相机会话对象', { deviceId, host })
    return existing
  }
  const startedAt = Date.now()
  logMainInfo('[DJI 连接] 创建相机会话对象', { deviceId, host })
  const session = new DjiCameraSession(deviceId, host, await installIdentity(), undefined, win)
  djiSessions.set(key, session)
  logMainInfo('[DJI 连接] 相机会话对象创建完成', { deviceId, host, elapsedMs: Date.now() - startedAt })
  return session
}

export async function disconnectDjiSession(deviceId: string, host: string): Promise<void> {
  const key = `${deviceId}:${host}`
  const session = djiSessions.get(key)
  djiSessions.delete(key)
  if (!session) {
    logMainDebug('[DJI 连接] 没有需要断开的相机会话对象', { deviceId, host })
    return
  }
  const startedAt = Date.now()
  logMainInfo('[DJI 连接] 断开相机会话对象', { deviceId, host })
  try {
    await session.close()
    logMainInfo('[DJI 连接] 相机会话对象已断开', { deviceId, host, elapsedMs: Date.now() - startedAt })
  } catch (error) {
    logMainError('[DJI 连接] 断开相机会话对象失败', {
      deviceId,
      host,
      elapsedMs: Date.now() - startedAt,
      ...djiErrorDetails(error),
    })
    throw error
  }
}
