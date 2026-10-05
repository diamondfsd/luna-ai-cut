import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import type { AdbForward, RunAdb } from './androidAdbClient.ts'
import { consumeFrames, USB_STREAM_VIDEO, type UsbMediaFrame } from './usbAoaProtocol.ts'
import { encodeControlFrame, idleUsbStatus, type LiveMediaReceiver, type UsbAoaStatus, type UsbControlRequest } from './usbMediaReceiver.ts'

export interface ForwardReceiverDependencies {
  run: RunAdb
  connect: typeof createConnection
  log: (level: 'info' | 'warn', message: string, details?: unknown) => void
  retryMs: number
  handshakeMs: number
}


export interface ForwardDriver {
  transport: UsbAoaStatus['transport']
  label: string
  phoneLabel: string
  available: boolean
  run: RunAdb
  devices(run: RunAdb, signal?: AbortSignal): Promise<{ serial: string; state: string }[]>
  createForward(run: RunAdb, serial: string): Promise<AdbForward>
  removeForward(run: RunAdb, forward: AdbForward): Promise<void>
}

export class ForwardTcpReceiver implements LiveMediaReceiver {
  private readonly onFrame: (frame: UsbMediaFrame) => void
  private readonly onDisconnected: () => void
  private readonly dependencies: ForwardReceiverDependencies
  private readonly available: boolean
  private readonly driver: ForwardDriver
  private statusValue: UsbAoaStatus
  private running = false
  private generation = 0
  private controller: AbortController | null = null
  private task: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private handshakeTimer: NodeJS.Timeout | null = null
  private socket: Socket | null = null
  private forward: AdbForward | null = null
  private pending = Buffer.alloc(0)
  private sequence = 0
  private confirmed = false
  private lastDiagnostic = ''

  constructor(onFrame: (frame: UsbMediaFrame) => void, onDisconnected: () => void,
    driver: ForwardDriver, dependencies: Partial<ForwardReceiverDependencies> = {}) {
    this.driver = driver
    this.onFrame = onFrame
    this.onDisconnected = onDisconnected
    this.available = driver.available || Boolean(dependencies.run)
    this.statusValue = idleUsbStatus('手机连接未启动', driver.transport)
    this.dependencies = {
      run: driver.run, connect: createConnection, log: () => {}, retryMs: 2_000, handshakeMs: 10_000, ...dependencies,
    }
  }

  status(): UsbAoaStatus { return { ...this.statusValue } }

  start(): void {
    if (this.running) return
    this.running = true
    this.generation += 1
    this.controller = new AbortController()
    this.lastDiagnostic = ''
    this.setStatus('waiting', '请开启手机 USB 调试并连接电脑')
    this.dependencies.log('info', `[${this.driver.label}] 开始检测`, { available: this.available })
    this.scan()
  }

  async stop(): Promise<void> {
    this.running = false
    this.generation += 1
    this.controller?.abort()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.closeSocket(false)
    await this.task
    await this.releaseForward()
    this.statusValue = idleUsbStatus('手机连接已停止', this.driver.transport)
  }

  async sendControl(request: UsbControlRequest): Promise<void> {
    const socket = this.socket
    if (!this.running || !this.confirmed || !socket || socket.destroyed || !socket.writable) throw new Error('手机 USB 尚未连接')
    await this.writeControl(socket, request)
  }

  private async writeControl(socket: Socket, request: UsbControlRequest): Promise<void> {
    const frame = encodeControlFrame(request, this.sequence++)
    await new Promise<void>((resolve, reject) => socket.write(frame, (error) => error ? reject(error) : resolve()))
  }

  private scan(): void {
    if (!this.running || this.task) return
    const generation = this.generation
    const task = this.scanDevices(generation).catch((error: unknown) => {
      if (!this.running || generation !== this.generation) return
      this.diagnostic('检测失败', { error: error instanceof Error ? error.message : String(error) })
      this.closeSocket(true)
      this.setStatus('error', '无法连接手机，请检查 USB 调试和驱动', true)
    }).finally(() => {
      if (this.task === task) this.task = null
      if (this.running && generation === this.generation) this.timer = setTimeout(() => {
        this.timer = null
        this.scan()
      }, this.dependencies.retryMs)
    })
    this.task = task
  }

  private async scanDevices(generation: number): Promise<void> {
    if (!this.available) {
      this.setStatus('error', '手机连接工具缺失，请重新安装软件', true)
      return
    }
    const devices = await this.driver.devices(this.dependencies.run, this.controller?.signal)
    if (!this.running || generation !== this.generation) return
    const ready = devices.filter((device) => device.state === 'device')
    if (ready.length !== 1) {
      this.closeSocket(true)
      await this.releaseForward()
      this.statusValue.deviceLabel = devices.length ? this.driver.phoneLabel : null
      const message = ready.length > 1 ? `请只连接一台${this.driver.phoneLabel}`
        : devices.some((device) => device.state === 'unauthorized') ? '请在手机上允许 USB 调试'
          : devices.length ? '手机连接不可用，请重新连接' : '请开启手机 USB 调试并连接电脑'
      this.setStatus(devices.length ? 'error' : 'waiting', message, devices.length > 0)
      this.diagnostic('设备状态', { total: devices.length, authorized: ready.length, states: devices.map((device) => device.state) })
      return
    }
    const serial = ready[0].serial
    this.statusValue.deviceLabel = this.driver.phoneLabel
    // A driver restart or brief USB interruption can remove the forwarding rule
    // while the same phone remains visible. Never retry a failed socket against
    // a cached forwarding port: recreate our rule before connecting again.
    if (this.forward?.serial !== serial || !this.socket) {
      this.closeSocket(true)
      await this.releaseForward()
      if (!this.running || generation !== this.generation) return
      const forward = await this.driver.createForward(this.dependencies.run, serial)
      if (!this.running || generation !== this.generation) {
        await this.driver.removeForward(this.dependencies.run, forward)
        return
      }
      this.forward = forward
      this.dependencies.log('info', `[${this.driver.label}] 手机转发已建立`, { localPort: forward.port, devicePort: 4184 })
    }
    if (!this.socket && this.forward) this.connect(this.forward.port)
  }

  private connect(port: number): void {
    const socket = this.dependencies.connect({ host: '127.0.0.1', port })
    this.socket = socket
    this.pending = Buffer.alloc(0)
    this.setStatus('waiting', '请打开手机直播')
    const isCurrent = () => this.running && this.socket === socket && !socket.destroyed
    this.handshakeTimer = setTimeout(() => {
      if (!isCurrent()) return
      this.diagnostic('等待手机画面超时', { localPort: port })
      this.closeSocket(true)
      this.setStatus('waiting', '未收到手机画面，正在重连')
    }, this.dependencies.handshakeMs)
    socket.once('connect', () => {
      if (!isCurrent()) return
      this.setStatus('waiting', '等待手机画面')
      this.dependencies.log('info', `[${this.driver.label}] 手机推流端口已连接`, { localPort: port })
      void this.writeControl(socket, { version: 1, requestId: randomUUID(), delivery: 'transactional', type: 'capabilities.get' }).catch((error: unknown) => {
        if (!isCurrent()) return
        this.diagnostic('连接确认失败', { error: String(error) })
        this.closeSocket(true)
      })
    })
    socket.on('data', (chunk: Buffer) => {
      if (!isCurrent()) return
      this.pending = consumeFrames(Buffer.concat([this.pending, chunk]), (frame) => {
        if (!isCurrent()) return
        if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
        this.handshakeTimer = null
        const isVideo = frame.streamType === USB_STREAM_VIDEO
        if (!this.confirmed) this.dependencies.log('info', `[${this.driver.label}] 手机连接已确认`)
        this.confirmed = true
        const receivedAt = new Date().toISOString()
        const streaming = isVideo || this.statusValue.state === 'streaming'
        this.statusValue = {
          ...this.statusValue, state: streaming ? 'streaming' : 'connected', controlReady: true, error: null,
          message: streaming ? '正在接收手机视频' : '手机 USB 已连接，等待视频',
          frames: this.statusValue.frames + 1, bytes: this.statusValue.bytes + frame.raw.length, lastFrameAt: receivedAt,
          videoFrames: this.statusValue.videoFrames + Number(isVideo),
          videoBytes: this.statusValue.videoBytes + (isVideo ? frame.raw.length : 0),
          lastVideoFrameAt: isVideo ? receivedAt : this.statusValue.lastVideoFrameAt,
        }
        this.onFrame(frame)
      }, (reason) => this.diagnostic('收到无效媒体帧', { reason }))
    })
    socket.once('error', (error) => {
      if (!this.running || this.socket !== socket) return
      this.diagnostic('推流连接失败', { error: error.message })
      this.closeSocket(true)
      this.setStatus('waiting', '请打开手机直播')
    })
    socket.once('close', () => {
      if (!this.running || this.socket !== socket) return
      this.closeSocket(true)
      this.setStatus('waiting', '手机连接已断开')
    })
  }

  private closeSocket(notify: boolean): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = null
    const socket = this.socket
    this.socket = null
    this.pending = Buffer.alloc(0)
    this.statusValue.controlReady = false
    if (notify && this.confirmed) this.onDisconnected()
    this.confirmed = false
    socket?.destroy()
  }

  private async releaseForward(): Promise<void> {
    const forward = this.forward
    this.forward = null
    if (!forward) return
    try { await this.driver.removeForward(this.dependencies.run, forward) } catch (error) {
      this.dependencies.log('warn', `[${this.driver.label}] 清理转发失败`, { localPort: forward.port, error: String(error).split(forward.serial).join('<phone>') })
    }
  }

  private setStatus(state: UsbAoaStatus['state'], message: string, error = false): void {
    this.statusValue = { ...this.statusValue, state, message, error: error ? message : null, controlReady: this.confirmed }
  }

  private diagnostic(message: string, details: unknown): void {
    const key = JSON.stringify([message, details])
    if (key === this.lastDiagnostic) return
    this.lastDiagnostic = key
    this.dependencies.log('warn', `[${this.driver.label}] ${message}`, details)
  }
}
