import type { PreviewLayer } from './render'
import type { VideoExportSettings } from './video'

export interface LocalMediaExportEntrySnapshot {
  id: string
  sourcePath: string
  outputPath: string
  layers?: PreviewLayer[]
  outputSize?: { width: number; height: number }
  passthrough?: boolean
  index: number
  kind: 'image' | 'video'
  isLivePhoto?: boolean
  role?: 'media' | 'apple-live'
}

export interface WorkspaceExportPlanSnapshot {
  id: string
  kind: 'video' | 'photo' | 'live'
  sourcePath: string
  outputBaseName: string
  layers: PreviewLayer[]
  outputSize: { width: number; height: number }
  sourceDuration?: number
  startTime?: number
  endTime?: number
  time?: number
  coverTime?: number
  isLivePhoto?: boolean
  livePhotoSourcePath?: string
}

export interface WorkspaceExportEntrySnapshot {
  id: string
  plan: WorkspaceExportPlanSnapshot
  format: 'video' | 'photo' | 'live-video' | 'google-live' | 'apple-live'
  outputPath: string
  label: string
}

export interface LocalMediaExportTaskPayload {
  version: 1
  kind: 'local-media'
  exportDir: string
  taskName: string
  entries: LocalMediaExportEntrySnapshot[]
  exportConfig: VideoExportSettings | null
  appleLivePhoto: boolean
}

export interface WorkspaceExportTaskPayload {
  version: 1
  kind: 'workspace'
  exportDir: string
  taskName: string
  stamp: number
  entries: WorkspaceExportEntrySnapshot[]
  config: VideoExportSettings
  adjustableVideoId: string | null
}

export type ExportTaskPayload = LocalMediaExportTaskPayload | WorkspaceExportTaskPayload
