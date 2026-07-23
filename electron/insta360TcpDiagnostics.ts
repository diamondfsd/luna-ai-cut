import { loadLunaProtocolCore } from './lunaProtocolCore'

type DiagnosticLevel = 'INFO' | 'WARN' | 'ERROR'
type DiagnosticLogger = (level: DiagnosticLevel, message: string, data?: unknown) => void

export interface Insta360HttpProbeResult {
  path: string
  ok: boolean
  status?: number
  server?: string | null
  contentType?: string | null
  directoryLinks?: number
  mediaLinks?: number
  preview?: string
  error?: string
}

export interface Insta360TcpCommandResult {
  label: string
  ok: boolean
  code?: number
  requestId?: number
  bodyBytes?: number
  trailer?: string
  ascii?: string
  error?: string
}

export interface Insta360DiagnosticFile {
  name: string
  path: string
  url: string
  size: number | null
}

export interface Insta360AuthProbe {
  authorized: boolean | null
  needsConfirm: boolean
  message: string
  requestId?: number
  messageCode?: number
  bodyHex?: string
  bodyAscii?: string
}

export interface Insta360DiagnosticsOptions {
  authOnly?: boolean
  fileListOnly?: boolean
  requestAuthorization?: boolean
}

export interface Insta360DiagnosticsResult {
  success: boolean
  host: string
  port: number
  http: Insta360HttpProbeResult[]
  tcp: Insta360TcpCommandResult[]
  auth: Insta360AuthProbe | null
  files: Insta360DiagnosticFile[]
  deviceInfo: {
    deviceName?: string
    serial?: string
    firmware?: string
    ssid?: string
    wifiPassword?: string
    rawStrings: string[]
  } | null
  summary: string
}

interface LunaProtocolCore {
  runInsta360TcpDiagnostics(
    host: string,
    port: number,
    log: DiagnosticLogger,
    options?: Insta360DiagnosticsOptions,
  ): Promise<Insta360DiagnosticsResult>
}

const core = loadLunaProtocolCore() as unknown as LunaProtocolCore

export const runInsta360TcpDiagnostics = core.runInsta360TcpDiagnostics
