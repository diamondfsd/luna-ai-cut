import usb from 'usb'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

const ACCESSORY_VID = 0x18d1
const ACCESSORY_PIDS = new Set([0x2d00, 0x2d01, 0x2d04, 0x2d05, 0x2d06, 0x2d07])
const MAGIC = Buffer.from([0x55, 0x43, 0x44, 0x32])
const MAX_FRAME_BYTES = 32 * 1024 * 1024
const TRANSFER_SIZE = 16 * 1024
const SCAN_INTERVAL_MS = 1_000
const LIBUSB_TRANSFER_TYPE_BULK = 2

const KNOWN_ANDROID_VENDOR_IDS = new Set([
  0x04e8, // Samsung
  0x05c6, // Qualcomm
  0x0bb4, // HTC
  0x0fce, // Sony
  0x12d1, // Huawei
  0x18d1, // Google
  0x19d2, // ZTE
  0x1ebf, // Sony
  0x22d9, // Oppo
  0x2717, // Xiaomi
  0x2a70, // OnePlus
  0x2d95, // Vivo
])

export type UsbAoaState = 'idle' | 'waiting' | 'switching' | 'connected' | 'streaming' | 'error'

export interface UsbAoaStatus {
  state: UsbAoaState
  message: string
  deviceLabel: string | null
  vendorId: number | null
  productId: number | null
  frames: number
  bytes: number
  lastFrameAt: string | null
  error: string | null
}

interface ActiveAccessory {
  device: usb.Device
  interfaceInfo: usb.Interface
  inEndpoint: usb.InEndpoint
  generation: number
}

interface ParsedMediaFrame {
  status: 'incomplete' | 'invalid' | 'unsupported' | 'ok'
  totalLength?: number
  reason?: string
  hevc?: Buffer
}

function parseMediaFrame(frame: Buffer): ParsedMediaFrame {
  if (frame.length < 12) return { status: 'incomplete' }
  if (!frame.subarray(0, 4).equals(MAGIC)) return { status: 'invalid', reason: 'magic' }

  const rawLength = frame.readUInt32LE(8)
  const totalLength = 12 + rawLength + 4
  if (rawLength < 9 || totalLength > MAX_FRAME_BYTES) {
    return { status: 'invalid', reason: 'length' }
  }
  if (frame.length < totalLength) return { status: 'incomplete' }
  if (frame[6] !== 0x01) return { status: 'unsupported', totalLength, reason: 'media-type' }

  const payload = frame.subarray(12, 12 + rawLength)
  if (payload[0] !== 0x20) {
    return { status: 'unsupported', totalLength, reason: 'stream-type' }
  }
  return { status: 'ok', totalLength, hevc: payload.subarray(9) }
}

function consumeFrames(pending: Buffer, onFrame: (frame: Buffer) => void, onInvalid: (reason: string) => void): Buffer {
  let buffer = pending
  while (buffer.length > 0) {
    const magicAt = buffer.indexOf(MAGIC)
    if (magicAt < 0) return buffer.subarray(Math.max(0, buffer.length - MAGIC.length + 1))
    if (magicAt > 0) buffer = buffer.subarray(magicAt)

    const parsed = parseMediaFrame(buffer)
    if (parsed.status === 'incomplete') return buffer
    if (parsed.status !== 'ok' || !parsed.hevc || parsed.totalLength == null) {
      if (parsed.status === 'invalid') onInvalid(parsed.reason ?? 'unknown')
      buffer = buffer.subarray(parsed.totalLength ?? MAGIC.length)
      continue
    }

    onFrame(buffer.subarray(0, parsed.totalLength))
    buffer = buffer.subarray(parsed.totalLength)
  }
  return buffer
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function controlTransfer(
  device: usb.Device,
  bmRequestType: number,
  bRequest: number,
  wValue: number,
  wIndex: number,
  dataOrLength: number | Buffer,
): Promise<Buffer | number | undefined> {
  return new Promise((resolve, reject) => {
    device.controlTransfer(
      bmRequestType,
      bRequest,
      wValue,
      wIndex,
      dataOrLength,
      (error, data) => error ? reject(error) : resolve(data),
    )
  })
}

function configuredVendorIds(): Set<number> | null {
  const raw = process.env.LUNA_AOA_VENDOR_IDS
  if (!raw) return null
  const values = raw.split(',')
    .map((entry) => Number.parseInt(entry.trim().replace(/^0x/i, ''), 16))
    .filter((value) => Number.isInteger(value) && value > 0)
  return values.length > 0 ? new Set(values) : null
}

export class UsbAoaReceiver {
  private readonly onFrame: (frame: Buffer) => void
  private session: ActiveAccessory | null = null
  private generation = 0
  private running = false
  private scanning = false
  private scanTimer: NodeJS.Timeout | null = null
  private pending = Buffer.alloc(0)
  private statusValue: UsbAoaStatus = {
    state: 'idle',
    message: 'USB AOA 接收器未启动',
    deviceLabel: null,
    vendorId: null,
    productId: null,
    frames: 0,
    bytes: 0,
    lastFrameAt: null,
    error: null,
  }

  constructor(onFrame: (frame: Buffer) => void) {
    this.onFrame = onFrame
  }

  status(): UsbAoaStatus {
    return { ...this.statusValue }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.statusValue = {
      ...this.statusValue,
      state: 'waiting',
      message: '等待 Android 手机通过 USB 连接',
      error: null,
    }
    usb.usb.on('attach', this.handleAttach)
    usb.usb.on('detach', this.handleDetach)
    this.scanTimer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS)
    void this.scan()
  }

  async stop(): Promise<void> {
    this.running = false
    this.generation += 1
    usb.usb.off('attach', this.handleAttach)
    usb.usb.off('detach', this.handleDetach)
    if (this.scanTimer) clearInterval(this.scanTimer)
    this.scanTimer = null
    await this.disconnectAccessory('stopped')
    this.statusValue = {
      ...this.statusValue,
      state: 'idle',
      message: 'USB AOA 接收器已停止',
      deviceLabel: null,
      vendorId: null,
      productId: null,
      error: null,
    }
  }

  private readonly handleAttach = (): void => {
    logMainInfo('[USB AOA] 检测到 USB 设备接入')
    void this.scan()
  }

  private readonly handleDetach = (): void => {
    logMainWarn('[USB AOA] USB 设备已断开')
    void this.disconnectAccessory('detached')
  }

  private isAccessoryDevice(device: usb.Device): boolean {
    const { idVendor, idProduct } = device.deviceDescriptor
    return idVendor === ACCESSORY_VID && ACCESSORY_PIDS.has(idProduct)
  }

  private findAccessory(): usb.Device | undefined {
    return usb.getDeviceList().find((device) => this.isAccessoryDevice(device))
  }

  private findAndroidDevice(): usb.Device | undefined {
    const configured = configuredVendorIds()
    return usb.getDeviceList().find((device) => {
      const { idVendor, idProduct } = device.deviceDescriptor
      if (this.isAccessoryDevice(device)) return false
      if (idVendor === 0x1d6b || idVendor === 0x05ac) return false
      if (idProduct === 0) return false
      return configured ? configured.has(idVendor) : KNOWN_ANDROID_VENDOR_IDS.has(idVendor)
    })
  }

  private async scan(): Promise<void> {
    if (!this.running || this.scanning || this.session) return
    this.scanning = true
    try {
      const accessory = this.findAccessory()
      if (accessory) {
        await this.connectAccessory(accessory)
        return
      }

      const android = this.findAndroidDevice()
      if (!android) {
        if (this.statusValue.state !== 'waiting') {
          this.setStatus('waiting', '等待 Android 手机通过 USB 连接')
        }
        return
      }

      this.setStatus('switching', '正在将手机切换为 USB Accessory 模式')
      logMainInfo('[USB AOA] 切换 Android AOA', {
        vendorId: android.deviceDescriptor.idVendor,
        productId: android.deviceDescriptor.idProduct,
      })
      await this.switchToAccessory(android)
      const accessoryAfterSwitch = await this.waitForAccessory(5_000)
      if (accessoryAfterSwitch) await this.connectAccessory(accessoryAfterSwitch)
    } catch (error) {
      this.fail(error)
    } finally {
      this.scanning = false
    }
  }

  private async switchToAccessory(device: usb.Device): Promise<void> {
    device.open()
    try {
      const protocol = await controlTransfer(device, 0xc0, 51, 0, 0, 2)
      const version = Buffer.isBuffer(protocol) ? protocol.readUInt16LE(0) : 0
      logMainInfo(`[USB AOA] 手机支持 AOA protocol ${version}`)

      const strings = [
        'LunaKa',
        'Luna USB Video Demo',
        '1.0',
        'Luna USB video output',
        'https://motionbridge.local/usb-video',
        'LunaKa',
      ]
      for (let index = 0; index < strings.length; index += 1) {
        await controlTransfer(device, 0x40, 52, 0, index, Buffer.from(`${strings[index]}\0`, 'utf8'))
      }
      await controlTransfer(device, 0x40, 53, 0, 0, Buffer.alloc(0))
    } finally {
      try {
        device.close()
      } catch {
        // Device may already be re-enumerating.
      }
    }
  }

  private async waitForAccessory(timeoutMs: number): Promise<usb.Device | null> {
    const startedAt = Date.now()
    while (this.running && Date.now() - startedAt < timeoutMs) {
      const accessory = this.findAccessory()
      if (accessory) return accessory
      await delay(150)
    }
    return null
  }

  private async connectAccessory(device: usb.Device): Promise<void> {
    const generation = ++this.generation
    device.open()
    const interfaceInfo = device.interfaces?.find((item) =>
      item.endpoints.some((endpoint) => endpoint.transferType === LIBUSB_TRANSFER_TYPE_BULK),
    )
    if (!interfaceInfo) throw new Error('未找到 USB AOA Bulk 接口')

    interfaceInfo.claim()
    const inEndpoint = interfaceInfo.endpoints.find((endpoint) =>
      endpoint.direction === 'in' && endpoint.transferType === LIBUSB_TRANSFER_TYPE_BULK,
    ) as usb.InEndpoint | undefined
    if (!inEndpoint) throw new Error('USB AOA 缺少视频输入端点')

    this.pending = Buffer.alloc(0)
    this.session = { device, interfaceInfo, inEndpoint, generation }
    this.statusValue = {
      ...this.statusValue,
      state: 'connected',
      message: '手机 USB 已连接，等待视频帧',
      deviceLabel: 'Luna 手机 USB AOA',
      vendorId: device.deviceDescriptor.idVendor,
      productId: device.deviceDescriptor.idProduct,
      error: null,
    }
    logMainInfo('[USB AOA] Bulk 端点已打开')
    this.readNext()
  }

  private readNext(): void {
    const session = this.session
    if (!this.running || !session) return
    session.inEndpoint.transfer(TRANSFER_SIZE, (error, data) => {
      if (!this.running || this.session !== session || session.generation !== this.generation) return
      if (error) {
        this.fail(error)
        return
      }
      if (data && data.length > 0) {
        this.pending = consumeFrames(
          Buffer.concat([this.pending, data]),
          (frame) => this.handleFrame(frame),
          (reason) => logMainWarn(`[USB AOA] 丢弃无效 UCD2 帧：${reason}`),
        )
      }
      this.readNext()
    })
  }

  private handleFrame(frame: Buffer): void {
    this.statusValue = {
      ...this.statusValue,
      state: 'streaming',
      message: '正在接收手机 USB 视频流',
      frames: this.statusValue.frames + 1,
      bytes: this.statusValue.bytes + frame.length,
      lastFrameAt: new Date().toISOString(),
      error: null,
    }
    this.onFrame(frame)
  }

  private async disconnectAccessory(reason: 'stopped' | 'detached'): Promise<void> {
    ++this.generation
    const session = this.session
    this.session = null
    this.pending = Buffer.alloc(0)
    if (session) {
      await new Promise<void>((resolve) => {
        try {
          session.interfaceInfo.release(true, () => resolve())
        } catch {
          resolve()
        }
      })
      try {
        session.device.close()
      } catch {
        // Device may already be gone.
      }
    }
    if (reason === 'detached' && this.running && this.statusValue.state !== 'error') {
      this.statusValue = {
        ...this.statusValue,
        state: 'waiting',
        message: '手机 USB 已断开，等待重新连接',
        deviceLabel: null,
        vendorId: null,
        productId: null,
      }
    }
  }

  private fail(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    logMainWarn('[USB AOA] 接收失败', { error: detail })
    this.statusValue = {
      ...this.statusValue,
      state: 'error',
      message: 'USB AOA 接收失败',
      error: detail,
    }
    void this.disconnectAccessory('detached')
  }

  private setStatus(state: UsbAoaState, message: string): void {
    this.statusValue = { ...this.statusValue, state, message, error: null }
  }
}
