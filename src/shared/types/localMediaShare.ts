export type LocalMediaShareSource = 'local' | 'export'

export interface LocalMediaShareNetwork {
  id: string
  name: string
  address: string
}

export interface LocalMediaShareStatus {
  running: boolean
  address: string | null
  port: number | null
  url: string | null
  qrDataUrl: string | null
  localCount: number
  exportCount: number
  startedAt: number | null
}
