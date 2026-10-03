import usb from 'usb'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { idleUsbStatus, encodeControlFrame, type LiveMediaReceiver, type UsbAoaStatus, type UsbControlRequest } from './usbMediaReceiver'
export { idleUsbStatus, encodeControlFrame, controlDelivery } from './usbMediaReceiver'
export type { LiveMediaReceiver, UsbAoaStatus, UsbAoaState, UsbControlRequest } from './usbMediaReceiver'
import { createUsbAccessoryShutdown } from './usbAccessoryLifecycle'
import { UsbDiagnosticError, usbDeviceDetails, usbErrorDetails, usbFailureMessage } from './usbAoaDiagnostics'
import { switchToUsbAccessory } from './usbAoaSwitch'
import {
  consumeFrames,
  USB_STREAM_VIDEO,
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

interface ActiveAccessory {
  device: usb.Device
  interfaceInfo: usb.Interface
  inEndpoint: usb.InEndpoint
  outEndpoint: usb.OutEndpoint
  generation: number
  polling: boolean
  videoReceived: boolean
  connectedAt: number
  waitingLogged: boolean
  onData: (data: Buffer) => void
  onError: (error: Error) => void
  shutdown: (() => Promise<void>) | null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function configuredVendorIds(): Set<number> | null {
  const raw = process.env.LUNA_AOA_VENDOR_IDS
  if (!raw) return null
  const values = raw.split(',')
    .map((entry) => Number.parseInt(entry.trim().replace(/^0x/i, ''), 16))
    .filter((value) => Number.isInteger(value) && value > 0)
  return values.length > 0 ? new Set(values) : null
}

export class UsbAoaReceiver implements LiveMediaReceiver {
  private readonly onFrame: (frame: UsbMediaFrame) => void
  private readonly onDisconnected: () => void
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
  private deviceSnapshot = ''
  private statusValue: UsbAoaStatus = idleUsbStatus('USB AOA 接收器未启动')

  constructor(onFrame: (frame: UsbMediaFrame) => void, onDisconnected: () => void = () => {},
    private readonly canProbe: (device: usb.Device) => Promise<boolean> = async () => true) {
    this.onFrame = onFrame
    this.onDisconnected = onDisconnected
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
    this.failedProbeDevices.clear()
    this.deviceSnapshot = ''
    logMainInfo('[USB AOA] 开始检测', { platform: process.platform, arch: process.arch, backend: 'libusb', scanIntervalMs: SCAN_INTERVAL_MS })
    this.statusValue = {
      ...this.statusValue,
      state: 'waiting',
      message: '等待手机通过 USB 连接',
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

  private readonly handleAttach = (device: usb.Device): void => {
    this.failedProbeDevices.clear()
    logMainInfo('[USB AOA] 检测到 USB 设备接入', usbDeviceDetails(device))
    void this.scan()
  }

  private readonly handleDetach = (device: usb.Device): void => {
    logMainWarn('[USB AOA] USB 设备已断开', usbDeviceDetails(device))
    const active = this.session?.device
    if (active && active.busNumber === device.busNumber && active.deviceAddress === device.deviceAddress) {
      this.onDisconnected()
      void this.disconnectAccessory('detached')
    }
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
    if (this.running && this.session && !this.session.videoReceived && !this.session.waitingLogged && Date.now() - this.session.connectedAt >= 10_000) {
      this.session.waitingLogged = true
      this.statusValue = { ...this.statusValue, message: '手机 USB 已连接，尚未收到视频' }
      logMainWarn('[USB AOA] 连接后仍未收到视频', { ...usbDeviceDetails(this.session.device), waitingMs: Date.now() - this.session.connectedAt, pendingBytes: this.pending.length, frames: this.statusValue.frames })
    }
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
      const devices = usb.getDeviceList().map(usbDeviceDetails)
      const snapshot = JSON.stringify(devices)
      const devicesChanged = snapshot !== this.deviceSnapshot
      if (devicesChanged) {
        this.deviceSnapshot = snapshot
        logMainInfo('[USB AOA] 当前 USB 设备', { count: devices.length, devices })
      }
      const accessory = this.findAccessory()
      if (accessory) {
        if (devicesChanged) logMainInfo('[USB AOA] 检测到配件模式设备', usbDeviceDetails(accessory))
        this.statusValue = { ...this.statusValue, vendorId: accessory.deviceDescriptor.idVendor, productId: accessory.deviceDescriptor.idProduct }
        await this.connectAccessory(accessory)
        return
      }

      let probeFailure: unknown = null
      for (const candidate of this.findAndroidCandidates()) {
        if (!this.running) return
        if (!await this.canProbe(candidate)) continue
        if (!this.running) return
        let switched: boolean
        try {
          switched = await this.switchToAccessory(candidate)
        } catch (error) {
          probeFailure = error
          const details = usbErrorDetails(error)
          const key = JSON.stringify({ ...usbDeviceDetails(candidate), ...details })
          if (!this.failedProbeDevices.has(key)) {
            this.failedProbeDevices.add(key)
            logMainWarn('[USB AOA] 设备探测失败', { ...usbDeviceDetails(candidate), ...details })
          }
          if (error instanceof UsbDiagnosticError && error.stage !== '打开原始设备' && error.stage !== '查询配件协议') throw error
          continue
        }
        if (!switched) continue

        const accessoryAfterSwitch = await this.waitForAccessory(5_000)
        if (accessoryAfterSwitch && this.running) await this.connectAccessory(accessoryAfterSwitch)
        else if (this.running) {
          logMainWarn('[USB AOA] 切换后未发现配件设备', { ...usbDeviceDetails(candidate), timeoutMs: 5_000 })
          this.statusValue = { ...this.statusValue, state: 'error', message: '手机 USB 切换超时，请重新连接', error: '手机 USB 切换超时，请重新连接', controlReady: false }
        }
        return
      }

      if (probeFailure) throw probeFailure

      if (this.running && this.statusValue.state !== 'error') {
        this.statusValue = {
          ...this.statusValue,
          state: 'waiting',
          message: '等待手机通过 USB 连接',
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
    return switchToUsbAccessory(device, () => this.running, (version) => {
      const { idVendor, idProduct } = device.deviceDescriptor
      this.statusValue = {
        ...this.statusValue,
        state: 'switching',
        message: '已识别手机，正在连接',
        deviceLabel: '手机',
        vendorId: idVendor,
        productId: idProduct,
        error: null,
      }
      logMainInfo('[USB AOA] 手机支持配件协议，开始切换', { ...usbDeviceDetails(device), protocolVersion: version })
    })
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
      videoReceived: false,
      connectedAt: Date.now(),
      waitingLogged: false,
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
    logMainInfo('[USB AOA] Bulk 端点已打开', { ...usbDeviceDetails(device), interfaceNumber: interfaceInfo.interfaceNumber, inEndpoint: inEndpoint.address, outEndpoint: outEndpoint.address })
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
    let stage = '打开配件设备'
    let interfaceInfo: usb.Interface | undefined
    let claimed = false
    try {
      device.open()
      stage = '查找传输接口'
      logMainInfo('[USB AOA] 配件设备已打开', { ...usbDeviceDetails(device), interfaces: device.interfaces?.map((item) => ({ interfaceNumber: item.interfaceNumber, endpoints: item.endpoints.map((endpoint) => ({ address: endpoint.address, direction: endpoint.direction, transferType: endpoint.transferType })) })) })
      interfaceInfo = device.interfaces?.find((item) =>
        item.endpoints.some((endpoint) => endpoint.transferType === LIBUSB_TRANSFER_TYPE_BULK),
      )
      if (!interfaceInfo) throw new Error('未找到 USB AOA Bulk 接口')
      stage = '占用传输接口'
      interfaceInfo.claim()
      claimed = true
      stage = '检查视频与控制端点'

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
      throw new UsbDiagnosticError(stage, error)
    }
  }

  private handleFrame(frame: UsbMediaFrame): void {
    if (frame.streamType === USB_STREAM_VIDEO && this.session && !this.session.videoReceived) {
      this.session.videoReceived = true
      logMainInfo('[USB AOA] 收到首个视频帧', { bytes: frame.raw.length })
    }
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
    if (this.session && /LIBUSB_ERROR_NO_DEVICE/i.test(usbErrorDetails(error).error)) this.onDisconnected()
    const detail = error instanceof UsbDiagnosticError ? error.message : usbFailureMessage(error)
    const details = { vendorId: this.statusValue.vendorId, productId: this.statusValue.productId, ...usbErrorDetails(error) }
    const key = JSON.stringify(details)
    if (!this.failedProbeDevices.has(key)) {
      this.failedProbeDevices.add(key)
      logMainWarn('[USB AOA] 接收失败', details)
    }
    this.statusValue = {
      ...this.statusValue,
      state: 'error',
      message: detail,
      error: detail,
    }
    void this.disconnectAccessory('detached')
  }

}
