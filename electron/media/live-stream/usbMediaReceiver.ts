import type { LiveStreamControlCommand, LiveStreamControlDelivery } from '../../../src/shared/types'
import { UCD2_MAGIC, USB_STREAM_CONTROL_COMMAND } from './usbAoaProtocol.ts'

export type UsbControlRequest = LiveStreamControlCommand & {
  version: 1
  requestId: string
  delivery: LiveStreamControlDelivery
}

export function controlDelivery(command: LiveStreamControlCommand): LiveStreamControlDelivery {
  if (command.type === 'gimbal.move' || command.type === 'zoom.preview') return 'best-effort'
  if (command.type === 'gimbal.stop' || command.type === 'gimbal.center' || command.type === 'gimbal.flip' || command.type === 'tracking.stop') return 'priority'
  return 'transactional'
}

export interface LiveMediaReceiver {
  status(): UsbAoaStatus
  start(): void
  stop(): Promise<void>
  sendControl(request: UsbControlRequest): Promise<void>
}

export type UsbAoaState = 'idle' | 'waiting' | 'switching' | 'connected' | 'streaming' | 'error'

export interface UsbAoaStatus {
  state: UsbAoaState
  transport: 'usb-aoa' | 'ios-tcp' | 'android-adb'
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

export function idleUsbStatus(message: string, transport: UsbAoaStatus['transport'] = 'usb-aoa'): UsbAoaStatus {
  return {
    state: 'idle', transport, message, deviceLabel: null, vendorId: null, productId: null,
    deviceDetectionUnavailable: false, frames: 0, bytes: 0, lastFrameAt: null,
    videoFrames: 0, videoBytes: 0, lastVideoFrameAt: null, controlReady: false, error: null,
  }
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
