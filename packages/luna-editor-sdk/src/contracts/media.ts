import type { JsonObject, MediaId, MutationRequest, OperationResult, ProjectId, RangeInput } from "./common.js"

export type MediaKind = "video" | "audio" | "image" | "gif" | "svg" | "lottie" | "unknown"

export interface MediaAsset {
  readonly id: MediaId
  readonly name: string
  readonly kind: MediaKind
  readonly uri?: string
  readonly duration?: number
  readonly width?: number
  readonly height?: number
  readonly fps?: number
  readonly sampleRate?: number
  readonly channels?: number
  readonly metadata?: JsonObject
}

export interface MediaListRequest {
  readonly projectId?: ProjectId
  readonly kind?: MediaKind
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

export interface MediaReadRequest {
  readonly mediaId: MediaId
  readonly projectId?: ProjectId
  readonly range?: RangeInput
}

export type MediaAnalysisKind = "metadata" | "transcript" | "scenes" | "captions" | "embeddings" | "faces" | "audio"

export interface MediaAnalyzeRequest extends MutationRequest {
  readonly mediaId: MediaId
  readonly projectId?: ProjectId
  readonly kinds: readonly MediaAnalysisKind[]
  readonly model?: string
  readonly language?: string
}

export interface MediaTranscriptSearchRequest {
  readonly projectId?: ProjectId
  readonly mediaId?: MediaId
  readonly query: string
  readonly limit?: number
}

export interface MediaListResult extends OperationResult<readonly MediaAsset[]> {}
export type MediaReadResult = OperationResult<MediaAsset | null>
export type MediaAnalyzeResult = OperationResult<{ readonly jobId: string; readonly acceptedKinds: readonly MediaAnalysisKind[] }>
export type MediaTranscriptSearchResult = OperationResult<readonly TranscriptMatch[]>

export interface TranscriptWord {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly confidence?: number
}

export interface TranscriptSegment {
  readonly id: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly confidence?: number
  readonly words?: readonly TranscriptWord[]
}

export interface TranscriptMatch {
  readonly mediaId: MediaId
  readonly segmentId?: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly score?: number
}
