export type AiSelectionMode = 'quick' | 'balanced' | 'deep'
export type AiSelectionPurpose = 'general' | 'people' | 'travel' | 'editing'
export type AiSelectionWorkflow = 'assist' | 'auto'
export type AiSelectionStatus = 'queued' | 'indexing' | 'analyzing' | 'paused' | 'interrupted' | 'completed' | 'failed' | 'canceled'
export type AiSelectionPhase = 'indexing' | 'metadata' | 'photos' | 'grouping' | 'ranking' | 'videos' | 'done'
export type AiMediaQualityGrade = 'excellent' | 'good' | 'fair' | 'review'

export interface AiSelectionSource {
  kind: 'directory' | 'files'
  label: string
  directory?: string
  paths?: string[]
}

export interface AiMediaQualityMetrics {
  score: number
  grade: AiMediaQualityGrade
  reasons: string[]
  luminanceMean: number
  darkRatio: number
  brightRatio: number
  contrast: number
  edgeScore: number
  entropy: number
}

export interface AiPersonEvidence {
  detected: boolean
  coverage: number
  confidence: number
  subjectEdgeScore: number | null
  bounds: { x: number; y: number; width: number; height: number } | null
  faceCount: number
  primaryFaceBounds: { x: number; y: number; width: number; height: number } | null
  faceVisibility: 'clear' | 'small' | 'occluded' | 'none' | 'unknown'
  eyeState: 'open' | 'closed' | 'mixed' | 'unknown'
  closedEyeConfidence: number | null
  reason: string
}

export interface AiVideoKeyframe {
  id: string
  time: number
  thumbnailUrl: string
  quality: AiMediaQualityMetrics
  semanticTags: string[]
  changeScore: number | null
}

export interface AiVideoSegment {
  id: string
  startTime: number
  endTime: number
  status: 'usable' | 'review'
  reasons: string[]
  selected: boolean
}

export interface AiSelectionItem {
  id: string
  path: string
  name: string
  kind: 'image' | 'video'
  analysisState: 'pending' | 'ready' | 'failed'
  bytes: number
  mtimeMs: number
  capturedAt: string
  device: string | null
  width: number | null
  height: number | null
  duration: number | null
  thumbnailUrl: string | null
  exactHash: string | null
  perceptualHash: string | null
  luminanceHistogram: number[] | null
  visualSignature: number[] | null
  quality: AiMediaQualityMetrics | null
  personEvidence: AiPersonEvidence | null
  videoKeyframes: AiVideoKeyframe[]
  videoSegments: AiVideoSegment[]
  semanticTags: string[]
  eventId: string | null
  similarityGroupId: string | null
  recommendationScore: number
  recommendationReason: string | null
  selected: boolean
  selectionSource: 'ai' | 'user'
  error: string | null
}

export interface AiShootingEvent {
  id: string
  name: string
  startAt: string
  endAt: string
  itemIds: string[]
  userModified: boolean
}

export interface AiSimilarityGroup {
  id: string
  eventId: string
  kind: 'exact' | 'near'
  itemIds: string[]
  representativeId: string
  reason: string
  confidence: number
  userModified: boolean
}

export interface AiSelectionCounts {
  total: number
  completed: number
  failed: number
  selected: number
}

export interface AiSelectionSession {
  schemaVersion: 1
  analysisVersion: string
  id: string
  name: string
  source: AiSelectionSource
  mode: AiSelectionMode
  purpose: AiSelectionPurpose
  workflow: AiSelectionWorkflow
  status: AiSelectionStatus
  phase: AiSelectionPhase
  revision: number
  createdAt: string
  updatedAt: string
  counts: AiSelectionCounts
  items: AiSelectionItem[]
  events: AiShootingEvent[]
  similarityGroups: AiSimilarityGroup[]
  error: string | null
  canUndo: boolean
  canRedo: boolean
}

export interface AiSelectionProgress {
  sessionId: string
  revision: number
  status: AiSelectionStatus
  phase: AiSelectionPhase
  counts: AiSelectionCounts
  currentLabel: string | null
}

export type AiSelectionUserOperation =
  | { type: 'set-density'; mode: AiSelectionMode }
  | { type: 'set-purpose'; purpose: AiSelectionPurpose }
  | { type: 'set-workflow'; workflow: AiSelectionWorkflow }
  | { type: 'set-selected'; itemId: string; selected: boolean }
  | { type: 'set-video-segment'; itemId: string; segmentId: string; selected: boolean }
  | { type: 'set-representative'; groupId: string; itemId: string }
  | { type: 'rename-event'; eventId: string; name: string }
  | { type: 'merge-events'; eventIds: string[] }
  | { type: 'split-event'; eventId: string; beforeItemId: string }
  | { type: 'remove-from-group'; groupId: string; itemId: string }

export interface AiSelectionStartRequest {
  name?: string
  source: AiSelectionSource
  mode: AiSelectionMode
  purpose?: AiSelectionPurpose
  workflow?: AiSelectionWorkflow
}
