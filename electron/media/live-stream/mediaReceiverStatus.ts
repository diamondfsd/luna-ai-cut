import type { UsbAoaStatus } from './usbMediaReceiver'

export function receiverDiagnostics(statuses: UsbAoaStatus[], selected: UsbAoaStatus) {
  return (selected.controlReady ? [selected] : statuses).flatMap((status) => {
    if (status.connectionDiagnostics?.length) return status.connectionDiagnostics
    if (!status.error) return []
    const source = status.transport === 'ios-tcp' ? 'iPhone'
      : status.transport === 'harmony-hdc' ? '鸿蒙手机' : '安卓手机'
    return [{ source, message: status.message, detail: status.error }]
  })
}

interface ReceiverStatus {
  state: 'streaming' | 'connected' | 'switching' | 'waiting' | 'error' | 'idle'
  deviceLabel: string | null
  deviceDetectionUnavailable: boolean
}

export function stateScore(status: ReceiverStatus): number {
  const detectedBonus = status.deviceLabel && status.state === 'waiting' ? 1 : 0
  const detectionUnavailableBonus = status.deviceDetectionUnavailable && status.state === 'waiting' ? 0.25 : 0
  switch (status.state) {
    case 'streaming': return 6
    case 'connected': return 5
    case 'switching': return 4.5
    case 'error': return 3.9
    case 'waiting': return 3 + detectedBonus + detectionUnavailableBonus
    case 'idle': return 1
  }
}
