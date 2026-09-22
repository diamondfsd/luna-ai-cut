import { IosTcpReceiver } from './iosTcpReceiver'
import {
  type DesktopMediaReceiver,
  type UsbAoaStatus,
  type UsbControlRequest,
  type UsbMediaFrame,
  UsbAoaReceiver,
} from './usbAoaReceiver'

function stateScore(status: UsbAoaStatus): number {
  switch (status.state) {
    case 'streaming': return 6
    case 'connected': return 5
    case 'switching': return 4
    case 'waiting': return 3
    case 'error': return 2
    case 'idle': return 1
  }
}

class MultiTransportReceiver implements DesktopMediaReceiver {
  private readonly receivers: DesktopMediaReceiver[]
  private lastActive: DesktopMediaReceiver

  constructor(onFrame: (frame: UsbMediaFrame) => void) {
    const android = new UsbAoaReceiver(onFrame)
    const ios = new IosTcpReceiver(onFrame)
    this.receivers = [android, ios]
    this.lastActive = android
  }

  status(): UsbAoaStatus {
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

  private activeReceiver(): DesktopMediaReceiver {
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

export function createDesktopMediaReceiver(onFrame: (frame: UsbMediaFrame) => void): DesktopMediaReceiver {
  return new MultiTransportReceiver(onFrame)
}
