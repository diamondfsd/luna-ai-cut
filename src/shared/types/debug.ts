import type { Insta360DeviceInfo } from './device'

export interface DeviceDebugTestStep {
  step: string
  success: boolean
  detail: string
  elapsedMs: number
}

export interface DeviceDebugTestResult {
  deviceId: string
  host: string
  overall: boolean
  steps: DeviceDebugTestStep[]
  authState: string
  summary: string
}

export interface DeviceDebugEvent {
  level: string
  message: string
  data?: unknown
}

export interface DeviceDebugPortResult {
  httpOk: boolean
  controlOk: boolean
  httpPort: number | null
  controlPort: number | null
  message: string
}

export interface DeviceDebugConnectResult {
  success: boolean
  authState: string
  message: string
  httpOk: boolean
  controlOk: boolean
}

export interface DeviceDebugAuthResult {
  success: boolean
  authState: string
  message: string
}

export interface DeviceDebugFileListResult {
  success: boolean
  files: Array<{ name: string; size: number | null; url: string }>
  http?: Array<{
    path: string
    ok: boolean
    status?: number
    server?: string | null
    contentType?: string | null
    error?: string
  }>
  message: string
}

export interface DeviceDebugDiagnosticsResult {
  success: boolean
  host: string
  port: number
  http: Array<{
    path: string
    ok: boolean
    status?: number
    server?: string | null
    contentType?: string | null
    directoryLinks?: number
    mediaLinks?: number
    preview?: string
    error?: string
  }>
  tcp: Array<{
    label: string
    ok: boolean
    code?: number
    requestId?: number
    bodyBytes?: number
    trailer?: string
    ascii?: string
    error?: string
  }>
  auth: {
    authorized: boolean | null
    needsConfirm: boolean
    message: string
    requestId?: number
    messageCode?: number
    bodyHex?: string
    bodyAscii?: string
  } | null
  files: Array<{ name: string; path: string; url: string; size: number | null }>
  deviceInfo: Insta360DeviceInfo | null
  summary: string
}

export interface DeviceDebugOption {
  id: string
  name: string
  defaultHost: string
  controlPort: number
  needsAuth: boolean
  protocolType: string
}
