export interface DownloadProgress {
  fileName: string
  index: number
  totalFiles: number
  downloaded: number
  total: number | null
  percent: number | null
  speedBps: number
  status: 'queued' | 'downloading' | 'done' | 'exists' | 'failed' | 'canceled'
  destinationPath?: string
}

export interface DownloadRecord {
  fileName: string
  path: string
  bytes: number | null
  downloadedAt: string
  sourceDeviceId?: string
  sourceDeviceName?: string
  cameraType?: string
  cameraSerial?: string
  watermarkProfileId?: string
}

export interface DownloadSummary {
  completed: Array<{ name: string; path: string }>
  failed: Array<{ name: string; error: string }>
  canceled: Array<{ name: string }>
}
