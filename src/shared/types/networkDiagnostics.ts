export interface NetworkDiagnosticCommandResult {
  key: string
  command: string
  args: string[]
  success: boolean
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  error?: string
  durationMs: number
}

export interface NetworkDiagnosticTcpCheck {
  ok: boolean
  host: string
  port: number
  localAddress?: string
  code?: string
  error?: string
  durationMs: number
}

export interface NetworkDiagnosticsResult {
  timestamp: string
  durationMs: number
  app: {
    platform: string
    arch: string
    node: string
    electron?: string
    chrome?: string
    v8?: string
  }
  camera: {
    host: string
    httpPort: number
    controlPort: number
  }
  network: {
    hostname: string
    localCameraSubnetIp: string | null
    /** resolveLocalAddress 的结果 — 通过子网掩码匹配目标主机找到的本地绑定地址 */
    resolvedLocalAddress: string | null
  }
  tcpChecks: {
    http80: NetworkDiagnosticTcpCheck
    control6666: NetworkDiagnosticTcpCheck
  }
  commands: NetworkDiagnosticCommandResult[]
}
