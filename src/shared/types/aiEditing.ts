import type { RenderColorAdjustments, WatermarkPositioning } from './render'

export type EditSourceKind = 'video' | 'image' | 'audio'

export interface EditProjectSource {
  id: string
  mediaId: string
  name: string
  kind: EditSourceKind
  path: string
  durationMs: number | null
  width: number | null
  height: number | null
}

export interface EditProjectClip {
  id: string
  sourceId: string
  sourceStartMs: number
  sourceEndMs: number
  timelineStartMs: number
  volume: number
  color?: Partial<RenderColorAdjustments>
  crop?: { left: number; top: number; width: number; height: number }
  photoMotion?: 'none' | 'gentleZoomIn'
  speedCurve?: { interpolation: 'linear' | 'smooth'; points: Array<{ u: number; speed: number }> }
  fadeOutMs?: number
}

export interface LunaEditProject {
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  revision: number
  directorPlanId: string | null
  canvas: { width: number; height: number; fps: number }
  sources: EditProjectSource[]
  clips: EditProjectClip[]
  music: { sourceId: string; sourceStartMs: number; sourceEndMs: number; volume: number; timing?: {
    bpm: number; duration: number; beatTimes: number[]; downbeats: number[]; percussionHits: Array<{ time: number; pitch: number; velocity: number }>
  } } | null
  musicEnabled?: boolean
  filter?: { id: string; intensity: number; enabled: boolean } | null
  watermark?: { id: string; width: number; opacity: number; positioning: WatermarkPositioning & { centerX?: number; centerY?: number } } | null
  aiUndo?: Array<{ taskId: string; before: Omit<LunaEditProject, 'aiUndo'>; afterRevision: number }>
}

export interface EditProjectSummary {
  projectId: string
  projectName: string
  createdAt: string
  updatedAt: string
  revision: number
  clipCount: number
}

export type FootageDecision = 'undecided' | 'liked' | 'rejected'

export interface FootageSelectionPoint {
  id: string
  timeMs: number
  liked: boolean
  comment: string
  updatedAt: string
}

export interface FootageSelectionRange {
  id: string
  startMs: number
  endMs: number
  comment: string
  locked: boolean
  updatedAt: string
}

export interface FootageSelectionItem {
  mediaId: string
  decision: FootageDecision
  comment: string
  tags: string[]
  points: FootageSelectionPoint[]
  ranges: FootageSelectionRange[]
  updatedAt: string | null
}

export interface FootageSelectionProject {
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  revision: number
  items: Record<string, FootageSelectionItem>
}

export interface FootageSelectionProjectSummary {
  projectId: string
  projectName: string
  createdAt: string
  updatedAt: string
  revision: number
  itemCount: number
  annotatedCount: number
}

export interface AiEditorProjectSnapshot {
  project: LunaEditProject
}

export interface AiEditorProjectApi {
  list(): Promise<EditProjectSummary[]>
  create(name: string): Promise<EditProjectSummary>
  load(projectId: string): Promise<AiEditorProjectSnapshot>
  save(project: LunaEditProject, expectedRevision: number, taskId?: string): Promise<LunaEditProject>
  delete(projectId: string): Promise<void>
  rename(projectId: string, name: string): Promise<EditProjectSummary>
  addMedia(projectId: string, mediaIds: string[]): Promise<LunaEditProject>
}

export interface FootageSelectionProjectApi {
  list(): Promise<FootageSelectionProjectSummary[]>
  create(name: string, mediaIds?: string[]): Promise<FootageSelectionProject>
  load(projectId: string): Promise<FootageSelectionProject>
  save(project: FootageSelectionProject, expectedRevision: number): Promise<FootageSelectionProject>
  delete(projectId: string): Promise<void>
}
