import { getSettings } from '../../storage/fileService'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import type { IpcContext } from '../../ipc/context'
import type {
  CameraVideoStreamAdapter,
  CameraVideoStreamOptions,
  CameraVideoStreamStatus,
} from '../../../src/shared/types'
import { deviceDefinitionFor } from '../definitions/deviceDefaults'
import { LocalVideoStreamServer } from '../common/localVideoStreamServer'

const INITIAL_CODEC = 'unknown' as const

function nowIso(): string {
  return new Date().toISOString()
}

export class LunaVideoStreamAdapter implements CameraVideoStreamAdapter {
  private readonly server = new LocalVideoStreamServer()
  private client: ReturnType<IpcContext['lunaClientFor']> | null = null
  private unsubscribeVideo: (() => void) | null = null
  private startPromise: Promise<CameraVideoStreamStatus> | null = null
  private generation = 0
  private remoteRunning = false
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
      codec: INITIAL_CODEC,
      streamUrl: null,
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
      codec: INITIAL_CODEC,
      streamUrl: null,
      port: null,
      bytes: 0,
      frames: 0,
      startedAt: nowIso(),
      message: '正在连接相机预览',
      error: null,
    }
    const task = this.startInternal(generation)
      .then(() => this.status())
      .catch(async (error: unknown) => {
        await this.cleanupTransport()
        const detail = error instanceof Error ? error.message : String(error)
        this.statusValue = {
          ...this.statusValue,
          state: 'error',
          streamUrl: null,
          port: null,
          message: '相机预览启动失败',
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
    const device = deviceDefinitionFor(this.options.deviceId ?? settings.activeDeviceId)
    const host = this.options.host || settings.cameraHost || device.defaultHost
    this.statusValue = { ...this.statusValue, deviceId: device.id, host }

    const client = this.ctx.lunaClientFor(host, this.ctx.lunaControlPortFor(host))
    this.client = client
    await client.connect()
    if (generation !== this.generation) return

    this.unsubscribeVideo = client.subscribeVideo((frame) => {
      if (this.statusValue.state !== 'starting' && this.statusValue.state !== 'running') return
      this.statusValue = {
        ...this.statusValue,
        bytes: this.statusValue.bytes + frame.length,
        frames: this.statusValue.frames + 1,
      }
      this.server.publish(frame)
    })
    const local = await this.server.start()
    this.statusValue = { ...this.statusValue, streamUrl: local.url, port: local.port }
    if (generation !== this.generation) {
      await this.cleanupTransport()
      return
    }

    try {
      await client.startLiveStream()
      this.remoteRunning = true
    } catch (error) {
      logMainWarn('[相机视频流] Luna 开始取流失败', { host, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
    if (generation !== this.generation) {
      await this.stopRemoteStream()
      return
    }
    this.statusValue = { ...this.statusValue, state: 'running', message: '相机预览已连接' }
    logMainInfo('[相机视频流] Luna 取流已启动', { host, url: local.url })
  }

  async stop(): Promise<CameraVideoStreamStatus> {
    ++this.generation
    const startPromise = this.startPromise
    this.statusValue = {
      ...this.statusValue,
      state: 'stopped',
      message: '相机预览已停止',
      error: null,
    }
    await this.cleanupTransport()
    await startPromise?.catch(() => undefined)
    await this.stopRemoteStream()
    return this.status()
  }

  status(): CameraVideoStreamStatus {
    return { ...this.statusValue }
  }

  private async stopRemoteStream(): Promise<void> {
    if (!this.remoteRunning || !this.client) return
    try {
      await this.client.stopLiveStream()
    } catch (error) {
      logMainWarn('[相机视频流] Luna 停止取流失败', { error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.remoteRunning = false
    }
  }

  private async cleanupTransport(): Promise<void> {
    this.unsubscribeVideo?.()
    this.unsubscribeVideo = null
    await this.server.stop()
  }
}
