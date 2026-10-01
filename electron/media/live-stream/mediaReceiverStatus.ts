interface ReceiverStatus {
  state: 'streaming' | 'connected' | 'switching' | 'waiting' | 'error' | 'idle'
  deviceLabel: string | null
  deviceDetectionUnavailable: boolean
}

export function stateScore(status: ReceiverStatus): number {
  const detectedBonus = status.deviceLabel && status.state === 'waiting' ? 0.5 : 0
  const detectionUnavailableBonus = status.deviceDetectionUnavailable && status.state === 'waiting' ? 0.25 : 0
  switch (status.state) {
    case 'streaming': return 6
    case 'connected': return 5
    case 'switching': return 4
    case 'error': return 3.9
    case 'waiting': return 3 + detectedBonus + detectionUnavailableBonus
    case 'idle': return 1
  }
}
