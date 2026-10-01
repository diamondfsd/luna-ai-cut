import usb from 'usb'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import type {
  LiveStreamControlCommand,
  LiveStreamControlDelivery,
} from '../../../src/shared/types'
import { createUsbAccessoryShutdown } from './usbAccessoryLifecycle'
import {
  consumeFrames,
  USB_STREAM_CONTROL_COMMAND,
  USB_STREAM_VIDEO,
  UCD2_MAGIC,
  type UsbMediaFrame,
} from './usbAoaProtocol'

export {
  consumeFrames,
  parseMediaFrame,
  USB_STREAM_CONTROL_COMMAND,
  USB_STREAM_CONTROL_RESULT,
  USB_STREAM_VIDEO,
} from './usbAoaProtocol'
export type { UsbMediaFrame } from './usbAoaProtocol'

const ACCESSORY_VID = 0x18d1
const ACCESSORY_PIDS = new Set([0x2d00, 0x2d01, 0x2d04, 0x2d05, 0x2d06, 0x2d07])
const TRANSFER_SIZE = 16 * 1024
const SCAN_INTERVAL_MS = 1_000
const LIBUSB_TRANSFER_TYPE_BULK = 2

export type UsbControlRequest = LiveStreamControlCommand & {
  version: 1
  requestId: string
  delivery: LiveStreamControlDelivery
}

export function controlDelivery(command: LiveStreamControlCommand): LiveStreamControlDelivery {
  if (command.type === 'gimbal.move' || command.type === 'zoom.preview') return 'best-effort'
  if (
    command.type === 'gimbal.stop'
    || command.type === 'gimbal.center'
    || command.type === 'gimbal.flip'
    || command.type === 'tracking.stop'
  ) return 'priority'
  return 'transactional'
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
    deviceDetectionUnavailable: false,
    frames: 0,
    bytes: 0,
    lastFrameAt: null,
    videoFrames: 0,
    videoBytes: 0,
    lastVideoFrameAt: null,
    controlReady: false,
    error: null,
  }
}

export type UsbAoaState = 'idle' | 'waiting' | 'switching' | 'connected' | 'streaming' | 'error'

export interface UsbAoaStatus {
  state: UsbAoaState
  transport: 'usb-aoa' | 'ios-tcp'
  message: string
  deviceLabel: string | null
  vendorId: number | null
  productId: number | null
  deviceDetectionUnavailable: boolean
  frames: number
  bytes: number
  lastFrameAt: string | null
  videoFrames: number
  videoBytes: number
  lastVideoFrameAt: string | null
  controlReady: boolean
  error: string | null
}

interface ActiveAccessory {
  device: usb.Device
  interfaceInfo: usb.Interface
  inEndpoint: usb.InEndpoint
  outEndpoint: usb.OutEndpoint
  generation: number
  polling: boolean
  onData: (data: Buffer) => void
  onError: (error: Error) => void
  shutdown: (() => Promise<void>) | null
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
  private scanTask: Promise<void> | null = null
  private disconnectTask: Promise<void> | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private pending = Buffer.alloc(0)
  private controlSequence = 0
  private readonly controlWrites = new Set<Promise<void>>()
  private readonly failedProbeDevices = new Set<string>()
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
    const write = new Promise<void>((resolve, reject) => {
      if (this.session !== session) {
        reject(new Error('手机 USB 已断开'))
        return
      }
      session.outEndpoint.transfer(frame, (error) => error ? reject(error) : resolve())
    })
    this.controlWrites.add(write)
    void write.finally(() => this.controlWrites.delete(write)).catch(() => undefined)
    return write
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
    await this.scanTask
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

  private findAndroidCandidates(): usb.Device[] {
    const configured = configuredVendorIds()
    return usb.getDeviceList().filter((device) => {
      const { idVendor } = device.deviceDescriptor
      if (this.isAccessoryDevice(device) || idVendor === 0x1d6b || idVendor === 0x05ac) return false
      if (device.deviceDescriptor.bDeviceClass === 0x09) return false
      return !configured || configured.has(idVendor)
    })
  }

  private scan(): Promise<void> {
    if (!this.running || this.scanning || this.session || this.disconnectTask) return Promise.resolve()
    this.scanning = true
    const task = this.runScan().finally(() => {
      this.scanning = false
      if (this.scanTask === task) this.scanTask = null
    })
    this.scanTask = task
    return task
  }

  private async runScan(): Promise<void> {
    try {
      const accessory = this.findAccessory()
      if (accessory) {
        await this.connectAccessory(accessory)
        return
      }

      for (const candidate of this.findAndroidCandidates()) {
        if (!this.running) return
        let switched: boolean
        try {
          switched = await this.switchToAccessory(candidate)
        } catch (error) {
          const { idVendor, idProduct } = candidate.deviceDescriptor
          const key = `${idVendor}:${idProduct}`
          if (!this.failedProbeDevices.has(key)) {
            this.failedProbeDevices.add(key)
            const detail = error instanceof Error ? error.message : String(error)
            logMainInfo('[USB AOA] 跳过无法探测的 USB 设备', { vendorId: idVendor, productId: idProduct, error: detail })
          }
          continue
        }
        if (!switched) continue

        const accessoryAfterSwitch = await this.waitForAccessory(5_000)
        if (accessoryAfterSwitch && this.running) await this.connectAccessory(accessoryAfterSwitch)
        return
      }

      if (this.running) {
        this.statusValue = {
          ...this.statusValue,
          state: 'waiting',
          message: '等待支持 USB AOA 的 Android 手机',
          deviceLabel: null,
          vendorId: null,
          productId: null,
          controlReady: false,
          error: null,
        }
      }
    } catch (error) {
      if (this.running) this.fail(error)
    }
  }

  private async switchToAccessory(device: usb.Device): Promise<boolean> {
    device.timeout = 2_000
    device.open()
    try {
      let protocol: Buffer | number | undefined
      try {
        protocol = await controlTransfer(device, 0xc0, 51, 0, 0, 2)
      } catch {
        return false
      }
      if (!this.running || !Buffer.isBuffer(protocol) || protocol.length < 2) return false
      const version = protocol.readUInt16LE(0)
      if (version < 1) return false

      const { idVendor, idProduct } = device.deviceDescriptor
      this.statusValue = {
        ...this.statusValue,
        state: 'switching',
        message: '已识别 Android 手机，正在切换 USB 模式',
        deviceLabel: 'Android 手机',
        vendorId: idVendor,
        productId: idProduct,
        error: null,
      }
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
        if (!this.running) return false
        await controlTransfer(device, 0x40, 52, 0, index, Buffer.from(`${strings[index]}\0`, 'utf8'))
      }
      if (this.running) await controlTransfer(device, 0x40, 53, 0, 0, Buffer.alloc(0))
      return true
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
    if (!this.running) return
    const generation = ++this.generation
    const { interfaceInfo, inEndpoint, outEndpoint } = await this.openAccessory(device)
    outEndpoint.timeout = 1_000

    this.pending = Buffer.alloc(0)
    const session: ActiveAccessory = {
      device,
      interfaceInfo,
      inEndpoint,
      outEndpoint,
      generation,
      polling: false,
      shutdown: null,
      onData: (data) => {
        if (!this.running || this.session !== session || session.generation !== this.generation) return
        if (data.length > 0) {
          this.pending = consumeFrames(
            Buffer.concat([this.pending, data]),
            (frame) => this.handleFrame(frame),
            (reason) => logMainWarn(`[USB AOA] 丢弃无效 UCD2 帧：${reason}`),
          )
        }
      },
      onError: (error) => {
        if (this.running && this.session === session) this.fail(error)
      },
    }
    this.session = session
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
    inEndpoint.on('data', session.onData)
    inEndpoint.on('error', session.onError)
    inEndpoint.startPoll(3, TRANSFER_SIZE)
    session.polling = true
  }

  private async openAccessory(device: usb.Device): Promise<{
    interfaceInfo: usb.Interface
    inEndpoint: usb.InEndpoint
    outEndpoint: usb.OutEndpoint
  }> {
    device.open()
    let interfaceInfo: usb.Interface | undefined
    let claimed = false
    try {
      interfaceInfo = device.interfaces?.find((item) =>
        item.endpoints.some((endpoint) => endpoint.transferType === LIBUSB_TRANSFER_TYPE_BULK),
      )
      if (!interfaceInfo) throw new Error('未找到 USB AOA Bulk 接口')
      interfaceInfo.claim()
      claimed = true

      const inEndpoint = interfaceInfo.endpoints.find((endpoint) =>
        endpoint.direction === 'in' && endpoint.transferType === LIBUSB_TRANSFER_TYPE_BULK,
      ) as usb.InEndpoint | undefined
      if (!inEndpoint) throw new Error('USB AOA 缺少视频输入端点')
      const outEndpoint = interfaceInfo.endpoints.find((endpoint) =>
        endpoint.direction === 'out' && endpoint.transferType === LIBUSB_TRANSFER_TYPE_BULK,
      ) as usb.OutEndpoint | undefined
      if (!outEndpoint) throw new Error('USB AOA 缺少控制输出端点')
      return { interfaceInfo, inEndpoint, outEndpoint }
    } catch (error) {
      if (interfaceInfo && claimed) {
        await new Promise<void>((resolve) => {
          try {
            interfaceInfo!.release(false, () => resolve())
          } catch {
            resolve()
          }
        })
      }
      try { device.close() } catch { /* Device may already be gone. */ }
      throw error
    }
  }

  private handleFrame(frame: UsbMediaFrame): void {
    const receivedAt = new Date().toISOString()
    const isVideo = frame.streamType === USB_STREAM_VIDEO
    const streamLabel = isVideo ? '视频' : '媒体'
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
      error: null,
    }
    this.onFrame(frame)
  }

  private disconnectAccessory(reason: 'stopped' | 'detached'): Promise<void> {
    if (this.disconnectTask) return this.disconnectTask

    ++this.generation
    const session = this.session
    this.session = null
    const controlWrites = Promise.allSettled([...this.controlWrites]).then(() => undefined)
    this.statusValue = { ...this.statusValue, controlReady: false }
    this.pending = Buffer.alloc(0)

    const task = (async () => {
      if (session) {
        session.shutdown ??= createUsbAccessoryShutdown({
          stopPolling: () => new Promise<void>((resolve) => {
            if (!session.polling) {
              session.inEndpoint.off('data', session.onData)
              session.inEndpoint.off('error', session.onError)
              resolve()
              return
            }
            try {
              session.inEndpoint.stopPoll(() => {
                session.polling = false
                session.inEndpoint.off('data', session.onData)
                session.inEndpoint.off('error', session.onError)
                resolve()
              })
            } catch {
              session.polling = false
              session.inEndpoint.off('data', session.onData)
              session.inEndpoint.off('error', session.onError)
              resolve()
            }
          }),
          waitForControlWrites: () => controlWrites,
          releaseInterface: () => new Promise<void>((resolve) => {
            try {
              session.interfaceInfo.release(false, (error) => {
                if (error) logMainWarn('[USB AOA] 释放 USB 接口失败', { error: error.message })
                resolve()
              })
            } catch {
              resolve()
            }
          }),
          closeDevice: () => session.device.close(),
        })
        await session.shutdown()
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
    })().finally(() => {
      if (this.disconnectTask === task) this.disconnectTask = null
      if (reason === 'detached' && this.running) void this.scan()
    })
    this.disconnectTask = task
    return task
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

}
