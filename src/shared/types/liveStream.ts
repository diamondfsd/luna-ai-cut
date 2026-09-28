import type { RenderColorAdjustments, WatermarkPositioning } from './render'

export type LiveStreamState =
  | 'idle'
  | 'waiting-usb'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export type LiveWindowResolution = '720p'

export type LivePreviewColorAdjustments = Pick<RenderColorAdjustments,
  | 'exposure'
  | 'black'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'vibrance'
  | 'temperature'
  | 'tint'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
>

export interface LivePreviewWindowSettings {
  url: string | null
  colorAdjustments: LivePreviewColorAdjustments
  watermark: {
    src: string
    positioning: WatermarkPositioning
    opacity: number
  } | null
}

export interface NormalizedVideoPoint {
  x: number
  y: number
}

export interface NormalizedVideoRegion {
  x: number
  y: number
  width: number
  height: number
}

export type LiveStreamControlCommand =
  | { type: 'gimbal.move'; horizontal: number; vertical: number }
  | { type: 'gimbal.stop' }
  | { type: 'zoom.preview'; value: number }
  | { type: 'zoom.set'; value: number }
  | { type: 'focus.tap'; point: NormalizedVideoPoint }
  | { type: 'tracking.selectRegion'; region: NormalizedVideoRegion }
  | { type: 'tracking.stop' }
  | { type: 'exposure.set'; value: number }
  | { type: 'capabilities.get' }

export interface LiveStreamControlResult {
  requestId: string
  type: LiveStreamControlCommand['type']
  ok: boolean
  error: string | null
  data?: unknown
  completedAt: string
}

export interface LiveStreamControlCapabilities {
  gimbal: {
    supported: boolean
    continuous: boolean
  }
  zoom: {
    supported: boolean
    min: number
    max: number
    step: number
    presets: number[]
    current: number
  }
  focus: {
    tap: boolean
  }
  tracking: {
    region: boolean
  }
  exposure: {
    supported: boolean
    min: number
    max: number
    step: number
    stops: number[]
    current: number
  }
}

export interface LiveStreamStatus {
  state: LiveStreamState
  platform: string
  controlReady: boolean
  lastControlResult: LiveStreamControlResult | null
  capabilities: LiveStreamControlCapabilities | null
  receiverConnected: boolean
  transport: 'usb-aoa' | 'ios-tcp'
  usbState: 'idle' | 'waiting' | 'switching' | 'connected' | 'streaming' | 'error'
  usbMessage: string
  usbDeviceLabel: string | null
  usbVendorId: number | null
  usbProductId: number | null
  frames: number
  bytes: number
  lastFrameAt: string | null
  videoFrames: number
  videoBytes: number
  lastVideoFrameAt: string | null
  localPreviewUrl: string | null
  localPreviewError: string | null
  capturePath: string | null
  captureActive: boolean
  startedAt: string | null
  message: string
  error: string | null
}

export interface LiveStreamApi {
  status(): Promise<LiveStreamStatus>
  start(): Promise<LiveStreamStatus>
  startCapture(): Promise<string>
  stopCapture(): Promise<string | null>
  sendControl(command: LiveStreamControlCommand): Promise<string>
  stop(): Promise<LiveStreamStatus>
}
