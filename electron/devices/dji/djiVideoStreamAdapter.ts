import { getSettings } from '../../storage/fileService'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import type { IpcContext } from '../../ipc/context'
import type {
  CameraVideoStreamAdapter,
  CameraVideoStreamOptions,
  CameraVideoStreamStatus,
} from '../../../src/shared/types'
import { deviceDefinitionFor } from '../definitions/deviceDefaults'
import { LocalObsVideoStreamServer } from '../common/localObsVideoStreamServer'
import { LocalVideoStreamServer } from '../common/localVideoStreamServer'
import { djiSessionFor, type DjiCameraSession } from './djiCameraSession'
import { DjiPreviewReassembler } from './djiPreview'

function nowIso(): string {
  return new Date().toISOString()
}

const PREVIEW_STALL_THRESHOLD_MS = 2_500
const PREVIEW_RECOVERY_ESCALATION_MS = 5_000

type PreviewRecoveryStage = 'idle' | 'enable' | 'rebuild'

export class DjiVideoStreamAdapter implements CameraVideoStreamAdapter {
  private readonly server = new LocalVideoStreamServer()
  private readonly obsServer = new LocalObsVideoStreamServer(() => {
    this.statusValue = { ...this.statusValue, obsStreamUrl: null }
  })
  private session: DjiCameraSession | null = null
  private unsubscribePreview: (() => void) | null = null
  private startPromise: Promise<CameraVideoStreamStatus> | null = null
  private generation = 0
  private rawStreamUrl: string | null = null
  private statusValue: CameraVideoStreamStatus
  private previewWatchdogTimer: ReturnType<typeof setInterval> | null = null
  private previewRecoveryPromise: Promise<void> | null = null
  private previewRecoveryGeneration = 0
  private previewRecoveryStage: PreviewRecoveryStage = 'idle'
  private previewRecoveryAt = 0
  private lastVideoPacketAt = 0
  private lastAccessUnitAt = 0

  constructor(
    private readonly ctx: IpcContext,
    private readonly options: CameraVideoStreamOptions,
  ) {
    const device = deviceDefinitionFor(options.deviceId)
    this.statusValue = {
      deviceId: device.id,
      host: options.host ?? device.defaultHost,
      state: 'idle',
      transport: null,
      codec: 'unknown',
      streamUrl: null,
      obsStreamUrl: null,
      port: null,
      bytes: 0,
      frames: 0,
      startedAt: null,
      message: '相机预览尚未启动',
      error: null,
    }
  }

  start(): Promise<CameraVideoStreamStatus> {
    if (this.statusValue.state === 'running') return Promise.resolve(this.status())
    if (this.startPromise) return this.startPromise

    const generation = ++this.generation
    this.statusValue = {
      ...this.statusValue,
      state: 'starting',
      transport: 'annexb',
      codec: 'unknown',
      streamUrl: null,
      obsStreamUrl: null,
      port: null,
      bytes: 0,
      frames: 0,
      startedAt: nowIso(),
      message: '正在连接 DJI 相机预览',
      error: null,
    }
    const task = this.startInternal(generation)
      .then(() => this.status())
      .catch(async (error: unknown) => {
        await this.cleanupTransport()
        if (generation !== this.generation || this.statusValue.state === 'stopped') {
          return this.status()
        }
        const detail = error instanceof Error ? error.message : String(error)
        this.statusValue = {
          ...this.statusValue,
          state: 'error',
          streamUrl: null,
          port: null,
          message: 'DJI 相机预览启动失败',
          error: detail,
        }
        throw error
      })
      .finally(() => {
        if (this.startPromise === task) this.startPromise = null
      })
    this.startPromise = task
    return task
  }

  private async startInternal(generation: number): Promise<void> {
    const settings = await getSettings()
    const deviceId = this.options.deviceId ?? settings.activeDeviceId ?? 'dji-pocket-4'
    const device = deviceDefinitionFor(deviceId)
    const host = this.options.host || settings.cameraHost || device.defaultHost
    this.statusValue = { ...this.statusValue, deviceId: device.id, host }

    const session = await djiSessionFor(deviceId, host, this.ctx.win)
    this.session = session
    await session.connect({ mode: 'wireless', deviceId, host })
    if (generation !== this.generation) {
      await this.cleanupTransport()
      return
    }

    let datagrams = 0
    let firstAccessUnitSeen = false
    this.lastVideoPacketAt = 0
    this.lastAccessUnitAt = 0
    this.previewRecoveryStage = 'idle'
    this.previewRecoveryAt = 0
    let resolveFirstAccessUnit: (() => void) | null = null
    const firstAccessUnit = new Promise<void>((resolve) => {
      resolveFirstAccessUnit = resolve
    })
    const reassembler = new DjiPreviewReassembler((unit) => {
      this.lastAccessUnitAt = Date.now()
      if (!firstAccessUnitSeen) {
        firstAccessUnitSeen = true
        resolveFirstAccessUnit?.()
        logMainInfo('[相机视频流] 收到首个完整 DJI 视频帧', {
          deviceId,
          host,
          bytes: unit.data.length,
          parts: unit.parts,
          nalTypes: unit.nalTypes,
          codec: unit.codec,
        })
      }
      if (this.statusValue.state !== 'starting' && this.statusValue.state !== 'running') return
      this.statusValue = {
        ...this.statusValue,
        codec: unit.codec === 'unknown' ? this.statusValue.codec : unit.codec,
        bytes: this.statusValue.bytes + unit.data.length,
        frames: this.statusValue.frames + 1,
      }
      this.server.publish(unit.data)
    }, true, device.id !== 'dji-pocket-3')
    this.unsubscribePreview = session.subscribePreviewPackets((packet) => {
      this.lastVideoPacketAt = Date.now()
      datagrams += 1
      if (datagrams === 1) {
        logMainInfo('[相机视频流] 收到首个 DJI 预览数据包', {
          deviceId,
          host,
          packetType: `0x${packet.packetType.toString(16).padStart(2, '0')}`,
          sequence: `0x${packet.sequence.toString(16).padStart(4, '0')}`,
          bytes: packet.raw.length,
        })
      }
      reassembler.feed(packet)
    })
    const local = await this.server.start()
    this.rawStreamUrl = local.url
    this.statusValue = { ...this.statusValue, streamUrl: local.url, port: local.port }
    if (generation !== this.generation) {
      await this.cleanupTransport()
      return
    }

    await session.startPreview()
    if (generation !== this.generation) {
      await this.cleanupTransport()
      return
    }
    const waitForFirstAccessUnit = (timeoutMs: number): Promise<void> => {
      if (firstAccessUnitSeen) return Promise.resolve()
      return Promise.race([
        firstAccessUnit,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('DJI 相机未返回实时视频流')), timeoutMs)
        }),
      ])
    }
    try {
      await waitForFirstAccessUnit(5000)
    } catch (error: unknown) {
      logMainWarn('[相机视频流] 等待首个视频帧超时', {
        deviceId,
        host,
        datagrams,
        transport: session.previewTransportState(),
        reassembly: reassembler.snapshot(),
        error: error instanceof Error ? error.message : String(error),
      })
      if (device.id !== 'dji-pocket-3') throw error
      const recovered = await session.recoverPocket3FirstPicture()
      if (generation !== this.generation) {
        await this.cleanupTransport()
        return
      }
      if (!recovered) throw error
      await waitForFirstAccessUnit(8000)
    }
    this.statusValue = { ...this.statusValue, state: 'running', message: 'DJI 相机预览已连接' }
    if (device.id === 'dji-pocket-3' || device.id === 'dji-pocket-4' || device.id === 'dji-pocket-4-pro') {
      this.startPreviewWatchdog(generation, session, device.id)
    }
    logMainInfo('[相机视频流] DJI 预览已启动', { deviceId, host, url: local.url })
  }

  async stop(): Promise<CameraVideoStreamStatus> {
    ++this.generation
    const startPromise = this.startPromise
    this.statusValue = {
      ...this.statusValue,
      state: 'stopped',
      obsStreamUrl: null,
      message: '相机预览已停止',
      error: null,
    }
    await this.cleanupTransport()
    await startPromise?.catch(() => undefined)
    return this.status()
  }

  status(): CameraVideoStreamStatus {
    return { ...this.statusValue }
  }

  async startObs(): Promise<CameraVideoStreamStatus> {
    if (this.statusValue.state !== 'running') await this.start()
    const rawStreamUrl = this.rawStreamUrl ?? (await this.server.start()).url
    const device = deviceDefinitionFor(this.statusValue.deviceId)
    const codec = this.statusValue.codec === 'unknown'
      ? device.id === 'dji-pocket-3' ? 'h264' : 'h265'
      : this.statusValue.codec
    const local = await this.obsServer.start(rawStreamUrl, codec)
    this.statusValue = { ...this.statusValue, obsStreamUrl: local.url }
    return this.status()
  }

  async stopObs(): Promise<CameraVideoStreamStatus> {
    await this.obsServer.stop()
    this.statusValue = { ...this.statusValue, obsStreamUrl: null }
    return this.status()
  }

  private async cleanupTransport(): Promise<void> {
    const recoveryPromise = this.previewRecoveryPromise
    this.stopPreviewWatchdog()
    await recoveryPromise?.catch(() => undefined)
    this.unsubscribePreview?.()
    this.unsubscribePreview = null
    const session = this.session
    this.session = null
    if (session) {
      await session.stopPreview().catch((error: unknown) => {
        logMainWarn('[相机视频流] DJI 停止预览失败', { error: error instanceof Error ? error.message : String(error) })
      })
    }
    this.rawStreamUrl = null
    await this.obsServer.stop()
    await this.server.stop()
  }

  private startPreviewWatchdog(generation: number, session: DjiCameraSession, deviceId: string): void {
    this.stopPreviewWatchdog()
    this.previewRecoveryGeneration = generation
    this.previewWatchdogTimer = setInterval(() => {
      this.tickPreviewWatchdog(generation, session, deviceId)
    }, 1_000)
  }

  private stopPreviewWatchdog(): void {
    if (this.previewWatchdogTimer) clearInterval(this.previewWatchdogTimer)
    this.previewWatchdogTimer = null
    this.previewRecoveryGeneration += 1
    this.previewRecoveryStage = 'idle'
    this.previewRecoveryAt = 0
  }

  private tickPreviewWatchdog(generation: number, session: DjiCameraSession, deviceId: string): void {
    if (
      generation !== this.generation
      || this.previewRecoveryGeneration !== generation
      || this.statusValue.state !== 'running'
      || this.session !== session
    ) return

    const now = Date.now()
    const lastPacketAt = this.lastVideoPacketAt || now
    const packetAge = now - lastPacketAt
    if (packetAge < PREVIEW_STALL_THRESHOLD_MS) {
      this.previewRecoveryStage = 'idle'
      this.previewRecoveryAt = 0
      return
    }
    if (this.previewRecoveryPromise) return
    if (this.previewRecoveryAt > 0 && now - this.previewRecoveryAt < PREVIEW_RECOVERY_ESCALATION_MS) return

    const stage = this.previewRecoveryStage
    this.previewRecoveryStage = stage === 'idle' ? 'enable' : 'rebuild'
    this.previewRecoveryAt = now
    const recoveryGeneration = this.previewRecoveryGeneration
    const action = stage === 'idle' ? '请求关键帧' : stage === 'enable' ? '重建 UDP' : '重新加入会话'
    logMainWarn('[相机视频流] 实时预览数据中断，开始恢复', {
      deviceId,
      action,
      packetAgeMs: packetAge,
      accessUnitAgeMs: this.lastAccessUnitAt > 0 ? now - this.lastAccessUnitAt : null,
      recoveryStage: this.previewRecoveryStage,
    })
    const task = (async () => {
      if (stage === 'idle') {
        await session.recoverPreviewEnable()
      } else if (stage === 'enable') {
        await session.rebuildPreviewUdp('预览数据中断')
      } else {
        await session.rejoinPreviewDatalink()
      }
      if (recoveryGeneration !== this.previewRecoveryGeneration || generation !== this.generation) return
      // Give the camera a short grace period after a recovery action. A real packet will replace
      // this timestamp; it only prevents the interval from issuing the next rung immediately.
      this.previewRecoveryAt = Date.now()
      if (stage === 'rebuild') this.previewRecoveryStage = 'idle'
    })().catch((error: unknown) => {
      if (recoveryGeneration !== this.previewRecoveryGeneration || generation !== this.generation) return
      logMainWarn('[相机视频流] 实时预览恢复失败', {
        deviceId,
        recoveryStage: this.previewRecoveryStage,
        error: error instanceof Error ? error.message : String(error),
      })
      // A failed rebuild proceeds to the new-session rung on the next watchdog interval. A failed
      // rejoin starts a new bounded cycle while keeping the local stream and last frame alive.
      if (stage === 'rebuild') this.previewRecoveryStage = 'rebuild'
    }).finally(() => {
      if (this.previewRecoveryPromise === task) this.previewRecoveryPromise = null
    })
    this.previewRecoveryPromise = task
  }
}
