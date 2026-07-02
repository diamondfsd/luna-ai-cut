export type WifiDebugPlatform = 'darwin' | 'win32' | 'linux' | string

export interface WifiDebugStatus {
  platform: WifiDebugPlatform
  interfaceName: string | null
  connected: boolean
  ssid: string | null
  bssid: string | null
  signal: string | null
  security: string | null
  ipAddress: string | null
  raw?: string
}

export interface WifiDebugNetwork {
  ssid: string
  bssid: string | null
  signal: string | null
  security: string | null
  channel: string | null
  raw?: string
}

export interface WifiConnectOptions {
  ssid: string
  password?: string
  bssid?: string
  hidden?: boolean
  timeoutMs?: number
}

export interface WifiPortCheckOptions {
  host: string
  port: number
  timeoutMs?: number
}

export interface WifiHttpRequestOptions {
  host: string
  port: number
  path: string
  timeoutMs?: number
}

export interface WifiPortCheckResult {
  host: string
  port: number
  open: boolean
  latencyMs: number
}

export interface WifiHttpRequestResult {
  url: string
  ok: boolean
  status: number
  statusText: string
  latencyMs: number
  body: string
  json: unknown | null
}

export interface WifiDebugResult<T> {
  success: boolean
  message: string
  data?: T
  code?: string
  raw?: string
}

export interface WifiDebugApi {
  getStatus(): Promise<WifiDebugResult<WifiDebugStatus>>
  scan(): Promise<WifiDebugResult<WifiDebugNetwork[]>>
  connect(options: WifiConnectOptions): Promise<WifiDebugResult<WifiDebugStatus>>
  disconnect(): Promise<WifiDebugResult<WifiDebugStatus>>
  checkPort(options: WifiPortCheckOptions): Promise<WifiDebugResult<WifiPortCheckResult>>
  httpRequest(options: WifiHttpRequestOptions): Promise<WifiDebugResult<WifiHttpRequestResult>>
}
