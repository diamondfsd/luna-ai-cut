export type AiSelectionPreset = 'quick' | 'balanced' | 'deep'
export const AI_SELECTION_CONTENT_TAG_VERSION = 'yolo26s-seg+coco80_segformer-b0+ade20k_v2'
export type AiSelectionPurpose = 'general' | 'people' | 'travel' | 'editing'
export type AiSelectionStatus = 'queued' | 'indexing' | 'analyzing' | 'paused' | 'interrupted' | 'ready' | 'completed' | 'failed' | 'canceled'
export type AiSelectionPhase = 'indexing' | 'metadata' | 'photos' | 'grouping' | 'ranking' | 'videos' | 'done'
export type AiMediaQualityGrade = 'excellent' | 'good' | 'fair' | 'review'
export type AiSelectionState = 'recommended' | 'alternative' | 'kept' | 'rejected' | 'undecided'
export type AiSelectionDecisionSource = 'ai' | 'user'
export type AiSelectionConfirmation = 'pending' | 'confirmed' | 'reopened'

export interface AiSelectionSource {
  kind: 'directory' | 'files'
  label: string
  directory?: string
  paths?: string[]
}

export interface AiSelectionTarget {
  mode: 'preset' | 'count' | 'ratio'
  value: number | null
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
  state: AiSelectionState
  decisionSource: AiSelectionDecisionSource
}

export interface AiSelectionFlags {
  lowQuality: boolean
  duplicate: boolean
  closedEyes: boolean
  analysisFailed: boolean
}

export interface AiSelectionScoreDimension {
  raw: number | null
  normalized: number
  weight: number
}

export interface AiSelectionScores {
  quality: AiSelectionScoreDimension
  people: AiSelectionScoreDimension
  composition: AiSelectionScoreDimension
  aesthetics: AiSelectionScoreDimension
  relevance: AiSelectionScoreDimension
  diversity: AiSelectionScoreDimension
  total: number
}

export interface AiSelectionPreferenceProfile {
  sampleCount: number
  weights: Record<keyof Omit<AiSelectionScores, 'total'>, number>
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
  contentTags: string[]
  contentTagVersion: string | null
  contentTagError: string | null
  sceneId: string | null
  groupId: string | null
  recommendationScore: number
  recommendationReason: string | null
  state: AiSelectionState
  decisionSource: AiSelectionDecisionSource
  flags: AiSelectionFlags
  scores: AiSelectionScores
  error: string | null
}

export interface AiSelectionScene {
  id: string
  name: string
  startAt: string
  endAt: string
  itemIds: string[]
  coverItemId: string
  confirmation: AiSelectionConfirmation
  recommendedCount: number
  userModified: boolean
}

export interface AiSelectionGroup {
  id: string
  sceneId: string
  kind: 'duplicate' | 'burst' | 'similar' | 'singleton'
  itemIds: string[]
  representativeId: string
  reason: string
  confidence: number
  suggestedKeepCount: number
  confirmation: AiSelectionConfirmation
  userModified: boolean
}

export interface AiSelectionCounts {
  total: number
  completed: number
  failed: number
  recommended: number
  attention: number
  kept: number
  rejected: number
  undecided: number
}

export interface AiSelectionWorkspaceCreation {
  status: 'idle' | 'creating' | 'created' | 'failed'
  projectId: string | null
  error: string | null
}

export interface AiSelectionSession {
  schemaVersion: 1
  analysisVersion: string
  id: string
  name: string
  source: AiSelectionSource
  preset: AiSelectionPreset
  purpose: AiSelectionPurpose
  target: AiSelectionTarget
  status: AiSelectionStatus
  phase: AiSelectionPhase
  revision: number
  createdAt: string
  updatedAt: string
  counts: AiSelectionCounts
  items: AiSelectionItem[]
  scenes: AiSelectionScene[]
  groups: AiSelectionGroup[]
  preferenceProfile: AiSelectionPreferenceProfile
  workspaceCreation: AiSelectionWorkspaceCreation
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
  | { type: 'set-preset'; preset: AiSelectionPreset }
  | { type: 'set-purpose'; purpose: AiSelectionPurpose }
  | { type: 'set-target'; target: AiSelectionTarget }
  | { type: 'set-state'; itemId: string; state: AiSelectionState }
  | { type: 'set-video-segment-state'; itemId: string; segmentId: string; state: AiSelectionState }
  | { type: 'set-representative'; groupId: string; itemId: string }
  | { type: 'confirm-group'; groupId: string }
  | { type: 'confirm-scene'; sceneId: string }
  | { type: 'reopen-scene'; sceneId: string }

export interface AiSelectionStartRequest {
  name?: string
  source: AiSelectionSource
  preset: AiSelectionPreset
  purpose?: AiSelectionPurpose
  target?: AiSelectionTarget
}
