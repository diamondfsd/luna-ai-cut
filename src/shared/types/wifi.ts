export type WifiDebugPlatform = 'darwin' | 'win32' | 'linux' | string

export interface WifiDebugAddress {
  interfaceName: string
  address: string
  family: string
  netmask: string
  mac: string
  cidr: string | null
  internal: boolean
}

export interface WifiDebugStatus {
  platform: WifiDebugPlatform
  interfaceName: string | null
  connected: boolean
  ssid: string | null
  bssid: string | null
  signal: string | null
  security: string | null
  ipAddress: string | null
  ipAddresses?: WifiDebugAddress[]
  interfaces?: Record<string, WifiDebugAddress[]>
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
  /** 无密码时通过 macOS 已保存的网络配置读取凭据；设为 false 可只尝试开放网络。 */
  savedNetworkOnly?: boolean
  /** 目标为受保护网络且必须找到系统保存的密码。 */
  requireSavedPassword?: boolean
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
