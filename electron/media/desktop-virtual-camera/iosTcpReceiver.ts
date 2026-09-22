import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import {
  consumeFrames,
  encodeControlFrame,
  idleUsbStatus,
  type DesktopMediaReceiver,
  type UsbAoaStatus,
  type UsbControlRequest,
  type UsbMediaFrame,
} from './usbAoaReceiver'

const DEVICE_PORT = 4184
const PROXY_HOST = process.env.USB_VIDEO_IOS_PROXY_HOST ?? '127.0.0.1'
const PROXY_PORT = Number(process.env.USB_VIDEO_IOS_PROXY_PORT ?? 4185)
const PROXY_ENABLED = process.env.USB_VIDEO_IOS_PROXY !== '0'
const CONNECT_RETRY_MS = 1_500
const CONNECTION_CONFIRM_MS = 400

function proxyBinary(): string | null {
  const configured = process.env.USB_VIDEO_IPROXY_BIN
  const candidates = [
    configured,
    '/opt/homebrew/bin/iproxy',
    '/usr/local/bin/iproxy',
    '/usr/bin/iproxy',
    'iproxy',
  ].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => candidate === 'iproxy' || existsSync(candidate)) ?? null
}

export class IosTcpReceiver implements DesktopMediaReceiver {
  private readonly onFrame: (frame: UsbMediaFrame) => void
  private statusValue: UsbAoaStatus = idleUsbStatus('iOS USB 接收器未启动', 'ios-tcp')
  private running = false
  private proxy: ChildProcess | null = null
  private socket: Socket | null = null
  private connecting = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private pending = Buffer.alloc(0)
  private controlSequence = 0

  constructor(onFrame: (frame: UsbMediaFrame) => void) {
    this.onFrame = onFrame
  }

  status(): UsbAoaStatus {
    return { ...this.statusValue, transport: 'ios-tcp' }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.setStatus('waiting', '等待 iOS 设备通过 USB 连接', null)
    if (!PROXY_ENABLED) {
      this.setStatus('waiting', 'iOS USB 转发已禁用', null)
      return
    }
    this.startProxy()
    this.scheduleConnect(0)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.connecting = false
    this.pending = Buffer.alloc(0)
    this.closeSocket()
    const proxy = this.proxy
    this.proxy = null
    if (proxy && !proxy.killed) {
      proxy.kill('SIGTERM')
    }
    this.statusValue = idleUsbStatus('iOS USB 接收器已停止', 'ios-tcp')
  }

  async sendControl(request: UsbControlRequest): Promise<void> {
    const socket = this.socket
    if (!socket || socket.destroyed || !socket.writable) throw new Error('iOS USB 尚未连接')
    const frame = encodeControlFrame(request, this.controlSequence)
    this.controlSequence = (this.controlSequence + 1) & 0xff
    await new Promise<void>((resolve, reject) => {
      socket.write(Uint8Array.from(frame), (error) => error ? reject(error) : resolve())
    })
  }

  private startProxy(): void {
    if (this.proxy) return
    const binary = proxyBinary()
    if (!binary) {
      this.setStatus('waiting', '未找到 iproxy，暂时无法连接 iOS', '缺少 iproxy')
      return
    }
    try {
      const proxy = spawn(binary, [`${PROXY_PORT}:${DEVICE_PORT}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.proxy = proxy
      proxy.stdout.on('data', (chunk) => logMainInfo('[iOS USB] iproxy', { output: String(chunk).trim() }))
      proxy.stderr.on('data', (chunk) => logMainWarn('[iOS USB] iproxy', { output: String(chunk).trim() }))
      proxy.once('error', (error) => {
        if (this.proxy === proxy) this.proxy = null
        if (this.running) this.setStatus('waiting', '无法启动 iOS USB 转发', error.message)
      })
      proxy.once('exit', () => {
        if (this.proxy === proxy) this.proxy = null
        if (this.running) this.scheduleConnect(CONNECT_RETRY_MS)
      })
      logMainInfo('[iOS USB] 已启动 iproxy', { binary, port: PROXY_PORT, devicePort: DEVICE_PORT })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus('waiting', '无法启动 iOS USB 转发', message)
    }
  }

  private scheduleConnect(delayMs: number): void {
    if (!this.running || this.socket || this.connecting || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delayMs)
  }

  private connect(): void {
    if (!this.running || this.socket || this.connecting) return
    this.connecting = true
    let confirmed = false
    const socket = createConnection({ host: PROXY_HOST, port: PROXY_PORT })
    let confirmationTimer: NodeJS.Timeout | null = null

    const confirm = () => {
      if (confirmed || socket.destroyed || socket !== this.socket) return
      confirmed = true
      this.statusValue = {
        ...this.statusValue,
        state: 'connected',
        message: 'iPhone USB 通道已连接，等待音视频',
        deviceLabel: 'Luna iPhone USB',
        controlReady: true,
        error: null,
      }
    }

    socket.once('connect', () => {
      this.connecting = false
      this.socket = socket
      this.pending = Buffer.alloc(0)
      confirmationTimer = setTimeout(confirm, CONNECTION_CONFIRM_MS)
    })
    socket.on('data', (chunk) => {
      if (!confirmed) {
        if (confirmationTimer) clearTimeout(confirmationTimer)
        confirm()
      }
      const received = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      this.pending = consumeFrames(
        Buffer.concat([this.pending, received]),
        (frame) => this.handleFrame(frame),
        (reason) => logMainWarn(`[iOS USB] 丢弃无效 UCD2 帧：${reason}`),
      )
    })
    socket.once('error', (error) => {
      if (confirmationTimer) clearTimeout(confirmationTimer)
      this.connecting = false
      if (this.socket === socket) {
        this.closeSocket()
        this.setStatus('waiting', '等待 iOS 设备通过 USB 连接', error.message)
      }
      this.scheduleConnect(CONNECT_RETRY_MS)
    })
    socket.once('close', () => {
      if (confirmationTimer) clearTimeout(confirmationTimer)
      this.connecting = false
      if (this.socket === socket) this.closeSocket()
      if (this.running) {
        this.setStatus('waiting', '等待 iOS 设备通过 USB 连接', null)
        this.scheduleConnect(CONNECT_RETRY_MS)
      }
    })
  }

  private closeSocket(): void {
    const socket = this.socket
    this.socket = null
    this.pending = Buffer.alloc(0)
    if (socket && !socket.destroyed) socket.destroy()
  }

  private handleFrame(frame: UsbMediaFrame): void {
    const receivedAt = new Date().toISOString()
    const isVideo = frame.streamType === 0x20
    const isAudio = frame.streamType === 0x21
    this.statusValue = {
      ...this.statusValue,
      state: 'streaming',
      transport: 'ios-tcp',
      message: isAudio ? '正在接收 iPhone USB 音频流' : isVideo ? '正在接收 iPhone USB 视频流' : '正在接收 iPhone USB 数据',
      frames: this.statusValue.frames + 1,
      bytes: this.statusValue.bytes + frame.raw.length,
      lastFrameAt: receivedAt,
      videoFrames: this.statusValue.videoFrames + (isVideo ? 1 : 0),
      videoBytes: this.statusValue.videoBytes + (isVideo ? frame.raw.length : 0),
      lastVideoFrameAt: isVideo ? receivedAt : this.statusValue.lastVideoFrameAt,
      audioFrames: this.statusValue.audioFrames + (isAudio ? 1 : 0),
      audioBytes: this.statusValue.audioBytes + (isAudio ? frame.raw.length : 0),
      lastAudioFrameAt: isAudio ? receivedAt : this.statusValue.lastAudioFrameAt,
      audioSource: frame.audio?.source ?? this.statusValue.audioSource,
      audioSampleRate: frame.audio?.sampleRate ?? this.statusValue.audioSampleRate,
      audioChannels: frame.audio?.channels ?? this.statusValue.audioChannels,
      controlReady: true,
      error: null,
    }
    this.onFrame(frame)
  }

  private setStatus(state: UsbAoaStatus['state'], message: string, error: string | null): void {
    this.statusValue = {
      ...this.statusValue,
      state,
      transport: 'ios-tcp',
      message,
      controlReady: state === 'connected' || state === 'streaming',
      error,
    }
  }
}
