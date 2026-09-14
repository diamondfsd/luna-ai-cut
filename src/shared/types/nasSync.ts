export type NasSyncConnectionState =
  | 'disabled'
  | 'not-configured'
  | 'ready'
  | 'syncing'
  | 'offline'
  | 'error'

export type NasSyncItemState = 'queued' | 'syncing' | 'synced' | 'failed' | 'canceled'

export interface NasSyncItem {
  id: string
  sourcePath: string
  targetPath: string
  fileName: string
  bytes: number | null
  sourceSize: number | null
  sourceMtimeMs: number | null
  state: NasSyncItemState
  attempts: number
  downloadedBytes: number
  error?: string
  queuedAt: string
  updatedAt: string
}

export interface NasSyncStatus {
  state: NasSyncConnectionState
  totalFiles: number
  completedFiles: number
  pendingFiles: number
  failedFiles: number
  canceledFiles: number
  totalBytes: number | null
  completedBytes: number
  currentFileName: string | null
  currentDownloadedBytes: number
  currentTotalBytes: number | null
  speedBps: number
  percent: number | null
  remotePath: string | null
  lastSyncedAt: string | null
  lastError: string | null
  updatedAt: string
  failedItems: Array<{ id: string; fileName: string; error: string }>
}

export interface NasSyncEnqueueResult {
  queued: number
  skipped: number
}
