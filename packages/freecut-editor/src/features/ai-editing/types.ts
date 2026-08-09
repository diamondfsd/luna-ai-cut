/**
 * Internal contracts for the AI editor. These objects are kept independent
 * from a particular language model transport and never expose source frames,
 * audio bytes, local paths, or credentials to the model.
 */

export type AiEditingToolRisk = 'read' | 'analysis' | 'edit' | 'settings'

export interface AiEditingToolResult {
  ok: boolean
  message: string
  data?: unknown
}

export interface AiEditingToolProgress {
  label: string
  percent: number | null
}

export interface AiEditingRunProgress {
  label: string
  percent: number
  /** UI may advance gradually to this bound while waiting for the next real event. */
  ceiling?: number
}

export interface AiEditingToolExecutionContext {
  signal?: AbortSignal
  reportProgress(progress: AiEditingToolProgress): void
}

export type AiEditingToolValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

export interface AiEditingTool {
  id: string
  title: string
  description: string
  risk: AiEditingToolRisk
  /** Most timeline actions are synchronous and can share a single undo step. */
  execution: 'sync' | 'async'
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
  validate(args: unknown): AiEditingToolValidation
  summarize(args: Record<string, unknown>): string
  execute(
    args: Record<string, unknown>,
    context?: AiEditingToolExecutionContext,
  ): Promise<AiEditingToolResult> | AiEditingToolResult
}

/**
 * Shared context passed to every dynamically discovered tool module. The
 * catalog is populated after all modules have contributed their tools, so a
 * discovery tool can always inspect the complete registry when it executes.
 */
export interface AiEditingToolRegistryContext {
  listTools(): readonly AiEditingTool[]
}

/** A capability-domain module discovered by the editor bundle at build time. */
export interface AiEditingToolModule {
  createTools(context: AiEditingToolRegistryContext): AiEditingTool[]
}

export interface AiEditingToolCall {
  id: string
  args: Record<string, unknown>
}

export interface AiEditingObservation {
  toolId: string
  result: AiEditingToolResult
}

export interface AiEditingToolActivity {
  id: string
  toolId: string
  title: string
  status: 'running' | 'succeeded' | 'failed'
  message?: string
  progressLabel?: string
  progressPercent?: number | null
}

export interface AiEditingResponse {
  reply: string
  toolCalls: AiEditingToolCall[]
}

export interface AiTimelineClipEvidence {
  id: string
  ref?: string
  label: string
  type: string
  trackId: string
  startSeconds: number
  endSeconds: number
  mediaId?: string
  selected?: boolean
  linkedGroupId?: string
  sourceStartSeconds?: number
  sourceEndSeconds?: number
  speed?: number
  reversed?: boolean
  volumeDb?: number
  text?: string
  crop?: { left: number; right: number; top: number; bottom: number }
  transform?: {
    x?: number
    y?: number
    width?: number
    height?: number
    rotation?: number
    opacity?: number
  }
  effectCount?: number
  hasMotion?: boolean
}

export interface AiMediaEvidence {
  mediaId: string
  name: string
  kind: 'video' | 'audio' | 'image' | 'other'
  durationSeconds: number
  sourceFingerprint: string
  visual: Array<{
    timeSeconds: number
    description: string
    subjects: string[]
    action?: string
  }>
  visualModels?: Array<{ id: string; version: string }>
  transcript?: {
    language?: string
    segmentCount: number
    wordCount: number
    updatedAt: number
    service?: string
    modelId?: string
    modelVersion?: string
  }
  audio: {
    beatStatus: 'not-requested' | 'running' | 'ready' | 'unavailable'
  }
}

export interface AiProjectEvidence {
  timelineRevision: number
  fps: number
  durationSeconds: number
  playheadSeconds?: number
  selection?: {
    itemIds: string[]
    trackIds: string[]
    activeTrackId: string | null
    type: 'item' | 'track' | 'marker' | 'transition' | null
  }
  clips: AiTimelineClipEvidence[]
  tracks: Array<{
    id: string
    name: string
    kind: 'video' | 'audio' | 'subtitle' | 'other'
    order: number
    locked: boolean
    syncLock?: boolean
    visible?: boolean
    muted?: boolean
    solo?: boolean
    volumeDb?: number
  }>
  media: AiMediaEvidence[]
}
