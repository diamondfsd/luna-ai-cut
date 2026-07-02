export interface ExportFileInput {
  name: string
  kind: string
  localPath?: string
  exportId?: string
  taskId?: string
  taskName?: string
  createdAt?: number
  sourceDeviceId?: string
  sourceDeviceName?: string
  cameraType?: string
  cameraSerial?: string
  watermarkProfileId?: string
}

export interface ExportProgress {
  fileName: string
  index: number
  totalFiles: number
  percent: number | null
  status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  destinationPath?: string
  error?: string
  exportId?: string
  taskId?: string
  taskName?: string
  createdAt?: number
}

export interface ExportSummary {
  completed: Array<{ name: string; path: string }>
  failed: Array<{ name: string; error: string }>
  canceled: Array<{ name: string }>
}

export interface ExportTaskItemRecord {
  exportId: string
  fileName: string
  kind: string
  startTime: number | null
  endTime: number | null
  duration: number | null
  progress: number
  status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  error?: string
  destinationPath?: string
}

export interface ExportTaskRecord {
  id: string
  name: string
  totalCount: number
  startTime: number
  endTime: number | null
  duration: number | null
  progress: number
  status: 'pending' | 'exporting' | 'completed' | 'failed' | 'canceled'
  items: ExportTaskItemRecord[]
}
