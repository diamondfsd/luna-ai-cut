import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { join } from 'node:path'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { IosDeviceDiscovery, type IosDeviceDiscoveryResult } from './iosDeviceDiscovery'
import {
  consumeFrames,
  encodeControlFrame,
  idleUsbStatus,
  type LiveMediaReceiver,
  type UsbAoaStatus,
  type UsbControlRequest,
  type UsbMediaFrame,
} from './usbAoaReceiver'

const DEVICE_PORT = 4184
const PROXY_HOST = process.env.USB_VIDEO_IOS_PROXY_HOST ?? '127.0.0.1'
const PROXY_PORT = Number(process.env.USB_VIDEO_IOS_PROXY_PORT ?? 4185)
const PROXY_ENABLED = process.env.USB_VIDEO_IOS_PROXY !== '0'
const CONNECT_RETRY_MS = 1_500
const CONNECTION_TIMEOUT_MS = 10_000
const DETECTION_UNAVAILABLE_MESSAGE = 'iPhone USB 检测不可用'

function proxyBinary(): string | null {
  const configured = process.env.USB_VIDEO_IPROXY_BIN
  const resourcesPath = process.resourcesPath
  const bundled = process.platform === 'win32' && resourcesPath
    ? join(resourcesPath, 'ios-usb', 'iproxy.exe')
    : null
  const candidates = [
    configured,
    bundled,
    ...(process.platform === 'win32' ? [join(process.cwd(), 'resources', 'ios-usb', 'win-x64', 'iproxy.exe')] : []),
    '/opt/homebrew/bin/iproxy',
    '/usr/local/bin/iproxy',
    '/usr/bin/iproxy',
    ...(process.platform === 'win32' ? ['iproxy.exe'] : []),
    'iproxy',
  ].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => candidate === 'iproxy' || candidate === 'iproxy.exe' || existsSync(candidate)) ?? null
}

export class IosTcpReceiver implements LiveMediaReceiver {
  private readonly onFrame: (frame: UsbMediaFrame) => void
  private readonly onDisconnected: () => void
  private phoneConnected = false
  private readonly deviceDiscovery = new IosDeviceDiscovery()
  private statusValue: UsbAoaStatus = idleUsbStatus('iOS USB 接收器未启动', 'ios-tcp')
  private iosDeviceCount = 0
  private running = false
  private proxy: ChildProcess | null = null
  private socket: Socket | null = null
  private connecting = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private connectionTimer: NodeJS.Timeout | null = null
  private pending = Buffer.alloc(0)
  private controlSequence = 0

  constructor(onFrame: (frame: UsbMediaFrame) => void, onDisconnected: () => void = () => {}) {
    this.onFrame = onFrame
    this.onDisconnected = onDisconnected
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
    this.deviceDiscovery.start((result) => this.applyDeviceDiscovery(result))
    this.startProxy()
  }

  async stop(): Promise<void> {
    this.running = false
    this.phoneConnected = false
    this.deviceDiscovery.stop()
    this.iosDeviceCount = 0
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.connecting = false
    this.pending = Buffer.alloc(0)
    this.closeSocket()
    const proxy = this.proxy
    this.proxy = null
    if (proxy && !proxy.killed) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          proxy.off('close', finish)
          resolve()
        }
        const timer = setTimeout(() => {
          proxy.kill('SIGKILL')
          finish()
        }, 1_000)
        proxy.once('close', finish)
        proxy.kill('SIGTERM')
      })
    }
    this.statusValue = idleUsbStatus('iOS USB 接收器已停止', 'ios-tcp')
  }

  async sendControl(request: UsbControlRequest): Promise<void> {
    const socket = this.socket
    if (!this.running || !this.statusValue.controlReady || !socket || socket.destroyed || !socket.writable) {
      throw new Error('iPhone 尚未连接')
    }
    await this.writeControl(socket, request)
  }

  private async writeControl(socket: Socket, request: UsbControlRequest): Promise<void> {
    const frame = encodeControlFrame(request, this.controlSequence)
    this.controlSequence = (this.controlSequence + 1) & 0xff
    await new Promise<void>((resolve, reject) => {
      socket.write(Uint8Array.from(frame), (error) => error ? reject(error) : resolve())
    })
  }

  private startProxy(): void {
    if (!this.running || this.proxy) return
    const binary = proxyBinary()
    if (!binary) {
      this.setStatus('waiting', '无法连接 iPhone', '连接工具不可用')
      this.scheduleConnect(CONNECT_RETRY_MS)
      return
    }
    try {
      const proxy = spawn(binary, [`${PROXY_PORT}:${DEVICE_PORT}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.proxy = proxy
      proxy.once('spawn', () => {
        if (this.running && this.proxy === proxy) this.scheduleConnect(0)
      })
      proxy.stdout.on('data', (chunk) => logMainInfo('[iOS USB] iproxy', { output: String(chunk).trim() }))
      proxy.stderr.on('data', (chunk) => logMainWarn('[iOS USB] iproxy', { output: String(chunk).trim() }))
      proxy.once('error', (error) => {
        logMainWarn('[iOS USB] 转发启动失败', { error: error.message })
        this.handleProxyExit(proxy, '无法启动 iPhone 连接')
      })
      proxy.once('exit', (code, signal) => {
        logMainInfo('[iOS USB] 转发已退出', { code, signal })
        this.handleProxyExit(proxy, null)
      })
      logMainInfo('[iOS USB] 已启动 iproxy', { binary, port: PROXY_PORT, devicePort: DEVICE_PORT })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logMainWarn('[iOS USB] 转发启动失败', { error: message })
      this.setStatus('waiting', '无法连接 iPhone', '无法启动 iPhone 连接')
      this.scheduleConnect(CONNECT_RETRY_MS)
    }
  }

  private handleProxyExit(proxy: ChildProcess, error: string | null): void {
    if (this.proxy !== proxy || !this.running) return
    this.notifyDisconnected()
    this.proxy = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.closeSocket()
    this.setStatus('waiting', '等待 iOS 设备通过 USB 连接', error)
    this.scheduleConnect(CONNECT_RETRY_MS)
  }

  private scheduleConnect(delayMs: number): void {
    if (!this.running || this.socket || this.connecting || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.proxy) this.startProxy()
      else this.connect()
    }, delayMs)
  }

  private connect(): void {
    if (!this.running || this.socket || this.connecting) return
    this.connecting = true
    const socket = createConnection({ host: PROXY_HOST, port: PROXY_PORT })
    this.socket = socket
    this.pending = Buffer.alloc(0)
    const isCurrent = () => this.running && this.socket === socket && !socket.destroyed
    this.connectionTimer = setTimeout(() => {
      if (!isCurrent()) return
      this.closeSocket()
      this.setStatus('waiting', '等待 iPhone 画面', null)
      this.scheduleConnect(CONNECT_RETRY_MS)
    }, CONNECTION_TIMEOUT_MS)

    socket.once('connect', () => {
      if (!isCurrent()) return
      this.connecting = false
      void this.writeControl(socket, {
        version: 1,
        requestId: randomUUID(),
        delivery: 'transactional',
        type: 'capabilities.get',
      }).catch((error: unknown) => {
        if (!isCurrent()) return
        logMainWarn('[iOS USB] 连接确认失败', { error: String(error) })
        this.closeSocket()
        this.setStatus('waiting', '等待 iOS 设备通过 USB 连接', null)
        this.scheduleConnect(CONNECT_RETRY_MS)
      })
    })
    socket.on('data', (chunk) => {
      if (!isCurrent()) return
      const received = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      this.pending = consumeFrames(
        Buffer.concat([this.pending, received]),
        (frame) => {
          if (!isCurrent()) return
          if (this.connectionTimer) clearTimeout(this.connectionTimer)
          this.connectionTimer = null
          this.handleFrame(frame)
        },
        (reason) => logMainWarn(`[iOS USB] 丢弃无效 UCD2 帧：${reason}`),
      )
    })
    socket.once('error', (error) => {
      if (!this.running || this.socket !== socket) return
      this.notifyDisconnected()
      logMainWarn('[iOS USB] 连接失败', { error: error.message })
      this.closeSocket()
      this.setStatus('waiting', '等待 iOS 设备通过 USB 连接', null)
      this.scheduleConnect(CONNECT_RETRY_MS)
    })
    socket.once('close', () => {
      if (!this.running || this.socket !== socket) return
      this.notifyDisconnected()
      this.closeSocket()
      this.setStatus('waiting', '等待 iOS 设备通过 USB 连接', null)
      this.scheduleConnect(CONNECT_RETRY_MS)
    })
  }

  private closeSocket(): void {
    if (this.connectionTimer) clearTimeout(this.connectionTimer)
    this.connectionTimer = null
    this.connecting = false
    const socket = this.socket
    this.socket = null
    this.pending = Buffer.alloc(0)
    if (socket && !socket.destroyed) socket.destroy()
  }

  private applyDeviceDiscovery(result: IosDeviceDiscoveryResult): void {
    if (result.state === 'none') this.notifyDisconnected()
    this.iosDeviceCount = result.state === 'detected' ? result.deviceCount : 0
    const connected = this.statusValue.state === 'connected' || this.statusValue.state === 'streaming'
    const detected = this.iosDeviceCount > 0
    const unavailable = result.state === 'unavailable' && !connected
    this.statusValue = {
      ...this.statusValue,
      deviceLabel: connected ? this.statusValue.deviceLabel : detected ? 'iPhone USB' : null,
      vendorId: connected ? this.statusValue.vendorId : detected ? 0x05ac : null,
      productId: connected ? this.statusValue.productId : null,
      deviceDetectionUnavailable: unavailable,
      message: connected || this.statusValue.error
        ? this.statusValue.message
        : detected ? '请打开Luna咔，并且用手机连接上相机设备'
          : unavailable ? DETECTION_UNAVAILABLE_MESSAGE
            : '等待 iOS 设备通过 USB 连接',
    }
  }

  private handleFrame(frame: UsbMediaFrame): void {
    this.phoneConnected = true
    const receivedAt = new Date().toISOString()
    const isVideo = frame.streamType === 0x20
    this.statusValue = {
      ...this.statusValue,
      state: isVideo || this.statusValue.state === 'streaming' ? 'streaming' : 'connected',
      transport: 'ios-tcp',
      deviceLabel: 'Luna iPhone USB',
      vendorId: 0x05ac,
      message: isVideo ? '正在接收 iPhone USB 视频流' : '正在接收 iPhone USB 控制数据',
      frames: this.statusValue.frames + 1,
      bytes: this.statusValue.bytes + frame.raw.length,
      lastFrameAt: receivedAt,
      videoFrames: this.statusValue.videoFrames + (isVideo ? 1 : 0),
      videoBytes: this.statusValue.videoBytes + (isVideo ? frame.raw.length : 0),
      lastVideoFrameAt: isVideo ? receivedAt : this.statusValue.lastVideoFrameAt,
      controlReady: true,
      error: null,
    }
    this.onFrame(frame)
  }

  private notifyDisconnected(): void {
    if (!this.phoneConnected) return
    this.phoneConnected = false
    this.onDisconnected()
  }

  private setStatus(state: UsbAoaStatus['state'], message: string, error: string | null): void {
    this.statusValue = {
      ...this.statusValue,
      state,
      transport: 'ios-tcp',
      message: state === 'waiting' && this.iosDeviceCount > 0 && !error
        ? '请打开Luna咔，并且用手机连接上相机设备'
        : state === 'waiting' && this.statusValue.deviceDetectionUnavailable && !error
          ? DETECTION_UNAVAILABLE_MESSAGE
          : message,
      deviceLabel: state === 'idle' ? null : this.iosDeviceCount > 0 ? 'iPhone USB' : this.statusValue.deviceLabel,
      vendorId: state === 'idle' ? null : this.iosDeviceCount > 0 ? 0x05ac : this.statusValue.vendorId,
      deviceDetectionUnavailable: state === 'idle' ? false : this.statusValue.deviceDetectionUnavailable,
      controlReady: state === 'connected' || state === 'streaming',
      error,
    }
  }
}
