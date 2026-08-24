export interface MockServerConfig {
  rootDir: string
  host: string
  httpPort: number
  tcpPort: number
  udpPort: number
  rateMbps: number
}

export interface MockServerStatus {
  running: boolean
  rootDir: string
  host: string
  httpPort: number
  tcpPort: number
  udpPort: number
  rateMbps: number
  cameraHost: string
  message: string
  deviceId: string
  deviceName: string
}
