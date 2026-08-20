import { usb } from 'usb'

type UsbDevice = Awaited<ReturnType<typeof usb.getDevices>>[number]
type UsbEndpoint = { endpointNumber: number; direction: 'in' | 'out'; type: 'bulk' | 'interrupt' | 'isochronous' }
type UsbInterface = { interfaceNumber: number; alternate: { endpoints: UsbEndpoint[] } }

import {
  BRIDGE_FLAGS,
  BRIDGE_TYPES,
  BridgeFrameParser,
  type BridgeFrame,
} from './cameraBridgeProtocol'
import type { CameraBridgeFrame } from '../src/shared/types'

const AOA_VENDOR_ID = 0x18d1
const AOA_PRODUCT_IDS = new Set([0x2d00, 0x2d01, 0x2d02, 0x2d03, 0x2d04, 0x2d05])
const ANDROID_VENDOR_IDS = new Set([
  0x04e8, 0x0bb4, 0x0fce, 0x12d1, 0x18d1, 0x19d2, 0x22b8, 0x22d9, 0x2717, 0x2a45, 0x2a70, 0x2d95,
])
const AOA_GET_PROTOCOL = 51
const AOA_SEND_STRING = 52
const AOA_START = 53
const USB_TIMEOUT_MS = 800
const POLL_INTERVAL_MS = 1000
const STATUS_INTERVAL_MS = 250

export type CameraBridgeStatus = {
  state: 'idle' | 'waiting-usb' | 'negotiating' | 'connected' | 'receiving' | 'error'
  transport: 'android-aoa'
  usbVendorId: number | null
  usbProductId: number | null
  frames: number
  bytes: number
  videoFrames: number
  keyframes: number
  fps: number
  codec: string
  width: number | null
  height: number | null
  lastFrameAt: string | null
  parserErrors: number
  error: string | null
}

const EMPTY_STATUS: CameraBridgeStatus = {
  state: 'idle',
  transport: 'android-aoa',
  usbVendorId: null,
  usbProductId: null,
  frames: 0,
  bytes: 0,
  videoFrames: 0,
  keyframes: 0,
  fps: 0,
  codec: '—',
  width: null,
  height: null,
  lastFrameAt: null,
  parserErrors: 0,
  error: null,
}

type StatusListener = (status: CameraBridgeStatus) => void
type FrameListener = (frame: CameraBridgeFrame) => void

class CameraBridgeReceiver {
  private running = false
  private worker: Promise<void> | null = null
  private device: UsbDevice | null = null
  private interfaceNumber: number | null = null
  private inputEndpoint: number | null = null
  private status: CameraBridgeStatus = { ...EMPTY_STATUS }
  private listeners = new Set<StatusListener>()
  private frameListeners = new Set<FrameListener>()
  private lastEmittedAt = 0
  private recentVideoFrames: number[] = []

  start(): CameraBridgeStatus {
    if (this.running) return this.status
    this.running = true
    this.status = { ...EMPTY_STATUS, state: 'waiting-usb' }
    this.emitStatus(true)
    this.worker = this.run()
    return this.status
  }

  async stop(): Promise<CameraBridgeStatus> {
    this.running = false
    await this.closeDevice()
    await this.worker?.catch(() => undefined)
    this.worker = null
    this.status = { ...this.status, state: 'idle', usbVendorId: null, usbProductId: null }
    this.emitStatus(true)
    return this.status
  }

  getStatus(): CameraBridgeStatus {
    return this.status
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  subscribeFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        const device = await this.findOrSwitchToAccessory()
        if (!device) {
          this.update({ state: 'waiting-usb', error: null })
          await delay(POLL_INTERVAL_MS)
          continue
        }
        await this.openAccessory(device)
        await this.readAccessory()
      } catch (error) {
        if (this.running) {
          this.update({ state: 'error', error: error instanceof Error ? error.message : String(error) }, true)
          await delay(POLL_INTERVAL_MS)
        }
      } finally {
        await this.closeDevice()
      }
    }
  }

  private async findOrSwitchToAccessory(): Promise<UsbDevice | null> {
    const devices = await usb.getDevices()
    const accessory = devices.find((candidate) => isAccessory(candidate))
    if (accessory) return accessory
    if (devices.length === 0) return null

    this.update({ state: 'negotiating', error: null }, true)
    for (const candidate of devices) {
      if (!ANDROID_VENDOR_IDS.has(candidate.vendorId)) continue
      try {
        const switched = await switchToAccessory(candidate)
        if (switched) return await waitForAccessory()
      } catch {
        // Non-Android USB devices are expected to reject the AOA vendor request.
      }
    }
    return null
  }

  private async openAccessory(device: UsbDevice): Promise<void> {
    await device.open()
    try {
      const configuration = device.configuration ?? device.configurations[0]
      if (!configuration) throw new Error('Android USB 没有可用配置')
      if (!device.configuration) await device.selectConfiguration(configuration.configurationValue)
      const usbInterfaces = configuration.interfaces as unknown as UsbInterface[]
      const usbInterface = usbInterfaces.find((candidate) => {
        const endpoints = candidate.alternate.endpoints
        return endpoints.some((endpoint) => endpoint.direction === 'in' && endpoint.type === 'bulk')
          && endpoints.some((endpoint) => endpoint.direction === 'out' && endpoint.type === 'bulk')
      })
      if (!usbInterface) throw new Error('Android Accessory 没有 bulk 数据端点')
      const input = usbInterface.alternate.endpoints.find((endpoint) => endpoint.direction === 'in' && endpoint.type === 'bulk')
      const output = usbInterface.alternate.endpoints.find((endpoint) => endpoint.direction === 'out' && endpoint.type === 'bulk')
      if (!input || !output) throw new Error('Android Accessory 端点不完整')
      await device.claimInterface(usbInterface.interfaceNumber)
      this.device = device
      this.interfaceNumber = usbInterface.interfaceNumber
      this.inputEndpoint = input.endpointNumber
      this.recentVideoFrames = []
      this.update({
        state: 'connected',
        usbVendorId: device.vendorId,
        usbProductId: device.productId,
        error: null,
        frames: 0,
        bytes: 0,
        videoFrames: 0,
        keyframes: 0,
        fps: 0,
        parserErrors: 0,
        lastFrameAt: null,
        codec: '—',
        width: null,
        height: null,
      }, true)
    } catch (error) {
      await device.close().catch(() => undefined)
      throw error
    }
  }

  private async readAccessory(): Promise<void> {
    const device = this.device
    const endpoint = this.inputEndpoint
    if (!device || endpoint === null) return
    const parser = new BridgeFrameParser()
    while (this.running && this.device === device) {
      try {
        const chunk = await device.nativeTransferIn(endpoint, USB_TIMEOUT_MS, 1024 * 1024)
        if (!chunk || chunk.byteLength === 0) continue
        this.update({ bytes: this.status.bytes + chunk.byteLength })
        for (const frame of parser.push(chunk)) this.consumeFrame(frame)
        this.update({ parserErrors: parser.errors.length })
      } catch (error) {
        if (!this.running) return
        if (isUsbTimeout(error)) continue
        throw new Error(`USB 读取失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private consumeFrame(frame: BridgeFrame): void {
    const now = Date.now()
    const next: Partial<CameraBridgeStatus> = {
      frames: this.status.frames + 1,
      state: this.status.state === 'connected' ? 'receiving' : this.status.state,
    }
    if (frame.type === BRIDGE_TYPES.VIDEO_CONFIG) {
      try {
        const config = JSON.parse(frame.payload.toString('utf8')) as { codec?: string; width?: number; height?: number }
        Object.assign(next, {
          codec: config.codec === 'video/avc' ? 'H.264' : (config.codec ?? '—'),
          width: config.width ?? null,
          height: config.height ?? null,
        })
      } catch {
        this.update({ error: '视频配置无法解析' }, true)
      }
    }
    if (frame.type === BRIDGE_TYPES.VIDEO) {
      const recent = [...this.recentVideoFrames, now].filter((timestamp) => timestamp >= now - 1000)
      this.recentVideoFrames = recent
      Object.assign(next, {
        videoFrames: this.status.videoFrames + 1,
        keyframes: this.status.keyframes + ((frame.flags & BRIDGE_FLAGS.KEYFRAME) !== 0 ? 1 : 0),
        fps: recent.length,
        lastFrameAt: new Date(now).toISOString(),
      })
    }
    if (frame.type === BRIDGE_TYPES.VIDEO_CONFIG || frame.type === BRIDGE_TYPES.VIDEO) {
      this.emitFrame({
        type: frame.type,
        flags: frame.flags,
        sequence: frame.sequence,
        timestampUs: frame.timestampUs.toString(),
        payload: new Uint8Array(frame.payload),
      })
    }
    this.update(next)
  }

  private emitFrame(frame: CameraBridgeFrame): void {
    for (const listener of this.frameListeners) listener(frame)
  }

  private update(patch: Partial<CameraBridgeStatus>, force = false): void {
    this.status = { ...this.status, ...patch }
    this.emitStatus(force)
  }

  private emitStatus(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastEmittedAt < STATUS_INTERVAL_MS) return
    this.lastEmittedAt = now
    for (const listener of this.listeners) listener(this.status)
  }

  private async closeDevice(): Promise<void> {
    const device = this.device
    const interfaceNumber = this.interfaceNumber
    this.device = null
    this.interfaceNumber = null
    this.inputEndpoint = null
    if (!device) return
    if (interfaceNumber !== null) await device.releaseInterface(interfaceNumber).catch(() => undefined)
    await device.close().catch(() => undefined)
  }
}

async function switchToAccessory(device: UsbDevice): Promise<boolean> {
  if (isAccessory(device)) return true
  await device.open()
  try {
    const response = await device.nativeControlTransferIn({
      requestType: 'vendor',
      recipient: 'device',
      request: AOA_GET_PROTOCOL,
      value: 0,
      index: 0,
    }, USB_TIMEOUT_MS, 2)
    if (!response || response.byteLength < 2) return false
    const protocol = response[0] | (response[1] << 8)
    if (protocol < 1) return false
    const strings = ['Luna AI Cut', 'Luna Camera Bridge', 'Android video bridge', '1.0', 'https://github.com/diamondfsd/luna-ai-cut', 'luna-camera-bridge']
    for (const [index, value] of strings.entries()) {
      const data = new TextEncoder().encode(`${value}\u0000`)
      await device.nativeControlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: AOA_SEND_STRING,
        value: 0,
        index,
      }, USB_TIMEOUT_MS, data)
    }
    await device.nativeControlTransferOut({
      requestType: 'vendor',
      recipient: 'device',
      request: AOA_START,
      value: 0,
      index: 0,
    }, USB_TIMEOUT_MS)
    return true
  } finally {
    await device.close().catch(() => undefined)
  }
}

async function waitForAccessory(): Promise<UsbDevice | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await delay(300)
    const devices = await usb.getDevices()
    const accessory = devices.find((candidate) => isAccessory(candidate))
    if (accessory) return accessory
  }
  return null
}

function isAccessory(device: UsbDevice): boolean {
  return device.vendorId === AOA_VENDOR_ID && AOA_PRODUCT_IDS.has(device.productId)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isUsbTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|timed out|LIBUSB_ERROR_TIMEOUT/i.test(message)
}

export const cameraBridgeReceiver = new CameraBridgeReceiver()
