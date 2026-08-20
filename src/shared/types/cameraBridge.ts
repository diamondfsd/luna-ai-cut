export type CameraBridgeStatus = {
  state: 'idle' | 'waiting-usb' | 'negotiating' | 'connected' | 'receiving' | 'error'
  transport: 'android-aoa'
  usbVendorId: number | null
  usbProductId: number | null
  frames: number
  bytes: number
  videoFrames: number
  keyframes: number
  fps: number
  codec: string
  width: number | null
  height: number | null
  lastFrameAt: string | null
  parserErrors: number
  error: string | null
}

export type CameraBridgeFrame = {
  type: number
  flags: number
  sequence: number
  timestampUs: string
  payload: Uint8Array
}

export type CameraBridgeApi = {
  start(): Promise<CameraBridgeStatus>
  stop(): Promise<CameraBridgeStatus>
  getStatus(): Promise<CameraBridgeStatus>
  onStatus(callback: (status: CameraBridgeStatus) => void): () => void
  onFrame(callback: (frame: CameraBridgeFrame) => void): () => void
  startObsOutput(): Promise<ObsCameraOutputStatus>
  stopObsOutput(): Promise<ObsCameraOutputStatus>
  getObsOutputStatus(): Promise<ObsCameraOutputStatus>
  onObsOutputStatus(callback: (status: ObsCameraOutputStatus) => void): () => void
  startVirtualCamera(): Promise<MacVirtualCameraStatus>
  stopVirtualCamera(): Promise<MacVirtualCameraStatus>
  getVirtualCameraStatus(): Promise<MacVirtualCameraStatus>
  onVirtualCameraStatus(callback: (status: MacVirtualCameraStatus) => void): () => void
}

export type ObsCameraOutputStatus = {
  supported: boolean
  state: 'unsupported' | 'stopped' | 'starting' | 'running' | 'error'
  streamUrl: string
  codec: string
  frames: number
  droppedFrames: number
  error: string | null
}

export type MacVirtualCameraStatus = {
  supported: boolean
  state: 'unsupported' | 'stopped' | 'starting' | 'running' | 'error'
  deviceName: string
  frames: number
  error: string | null
}
