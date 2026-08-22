export type RemotionRenderStatus =
  | 'queued'
  | 'bundling'
  | 'rendering'
  | 'completed'
  | 'failed'
  | 'canceled'

export type RemotionClipStatus = 'ready' | 'dirty' | 'rendering' | 'failed'

export interface RemotionSourceFiles {
  'src/Root.tsx': string
  [filePath: string]: string
}

export interface RemotionClipArtifact {
  artifactId: string
  outputPath: string
  manifestPath: string
  mediaId?: string
  sourceRevision: number
  sourceHash: string
  fileSize: number
  sha256: string
  mimeType: 'video/mp4'
}

export interface RemotionClip {
  clipId: string
  projectId: string
  entryFile: 'entry.tsx'
  compositionId: string
  compositionVersion: number
  sourceRevision: number
  sourceHash: string
  width: number
  height: number
  fps: number
  durationInFrames: number
  mediaIds: string[]
  status: RemotionClipStatus
  createdAt: string
  updatedAt: string
  artifact?: RemotionClipArtifact
  error?: string
}

export interface RemotionClipCreateInput {
  compositionId?: string
  width?: number
  height?: number
  fps?: number
  durationInFrames?: number
  mediaIds?: string[]
  files?: RemotionSourceFiles
}

export interface RemotionSourceUpdateRequest {
  projectId: string
  clipId: string
  expectedRevision: number
  files: Partial<RemotionSourceFiles>
  removeFiles?: string[]
}

export interface RemotionSourceSnapshot {
  clipId: string
  sourceRevision: number
  sourceHash: string
  files: RemotionSourceFiles
}

export interface RemotionClipRequest {
  projectId: string
  clipId: string
  expectedRevision?: number
}

export type RemotionShotRecipe =
  | 'title-card'
  | 'media-zoom'
  | 'split-reveal'
  | 'paper-title-card'
  | 'deck-deal-flyin'
  | 'row-embed'
  | 'space-camera-moves'
  | 'card-flip-reveal'
  | 'mosaic-reframe'

export interface RemotionSceneShot {
  id: string
  recipe: RemotionShotRecipe
  from: number
  durationInFrames: number
  mediaIds: string[]
  text?: Record<string, string>
}

export interface RemotionSceneSpec {
  version: 1
  composition: 'shotcraft-promo'
  width: number
  height: number
  fps: number
  durationInFrames: number
  shots: RemotionSceneShot[]
}

export interface RemotionRenderTaskResult {
  artifactId: string
  outputPath: string
  manifestPath: string
  fileSize: number
  sha256: string
  mimeType: 'video/mp4'
  projectId?: string
  clipId?: string
  sourceRevision?: number
  sourceHash?: string
}

export interface RemotionRenderTask {
  taskId: string
  status: RemotionRenderStatus
  progress: number
  createdAt: string
  updatedAt: string
  result?: RemotionRenderTaskResult
  error?: string
  projectId?: string
  clipId?: string
  sourceRevision?: number
  sourceHash?: string
  kind?: 'preview' | 'render' | 'legacy'
}

export interface RemotionApi {
  start(scene: RemotionSceneSpec, projectId?: string): Promise<RemotionRenderTask>
  getTask(taskId: string, projectId?: string): Promise<RemotionRenderTask | null>
  cancel(taskId: string, projectId?: string): Promise<RemotionRenderTask | null>
  createClip(projectId: string, input?: RemotionClipCreateInput): Promise<RemotionClip>
  listClips(projectId: string): Promise<RemotionClip[]>
  getClip(projectId: string, clipId: string): Promise<RemotionClip | null>
  readSource(projectId: string, clipId: string): Promise<RemotionSourceSnapshot>
  updateSource(request: RemotionSourceUpdateRequest): Promise<RemotionClip>
  preview(request: RemotionClipRequest): Promise<RemotionRenderTask>
  render(request: RemotionClipRequest): Promise<RemotionRenderTask>
}
