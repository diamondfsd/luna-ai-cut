export type DesktopVirtualCameraState =
  | 'unsupported'
  | 'not-installed'
  | 'needs-approval'
  | 'ready'
  | 'waiting-usb'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export type DesktopVirtualCameraExtensionState =
  | 'not-found'
  | 'waiting-approval'
  | 'enabled'
  | 'disabled'
  | 'unknown'

export interface DesktopVirtualCameraOptions {
  port?: number
  audioDelayMs?: number
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

export type DesktopControlCommand =
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

export interface DesktopControlResult {
  requestId: string
  type: DesktopControlCommand['type']
  ok: boolean
  error: string | null
  data?: unknown
  completedAt: string
}

export interface DesktopAudioInputOption {
  id: string
  label: string
  kind: 'none' | 'phone-microphone' | 'phone-external' | 'external' | 'desktop-microphone'
  deviceId?: string
}

export interface DesktopAudioInputState {
  options: DesktopAudioInputOption[]
  selectedId: string
}

export interface DesktopAudioMonitorFrame {
  sampleRate: number
  channels: number
  sampleCount: number
  pcm16Le: Uint8Array
}

export interface DesktopAudioInputFrame {
  sampleRate: number
  channels: number
  sampleCount: number
  pcm16Le: Uint8Array
}

export type DesktopAudioSourceMode = 'phone' | 'desktop'

export interface DesktopControlCapabilities {
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
  audio: DesktopAudioInputState & {
    supported: boolean
  }
}

export interface DesktopVirtualCameraStatus {
  state: DesktopVirtualCameraState
  platform: string
  hostAppInstalled: boolean
  bundledHostAvailable: boolean
  hostAppPath: string | null
  installSourcePath: string | null
  extensionIdentifier: string
  extensionInstalled: boolean
  extensionEnabled: boolean
  extensionState: DesktopVirtualCameraExtensionState
  virtualMicrophoneInstalled: boolean
  virtualMicrophoneAvailable: boolean
  virtualMicrophoneName: string
  controlReady: boolean
  lastControlResult: DesktopControlResult | null
  hostRunning: boolean
  outputEnabled: boolean
  outputReady: boolean
  outputMessage: string | null
  capabilities: DesktopControlCapabilities | null
  receiverConnected: boolean
  transport: 'usb-aoa' | 'ios-tcp'
  usbState: 'idle' | 'waiting' | 'switching' | 'connected' | 'streaming' | 'error'
  usbMessage: string
  usbDeviceLabel: string | null
  usbVendorId: number | null
  usbProductId: number | null
  port: number
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
  audioDelayMs: number
  localPreviewUrl: string | null
  localPreviewError: string | null
  startedAt: string | null
  message: string
  error: string | null
}

export interface DesktopVirtualCameraApi {
  status(): Promise<DesktopVirtualCameraStatus>
  install(): Promise<DesktopVirtualCameraStatus>
  start(options: DesktopVirtualCameraOptions): Promise<DesktopVirtualCameraStatus>
  startOutput(): Promise<DesktopVirtualCameraStatus>
  stopOutput(): Promise<DesktopVirtualCameraStatus>
  setAudioDelay(audioDelayMs: number): Promise<DesktopVirtualCameraStatus>
  setAudioMonitor(enabled: boolean): Promise<boolean>
  setAudioSource(source: DesktopAudioSourceMode): Promise<void>
  sendAudioFrame(frame: DesktopAudioInputFrame): Promise<void>
  onAudioMonitorFrame(callback: (frame: DesktopAudioMonitorFrame) => void): () => void
  sendControl(command: DesktopControlCommand): Promise<string>
  stop(): Promise<DesktopVirtualCameraStatus>
  openExtensionSettings(): Promise<void>
  revealInstallSource(): Promise<void>
  chooseDebugVideo(): Promise<string | null>
  startDebugVideo(filePath: string): Promise<DesktopVirtualCameraStatus>
  stopDebugVideo(): Promise<DesktopVirtualCameraStatus>
}
