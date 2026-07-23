import type { Socket } from 'node:net'

import type { CameraDeleteResult } from '../src/shared/types'
import type { Insta360TcpDeviceInfo } from './insta360DeviceInfo'
import { loadLunaProtocolCore } from './lunaProtocolCore'

export interface Insta360RawResponse {
  code: number
  kind: number
  requestId: number
  flags: number
  body: Buffer
  trailer: Buffer
}

export interface Insta360TcpSession {
  readonly isOpen: boolean
  readonly info: Insta360TcpDeviceInfo | null
  open(): Promise<void>
  close(): void
  refresh(): Promise<void>
  sendCommand(code: number, body?: Buffer, timeoutMs?: number): Promise<Insta360RawResponse>
  listFilePaths(storagePath: string): Promise<string[]>
  deleteFilePaths(cameraPaths: string[]): Promise<CameraDeleteResult>
}

interface Insta360TcpSessionConstructor {
  new(host: string, port: number): Insta360TcpSession
}

interface LunaProtocolCore {
  Insta360TcpSession: Insta360TcpSessionConstructor
  connectSocket(host: string, port: number, timeoutMs: number, localAddress?: string): Promise<Socket>
  insta360PacketChecksum(frameWithoutTrailer: Buffer): number
  buildDeleteFilesBody(cameraPaths: string[]): Buffer
  buildKeepAliveOptionsBody(): Buffer
}

const core = loadLunaProtocolCore() as unknown as LunaProtocolCore

export const Insta360TcpSession = core.Insta360TcpSession
export const connectSocket = core.connectSocket
export const insta360PacketChecksum = core.insta360PacketChecksum
export const buildDeleteFilesBody = core.buildDeleteFilesBody
export const buildKeepAliveOptionsBody = core.buildKeepAliveOptionsBody
