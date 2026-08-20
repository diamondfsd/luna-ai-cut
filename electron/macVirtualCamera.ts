import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import type { CameraBridgeFrame } from '../src/shared/types'

const FRAME_PORT = 49998
export const VIRTUAL_CAMERA_FRAME_HEADER_BYTES = 24
export const VIRTUAL_CAMERA_FRAME_MAGIC = Buffer.from('LVCF', 'ascii')
const VIDEO_CONFIG_TYPE = 2
const VIDEO_TYPE = 3
const KEYFRAME_FLAG = 1

export type MacVirtualCameraStatus = {
  supported: boolean
  state: 'unsupported' | 'stopped' | 'starting' | 'running' | 'error'
  deviceName: string
  frames: number
  error: string | null
}

const EMPTY_STATUS: MacVirtualCameraStatus = {
  supported: process.platform === 'darwin',
  state: process.platform === 'darwin' ? 'stopped' : 'unsupported',
  deviceName: 'Luna Camera',
  frames: 0,
  error: null,
}

type StatusListener = (status: MacVirtualCameraStatus) => void

export function encodeVirtualCameraFrame(frame: CameraBridgeFrame): Buffer {
  const header = Buffer.alloc(VIRTUAL_CAMERA_FRAME_HEADER_BYTES)
  VIRTUAL_CAMERA_FRAME_MAGIC.copy(header, 0)
  header.writeUInt8(1, 4)
  header.writeUInt8(frame.type, 5)
  header.writeUInt16LE(frame.flags, 6)
  header.writeBigUInt64LE(BigInt(frame.timestampUs), 8)
  header.writeUInt32LE(frame.sequence, 16)
  header.writeUInt32LE(frame.payload.byteLength, 20)
  return Buffer.concat([header, Buffer.from(frame.payload)])
}

class MacVirtualCamera {
  private status: MacVirtualCameraStatus = { ...EMPTY_STATUS }
  private child: ChildProcessWithoutNullStreams | null = null
  private socket: net.Socket | null = null
  private listeners = new Set<StatusListener>()
  private stopping = false
  private activationOutput: string[] = []

  getStatus(): MacVirtualCameraStatus { return this.status }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<MacVirtualCameraStatus> {
    if (process.platform !== 'darwin') return this.update({ state: 'unsupported', error: '虚拟摄像头当前只支持 macOS' })
    if (this.status.state === 'running' || this.status.state === 'starting') return this.status

    this.stopping = false
    this.activationOutput = []
    this.update({ state: 'starting', error: null, frames: 0 })
    const executable = resolveExecutable()
    if (!existsSync(executable)) {
      return this.update({ state: 'error', error: `开发模式原生组件不存在，请先运行 pnpm run build:camera-bridge:mac` })
    }

    try {
      this.child = spawn(executable, ['--activate'], { stdio: 'pipe' })
      this.child.stdout.on('data', (chunk: Buffer) => this.recordActivationOutput(chunk, false))
      this.child.stderr.on('data', (chunk: Buffer) => this.recordActivationOutput(chunk, true))
      this.child.once('error', (error) => {
        if (!this.stopping) this.update({ state: 'error', error: `虚拟摄像头进程启动失败：${error.message}` })
      })
      this.child.once('exit', (code, signal) => {
        if (!this.stopping && code !== 0) {
          this.update({
            state: 'error',
            error: this.activationOutput.join(' ') || `虚拟摄像头激活失败 (${code ?? signal ?? 'unknown'})`,
          })
        }
      })
      this.socket = await connectWithRetry(FRAME_PORT, () => !this.stopping && this.status.state !== 'error')
      this.socket.setNoDelay(true)
      this.socket.on('close', () => {
        if (!this.stopping) this.update({ state: 'error', error: '虚拟摄像头帧通道已断开' })
      })
      this.update({ state: 'running', error: null })
    } catch (error) {
      const activationError = this.status.error
      await this.stop()
      return this.update({ state: 'error', error: activationError ?? (error instanceof Error ? error.message : String(error)) })
    }
    return this.status
  }

  async stop(): Promise<MacVirtualCameraStatus> {
    this.stopping = true
    this.socket?.destroy()
    this.socket = null
    const child = this.child
    this.child = null
    if (child && child.exitCode === null) child.kill('SIGTERM')
    this.update({ state: process.platform === 'darwin' ? 'stopped' : 'unsupported', error: null })
    return this.status
  }

  writeFrame(frame: CameraBridgeFrame): void {
    const socket = this.socket
    if (!socket || !socket.writable || this.status.state !== 'running') return
    if (!socket.writableNeedDrain && (frame.type === VIDEO_CONFIG_TYPE || (frame.flags & KEYFRAME_FLAG) !== 0 || socket.bufferSize < 4 * 1024 * 1024)) {
      socket.write(encodeVirtualCameraFrame(frame))
      if (frame.type === VIDEO_TYPE) this.update({ frames: this.status.frames + 1 })
    }
  }

  private update(patch: Partial<MacVirtualCameraStatus>): MacVirtualCameraStatus {
    this.status = { ...this.status, ...patch }
    for (const listener of this.listeners) listener(this.status)
    return this.status
  }

  private recordActivationOutput(chunk: Buffer, isError: boolean): void {
    const message = chunk.toString().trim()
    if (!message) return
    this.activationOutput.push(message)
    if (isError) console.warn(`[camera-extension] ${message}`)
    else console.info(`[camera-extension] ${message}`)
    this.update({ error: message })
  }
}

function resolveExecutable(): string {
  const installedHost = '/Applications/Luna Camera Development Host.app/Contents/MacOS/LunaCameraDevHost'
  if (existsSync(installedHost)) return installedHost
  const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..')
  return path.join(appRoot, 'native', 'macos', 'LunaCameraExtension', 'build', 'LunaCameraDevHost.app', 'Contents', 'MacOS', 'LunaCameraDevHost')
}

function connectWithRetry(port: number, canRetry: () => boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const connect = (): void => {
      if (!canRetry() || attempts >= 300) {
        reject(new Error('无法连接 macOS 虚拟摄像头原生服务'))
        return
      }
      attempts += 1
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const retry = (): void => {
        socket.destroy()
        setTimeout(connect, 100)
      }
      socket.once('connect', () => resolve(socket))
      socket.once('error', retry)
    }
    connect()
  })
}

export const macVirtualCamera = new MacVirtualCamera()
