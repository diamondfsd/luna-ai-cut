/**
 * Internal contracts for the review-first AI editor. These objects are kept
 * independent from a particular language model transport and never expose
 * source frames, audio bytes, local paths, or credentials to the model.
 */

export type AiEditingToolRisk = 'read' | 'analysis' | 'edit' | 'settings'

export interface AiEditingToolResult {
  ok: boolean
  message: string
  data?: unknown
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
  execute(args: Record<string, unknown>): Promise<AiEditingToolResult> | AiEditingToolResult
}

export interface AiEditingToolCall {
  id: string
  args: Record<string, unknown>
}

export interface AiEditingObservation {
  toolId: string
  result: AiEditingToolResult
}

export interface AiEditingPlanStep {
  toolId: string
  args: Record<string, unknown>
  summary: string
  risk: Exclude<AiEditingToolRisk, 'read'>
}

export interface AiEditingPlan {
  id: string
  title: string
  summary: string
  timelineRevision: number
  steps: AiEditingPlanStep[]
  createdAt: number
}

export interface AiEditingResponse {
  reply: string
  toolCalls: AiEditingToolCall[]
}

export interface AiTimelineClipEvidence {
  id: string
  label: string
  type: string
  trackId: string
  startSeconds: number
  endSeconds: number
  mediaId?: string
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
  clips: AiTimelineClipEvidence[]
  media: AiMediaEvidence[]
}
