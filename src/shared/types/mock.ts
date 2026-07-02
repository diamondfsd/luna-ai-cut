export interface MockServerStatus {
  running: boolean
  rootDir: string
  host: string
  httpPort: number
  tcpPort: number
  rateMbps: number
  cameraHost: string
  message: string
}
