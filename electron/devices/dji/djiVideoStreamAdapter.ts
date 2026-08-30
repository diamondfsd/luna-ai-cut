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
      codec: 'h265',
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
      codec: 'h265',
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

    const reassembler = new DjiPreviewReassembler((unit) => {
      if (this.statusValue.state !== 'starting' && this.statusValue.state !== 'running') return
      this.statusValue = {
        ...this.statusValue,
        bytes: this.statusValue.bytes + unit.data.length,
        frames: this.statusValue.frames + 1,
      }
      this.server.publish(unit.data)
    })
    this.unsubscribePreview = session.subscribePreviewPackets((packet) => {
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
    this.statusValue = { ...this.statusValue, state: 'running', message: 'DJI 相机预览已连接' }
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
    const local = await this.obsServer.start(rawStreamUrl, 'h265')
    this.statusValue = { ...this.statusValue, obsStreamUrl: local.url }
    return this.status()
  }

  async stopObs(): Promise<CameraVideoStreamStatus> {
    await this.obsServer.stop()
    this.statusValue = { ...this.statusValue, obsStreamUrl: null }
    return this.status()
  }

  private async cleanupTransport(): Promise<void> {
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
}
