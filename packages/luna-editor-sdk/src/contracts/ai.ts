import type { JobId, JsonObject, MediaId, OperationResult, ProjectId, RangeInput } from "./common.js"
import type { TranscriptSegment } from "./media.js"

export type AiProviderKind = "local" | "remote" | "custom"

export interface AiProvider {
  readonly id: string
  readonly name: string
  readonly kind: AiProviderKind
  readonly capabilities: readonly string[]
  readonly models?: readonly AiModel[]
}

export interface AiModel {
  readonly id: string
  readonly providerId: string
  readonly version?: string
  readonly capabilities: readonly string[]
}

export interface TranscribeRequest {
  readonly projectId?: ProjectId
  readonly mediaId: MediaId
  readonly model?: string
  readonly language?: string
  readonly diarization?: boolean
}

export interface AnalyzeMediaRequest {
  readonly projectId?: ProjectId
  readonly mediaId: MediaId
  readonly kinds: readonly ("scenes" | "captions" | "embeddings" | "faces" | "audio")[]
  readonly model?: string
}

export interface SilenceDetectRequest {
  readonly projectId?: ProjectId
  readonly mediaId: MediaId
  readonly range?: RangeInput
  readonly thresholdDb?: number
  readonly minimumDuration?: number
}

export interface FillerDetectRequest {
  readonly projectId?: ProjectId
  readonly mediaId: MediaId
  readonly language?: string
  readonly words?: readonly string[]
}

export interface SpeechGenerateRequest {
  readonly projectId?: ProjectId
  readonly text: string
  readonly voice?: string
  readonly language?: string
  readonly speed?: number
  readonly params?: JsonObject
}

export interface MusicGenerateRequest {
  readonly projectId?: ProjectId
  readonly prompt: string
  readonly durationSeconds?: number
  readonly model?: string
  readonly seed?: number
  readonly params?: JsonObject
}

export interface AiTaskAccepted {
  /** AI work is tracked by the same job registry as render/export work. */
  readonly jobId: JobId
  readonly kind: string
}

export interface TranscriptResult {
  readonly mediaId: MediaId
  readonly language?: string
  readonly segments: readonly TranscriptSegment[]
}

export interface CandidateRange {
  readonly start: number
  readonly end: number
  readonly reason?: string
  readonly confidence?: number
}

export type AiProvidersResult = OperationResult<readonly AiProvider[]>
export type AiTaskResult = OperationResult<AiTaskAccepted>
export type TranscribeResult = OperationResult<AiTaskAccepted | TranscriptResult>
export type TranscriptResultEnvelope = OperationResult<TranscriptResult>
export type CandidateRangesResult = OperationResult<readonly CandidateRange[]>
