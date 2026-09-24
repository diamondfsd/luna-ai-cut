export type LiveStreamState =
  | 'idle'
  | 'waiting-usb'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export interface LiveStreamOptions {
  rtmpUrl: string
  streamKey?: string
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
  | { type: 'audio.listInputs' }
  | { type: 'audio.selectInput'; inputId: string }
  | { type: 'capabilities.get' }

export interface LiveStreamControlResult {
  requestId: string
  type: LiveStreamControlCommand['type']
  ok: boolean
  error: string | null
  data?: unknown
  completedAt: string
}

export interface LiveStreamAudioInputOption {
  id: string
  label: string
  kind: 'none' | 'phone-microphone' | 'phone-external' | 'external' | 'desktop-microphone'
  deviceId?: string
}

export interface LiveStreamAudioInputState {
  options: LiveStreamAudioInputOption[]
  selectedId: string
}

export interface LiveStreamAudioMonitorFrame {
  sampleRate: number
  channels: number
  sampleCount: number
  pcm16Le: Uint8Array
}

export interface LiveStreamAudioInputFrame {
  sampleRate: number
  channels: number
  sampleCount: number
  pcm16Le: Uint8Array
}

export type LiveStreamAudioSourceMode = 'phone' | 'desktop'

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
  audio: LiveStreamAudioInputState & {
    supported: boolean
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
  audioFrames: number
  audioBytes: number
  lastAudioFrameAt: string | null
  audioSource: number | null
  audioSampleRate: number | null
  audioChannels: number | null
  localPreviewUrl: string | null
  localPreviewError: string | null
  outputEnabled: boolean
  outputReady: boolean
  outputMessage: string | null
  startedAt: string | null
  message: string
  error: string | null
}

export interface LiveStreamApi {
  status(): Promise<LiveStreamStatus>
  start(): Promise<LiveStreamStatus>
  startOutput(options: LiveStreamOptions): Promise<LiveStreamStatus>
  stopOutput(): Promise<LiveStreamStatus>
  setAudioMonitor(enabled: boolean): Promise<boolean>
  setAudioSource(source: LiveStreamAudioSourceMode): Promise<void>
  sendAudioFrame(frame: LiveStreamAudioInputFrame): Promise<void>
  onAudioMonitorFrame(callback: (frame: LiveStreamAudioMonitorFrame) => void): () => void
  sendControl(command: LiveStreamControlCommand): Promise<string>
  stop(): Promise<LiveStreamStatus>
}
