import usb from 'usb'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import type { LiveStreamControlCommand } from '../../../src/shared/types'
import {
  consumeFrames,
  USB_STREAM_AUDIO,
  USB_STREAM_CONTROL_COMMAND,
  USB_STREAM_VIDEO,
  UCD2_MAGIC,
  type UsbMediaFrame,
} from './usbAoaProtocol'

export {
  consumeFrames,
  parseMediaFrame,
  USB_AUDIO_CODEC_PCM16_LE,
  USB_STREAM_AUDIO,
  USB_STREAM_CONTROL_COMMAND,
  USB_STREAM_CONTROL_RESULT,
  USB_STREAM_VIDEO,
} from './usbAoaProtocol'
export type { UsbAudioFrameInfo, UsbMediaFrame } from './usbAoaProtocol'

const ACCESSORY_VID = 0x18d1
const ACCESSORY_PIDS = new Set([0x2d00, 0x2d01, 0x2d04, 0x2d05, 0x2d06, 0x2d07])
const TRANSFER_SIZE = 16 * 1024
const SCAN_INTERVAL_MS = 1_000
const LIBUSB_TRANSFER_TYPE_BULK = 2

export type UsbControlRequest = LiveStreamControlCommand & {
  version: 1
  requestId: string
}

export interface LiveMediaReceiver {
  status(): UsbAoaStatus
  start(): void
  stop(): Promise<void>
  sendControl(request: UsbControlRequest): Promise<void>
}

export function idleUsbStatus(
  message: string,
  transport: UsbAoaStatus['transport'] = 'usb-aoa',
): UsbAoaStatus {
  return {
    state: 'idle',
    transport,
    message,
    deviceLabel: null,
    vendorId: null,
    productId: null,
    frames: 0,
    bytes: 0,
    lastFrameAt: null,
    videoFrames: 0,
    videoBytes: 0,
    lastVideoFrameAt: null,
    audioFrames: 0,
    audioBytes: 0,
    lastAudioFrameAt: null,
    audioSource: null,
    audioSampleRate: null,
    audioChannels: null,
    controlReady: false,
    error: null,
  }
}

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
  transport: 'usb-aoa' | 'ios-tcp'
  message: string
  deviceLabel: string | null
  vendorId: number | null
  productId: number | null
  frames: number
  bytes: number
  lastFrameAt: string | null
  videoFrames: number
  videoBytes: number
  lastVideoFrameAt: string | null
  audioFrames: number
  audioBytes: number
  lastAudioFrameAt: string | null
  audioSource: number | null
  audioSampleRate: number | null
  audioChannels: number | null
  controlReady: boolean
  error: string | null
}

interface ActiveAccessory {
  device: usb.Device
  interfaceInfo: usb.Interface
  inEndpoint: usb.InEndpoint
  outEndpoint: usb.OutEndpoint
  generation: number
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

export function encodeControlFrame(request: UsbControlRequest, sequence: number): Buffer {
  const body = Buffer.from(JSON.stringify(request), 'utf8')
  const payloadLength = 9 + body.length
  const frame = Buffer.alloc(12 + payloadLength + 4)
  UCD2_MAGIC.copy(frame, 0)
  frame[4] = 0x01
  frame[5] = 0x0c
  frame[6] = 0x01
  frame[7] = sequence & 0xff
  frame.writeUInt32LE(payloadLength, 8)
  frame[12] = USB_STREAM_CONTROL_COMMAND
  frame.writeBigUInt64LE(BigInt(Date.now()) * 1_000n, 13)
  body.copy(frame, 21)
  return frame
}

export class UsbAoaReceiver implements LiveMediaReceiver {
  private readonly onFrame: (frame: UsbMediaFrame) => void
  private session: ActiveAccessory | null = null
  private generation = 0
  private running = false
  private scanning = false
  private scanTimer: NodeJS.Timeout | null = null
  private pending = Buffer.alloc(0)
  private controlSequence = 0
  private controlWriteTail = Promise.resolve()
  private statusValue: UsbAoaStatus = idleUsbStatus('USB AOA 接收器未启动')

  constructor(onFrame: (frame: UsbMediaFrame) => void) {
    this.onFrame = onFrame
  }

  status(): UsbAoaStatus {
    return { ...this.statusValue }
  }

  sendControl(request: UsbControlRequest): Promise<void> {
    const session = this.session
    if (!session) throw new Error('手机 USB 尚未连接')
    const frame = encodeControlFrame(request, this.controlSequence)
    this.controlSequence = (this.controlSequence + 1) & 0xff
    const task = this.controlWriteTail
      .catch(() => undefined)
      .then(() => new Promise<void>((resolve, reject) => {
        if (this.session !== session) {
          reject(new Error('手机 USB 已断开'))
          return
        }
        session.outEndpoint.transfer(frame, (error) => error ? reject(error) : resolve())
      }))
    this.controlWriteTail = task.catch(() => undefined)
    return task
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
        'LunaKa', // manufacturer
        'Luna USB Video Demo', // model
        'Luna USB video output', // description
        '1.0', // version
        'https://motionbridge.local/usb-video', // uri
        'LunaKa', // serial
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
    const outEndpoint = interfaceInfo.endpoints.find((endpoint) =>
      endpoint.direction === 'out' && endpoint.transferType === LIBUSB_TRANSFER_TYPE_BULK,
    ) as usb.OutEndpoint | undefined
    if (!outEndpoint) throw new Error('USB AOA 缺少控制输出端点')
    outEndpoint.timeout = 1_000

    this.pending = Buffer.alloc(0)
    this.controlWriteTail = Promise.resolve()
    this.session = { device, interfaceInfo, inEndpoint, outEndpoint, generation }
    this.statusValue = {
      ...this.statusValue,
      state: 'connected',
      message: '手机 USB 已连接，等待视频帧',
      deviceLabel: 'Luna 手机 USB AOA',
      vendorId: device.deviceDescriptor.idVendor,
      productId: device.deviceDescriptor.idProduct,
      controlReady: true,
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

  private handleFrame(frame: UsbMediaFrame): void {
    const receivedAt = new Date().toISOString()
    const isVideo = frame.streamType === USB_STREAM_VIDEO
    const isAudio = frame.streamType === USB_STREAM_AUDIO
    const streamLabel = isAudio ? '音频' : isVideo ? '视频' : '媒体'
    this.statusValue = {
      ...this.statusValue,
      state: 'streaming',
      message: `正在接收手机 USB ${streamLabel}流`,
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
      error: null,
    }
    this.onFrame(frame)
  }

  private async disconnectAccessory(reason: 'stopped' | 'detached'): Promise<void> {
    ++this.generation
    const session = this.session
    this.session = null
    this.controlWriteTail = Promise.resolve()
    this.statusValue = { ...this.statusValue, controlReady: false }
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
        controlReady: false,
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
