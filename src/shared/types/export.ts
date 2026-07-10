/** 创建/追加子任务的输入 */
export interface ExportItemInput {
  id: string
  sourcePath: string
  outputPath: string
  /** 用户可见的描述，如"视频导出"、"Live 图导出" */
  label?: string
}

/** 子任务记录 */
export interface ExportTaskItem {
  id: string
  fileName: string
  /** 用户可见的描述，如"视频导出"、"Live 图导出" */
  label?: string
  kind: 'image' | 'video' | 'lrv'
  status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  progress: number
  startTime: number
  endTime: number | null
  duration: number | null
  destinationPath?: string
  error?: string
}

/** 父任务记录 */
export interface ExportTaskRecord {
  id: string
  name: string
  totalCount: number
  status: 'pending' | 'exporting' | 'completed' | 'failed' | 'canceled'
  progress: number
  startTime: number
  endTime: number | null
  duration: number | null
  items: ExportTaskItem[]
}

/** 子项更新参数 */
export interface ExportItemUpdate {
  progress?: number
  status?: ExportTaskItem['status']
  error?: string
  destinationPath?: string
}

// ── 旧兼容类型（待清理） ──

/** @deprecated 使用 ExportItemInput */
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

/** @deprecated 使用 ExportTaskRecord 的进度字段 */
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

/** @deprecated 使用 ExportTaskItem */
export type ExportTaskItemRecord = ExportTaskItem

/** @deprecated 不再使用 */
export interface ExportSummary {
  completed: Array<{ name: string; path: string }>
  failed: Array<{ name: string; error: string }>
  canceled: Array<{ name: string }>
}
