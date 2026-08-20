import type { AiTaskAccepted } from "./ai.js"
import type { JsonObject, JobId, OperationResult, ProjectId } from "./common.js"

export type JobStatus = "queued" | "running" | "paused" | "canceling" | "completed" | "failed" | "canceled" | "interrupted"

export type JobKind = "render" | "transcription" | "analysis" | "speech" | "music" | "custom"

export interface JobProgress {
  readonly value: number
  readonly label?: string
  readonly current?: number
  readonly total?: number
}

export interface JobError {
  readonly code: string
  readonly message: string
  readonly retryable?: boolean
}

export interface Job<TResult = unknown> {
  readonly jobId: JobId
  readonly kind: JobKind
  readonly status: JobStatus
  readonly projectId?: ProjectId
  readonly createdAt: string
  readonly updatedAt: string
  readonly progress?: JobProgress
  readonly result?: TResult
  readonly error?: JobError
  readonly metadata?: JsonObject
}

export interface GetJobRequest {
  readonly jobId: JobId
}

export interface ListJobsRequest {
  readonly projectId?: ProjectId
  readonly status?: JobStatus | readonly JobStatus[]
  readonly kind?: JobKind
  readonly limit?: number
}

export interface CancelJobRequest {
  readonly jobId: JobId
}

export interface RetryJobRequest {
  readonly jobId: JobId
}

export interface WaitJobRequest {
  readonly jobId: JobId
  readonly timeoutMs?: number
}

export type JobResult<TResult = unknown> = OperationResult<Job<TResult> | null>
export type JobListResult = OperationResult<readonly Job[]>
export type AcceptedTaskResult = OperationResult<AiTaskAccepted>
