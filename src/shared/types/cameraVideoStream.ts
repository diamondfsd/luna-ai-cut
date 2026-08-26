export type CameraVideoStreamTransport = 'annexb'
export type CameraVideoStreamCodec = 'h264' | 'h265' | 'unknown'
export type CameraVideoStreamState = 'idle' | 'starting' | 'running' | 'stopped' | 'unsupported' | 'error'

export interface CameraVideoStreamOptions {
  mode: 'wireless' | 'wired'
  deviceId?: string
  host?: string
}

export interface CameraVideoStreamStatus {
  deviceId: string
  host: string
  state: CameraVideoStreamState
  transport: CameraVideoStreamTransport | null
  codec: CameraVideoStreamCodec
  streamUrl: string | null
  port: number | null
  bytes: number
  frames: number
  startedAt: string | null
  message: string
  error: string | null
}

/** 设备无关的实时视频流能力契约。设备协议只负责产出 Annex-B 数据。 */
export interface CameraVideoStreamAdapter {
  start(): Promise<CameraVideoStreamStatus>
  stop(): Promise<CameraVideoStreamStatus>
  status(): CameraVideoStreamStatus
}

export interface CameraVideoStreamApi {
  start(options: CameraVideoStreamOptions): Promise<CameraVideoStreamStatus>
  stop(options: CameraVideoStreamOptions): Promise<CameraVideoStreamStatus>
  status(options: CameraVideoStreamOptions): Promise<CameraVideoStreamStatus>
}
