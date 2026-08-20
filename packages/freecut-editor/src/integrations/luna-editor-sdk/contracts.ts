/**
 * FreeCut's adapter boundary for the shared Luna Editor SDK.
 *
 * The public package owns transport-neutral contracts. This file keeps the
 * FreeCut-specific project, media, render and preview types at the adapter
 * boundary so FreeCut stores and React types do not leak into the public SDK.
 */
import type { ClientExportSettings } from '@freecut/features/export/utils/client-renderer'
import type { ItemKeyframes } from '@freecut/types/keyframe'
import type { Project } from '@freecut/types/project'
import type { MediaMetadata } from '@freecut/types/storage'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import type { Transition } from '@freecut/types/transition'

export type { ClientExportSettings, ItemKeyframes, MediaMetadata, Project, TimelineItem, TimelineTrack, Transition }

export interface ProjectInspectQuery {
  includeTimeline?: boolean
}

export interface ProjectInspection {
  /** The project currently opened by the host editor. */
  projectId: string
  project: Project
  timeline: Project['timeline']
  counts: {
    tracks: number
    items: number
    transitions: number
    keyframes: number
    compositions: number
  }
}

export interface TimelineQuery {
  trackId?: string
  itemIds?: readonly string[]
  fromFrame?: number
  toFrame?: number
}

export interface TimelineInspection {
  projectId: string
  fps: number
  currentFrame: number
  inPoint?: number
  outPoint?: number
  tracks: Project['timeline'] extends infer T
    ? T extends { tracks: infer Tracks }
      ? Tracks
      : never
    : never
  items: Project['timeline'] extends infer T
    ? T extends { items: infer Items }
      ? Items
      : never
    : never
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  compositions: NonNullable<Project['timeline']>['compositions']
}

export interface MediaQuery {
  ids?: readonly string[]
  search?: string
  mimeTypePrefix?: string
}

export interface MediaInspection {
  media: MediaMetadata
}

export interface MediaListResult {
  media: MediaMetadata[]
  total: number
}

export interface FreeCutEditRequest {
  ops: readonly Record<string, unknown>[]
  /** Optional metadata supplied by a caller for addClip operations. */
  media?: readonly MediaMetadata[]
}

export interface FreeCutEditResponse {
  project: Project
  applied: number
  results: readonly {
    callerId?: string
    op: string
    ok: boolean
    detail?: unknown
    error?: string
  }[]
  affectedIds: string[]
  createdIds: string[]
  removedIds: string[]
  warnings: string[]
  /** Reserved for the shared persistence adapter; absent until it is connected. */
  revision?: string
}

export interface FreeCutMediaSource {
  mediaId: string
  url: string
  metadata?: MediaMetadata
}

export interface FreeCutRenderProjectRequest {
  settings: ClientExportSettings
  media?: readonly FreeCutMediaSource[]
  renderWholeProject?: boolean
  inPoint?: number | null
  outPoint?: number | null
  outputFileName?: string
  strict?: boolean
}

export interface FreeCutRenderFrameRequest {
  media?: readonly FreeCutMediaSource[]
  frame?: number
  atSeconds?: number
  width?: number
  height?: number
  format?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
  outputFileName?: string
  strict?: boolean
}

export interface FreeCutLayoutRequest {
  media?: readonly FreeCutMediaSource[]
  frame?: number
  atSeconds?: number
  strict?: boolean
}

export interface FreeCutRenderSummary {
  ok: true
  mimeType: string
  fileSize: number
  durationSeconds: number
  fileName: string
  effectiveSettings: ClientExportSettings
  warnings: readonly Record<string, unknown>[]
}

export interface FreeCutFrameSummary {
  ok: true
  frame: number
  atSeconds: number
  width: number
  height: number
  format: string
  fileSize: number
  fileName: string
  warnings: readonly Record<string, unknown>[]
}

export interface FreeCutLayoutItem {
  id: string
  type: string
  trackId: string
  from: number
  durationInFrames: number
  x: number
  y: number
  width: number
  height: number
  opacity: number
  rotation: number
  visible: boolean
  z: number
  [key: string]: unknown
}

export interface FreeCutLayoutSummary {
  frame: number
  atSeconds: number
  canvas: { width: number; height: number; fps: number }
  items: readonly FreeCutLayoutItem[]
  warnings: readonly Record<string, unknown>[]
}

/** The render functions are injected from the existing headless entry. */
export interface FreeCutHeadlessPort {
  renderProject(input: { project: Project } & FreeCutRenderProjectRequest): Promise<FreeCutRenderSummary>
  renderFrame(input: { project: Project } & FreeCutRenderFrameRequest): Promise<FreeCutFrameSummary>
  dumpLayout(input: { project: Project } & FreeCutLayoutRequest): Promise<FreeCutLayoutSummary>
}

export interface FreeCutPreviewState {
  currentFrame: number
  fps: number
  playing: boolean
  durationInFrames: number
}

export interface FreeCutPreviewPort {
  inspect(): FreeCutPreviewState | Promise<FreeCutPreviewState>
  seek(input: { frame?: number; atSeconds?: number }): unknown | Promise<unknown>
  captureFrame(input?: FreeCutRenderFrameRequest): unknown | Promise<unknown>
}

export type FreeCutCapabilityName =
  | 'project.inspect'
  | 'project.edit'
  | 'timeline.inspect'
  | 'timeline.add_track'
  | 'timeline.edit'
  | 'timeline.edit_batch'
  | 'media.list'
  | 'media.inspect'
  | 'media.read'
  | 'media.analyze'
  | 'media.get_analysis_task'
  | 'media.search_transcript'
  | 'audio.start_speech'
  | 'audio.start_music'
  | 'audio.get_task'
  | 'render.project'
  | 'render.frame'
  | 'render.layout'
  | 'preview.inspect'
  | 'preview.seek'
  | 'preview.capture_frame'

export interface FreeCutCapabilityDescriptor {
  name: FreeCutCapabilityName
  access: 'read' | 'write'
  description: string
}

export interface FreeCutRuntimeOptions {
  project: Project
  media?: readonly MediaMetadata[]
  mediaSources?: readonly FreeCutMediaSource[]
  headless?: FreeCutHeadlessPort
  preview?: FreeCutPreviewPort
}
