export type LocalMediaShareSource = 'local' | 'export' | 'custom'

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
  customCount: number
  sharedFileCount: number
  startedAt: number | null
}

export interface LocalMediaShareEntry {
  kind: 'directory' | 'file'
  path: string
  name: string
}
