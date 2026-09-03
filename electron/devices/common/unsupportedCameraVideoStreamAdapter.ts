import type {
  CameraVideoStreamAdapter,
  CameraVideoStreamOptions,
  CameraVideoStreamStatus,
} from '../../../src/shared/types'
import { deviceDefinitionFor } from '../definitions/deviceDefaults'

export class UnsupportedCameraVideoStreamAdapter implements CameraVideoStreamAdapter {
  private readonly statusValue: CameraVideoStreamStatus

  constructor(options: CameraVideoStreamOptions, message?: string) {
    const device = deviceDefinitionFor(options.deviceId)
    this.statusValue = {
      deviceId: device.id,
      host: options.host ?? device.defaultHost,
      state: 'unsupported',
      transport: null,
      codec: 'unknown',
      streamUrl: null,
      port: null,
      bytes: 0,
      frames: 0,
      startedAt: null,
      message: message ?? `${device.name} 暂不支持实时视频预览`,
      error: null,
    }
  }

  async start(): Promise<CameraVideoStreamStatus> {
    return this.status()
  }

  async stop(): Promise<CameraVideoStreamStatus> {
    return this.status()
  }

  async startObs(): Promise<CameraVideoStreamStatus> {
    return this.status()
  }

  async stopObs(): Promise<CameraVideoStreamStatus> {
    return this.status()
  }

  status(): CameraVideoStreamStatus {
    return { ...this.statusValue }
  }
}
