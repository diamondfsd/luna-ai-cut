import { IosTcpReceiver } from './iosTcpReceiver'
import { stateScore } from './mediaReceiverStatus'
import {
  type LiveMediaReceiver,
  type UsbAoaStatus,
  type UsbControlRequest,
  type UsbMediaFrame,
  UsbAoaReceiver,
} from './usbAoaReceiver'

class MultiTransportReceiver implements LiveMediaReceiver {
  private readonly receivers: LiveMediaReceiver[]
  private lastActive: LiveMediaReceiver

  constructor(onFrame: (frame: UsbMediaFrame) => void) {
    const android = new UsbAoaReceiver(onFrame)
    const ios = new IosTcpReceiver(onFrame)
    this.receivers = [android, ios]
    this.lastActive = android
  }

  status(): UsbAoaStatus {
    const statuses = this.receivers.map((receiver) => receiver.status())
    if (statuses.every((status) => status.state === 'waiting' && !status.deviceLabel && !status.error && !status.deviceDetectionUnavailable)) {
      this.lastActive = this.receivers[0]
      return { ...statuses[0], message: '等待 Android 或 iPhone 通过 USB 连接' }
    }
    const receiver = this.activeReceiver()
    this.lastActive = receiver
    return receiver.status()
  }

  start(): void {
    for (const receiver of this.receivers) receiver.start()
  }

  async stop(): Promise<void> {
    await Promise.all(this.receivers.map((receiver) => receiver.stop()))
  }

  sendControl(request: UsbControlRequest): Promise<void> {
    const receiver = this.activeReceiver()
    const status = receiver.status()
    if (status.state !== 'connected' && status.state !== 'streaming') {
      throw new Error('手机 USB 尚未连接')
    }
    this.lastActive = receiver
    return receiver.sendControl(request)
  }

  private activeReceiver(): LiveMediaReceiver {
    let selected = this.lastActive
    let best = stateScore(selected.status())
    for (const receiver of this.receivers) {
      const score = stateScore(receiver.status())
      if (score > best || (score === best && receiver === this.lastActive)) {
        selected = receiver
        best = score
      }
    }
    return selected
  }
}

export function createLiveMediaReceiver(onFrame: (frame: UsbMediaFrame) => void): LiveMediaReceiver {
  return new MultiTransportReceiver(onFrame)
}
