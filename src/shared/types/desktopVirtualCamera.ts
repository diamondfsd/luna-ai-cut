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
  hostRunning: boolean
  receiverConnected: boolean
  transport: 'usb-aoa'
  usbState: 'idle' | 'waiting' | 'switching' | 'connected' | 'streaming' | 'error'
  usbMessage: string
  usbDeviceLabel: string | null
  usbVendorId: number | null
  usbProductId: number | null
  port: number
  frames: number
  bytes: number
  lastFrameAt: string | null
  startedAt: string | null
  message: string
  error: string | null
}

export interface DesktopVirtualCameraApi {
  status(): Promise<DesktopVirtualCameraStatus>
  install(): Promise<DesktopVirtualCameraStatus>
  start(options: DesktopVirtualCameraOptions): Promise<DesktopVirtualCameraStatus>
  stop(): Promise<DesktopVirtualCameraStatus>
  openExtensionSettings(): Promise<void>
  revealInstallSource(): Promise<void>
}
