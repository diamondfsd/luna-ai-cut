import type { JsonObject, MutationRequest, OperationResult, ProjectId, Revision, Timecode } from "./common.js"

export interface ProjectCanvas {
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly pixelAspectRatio?: number
  readonly backgroundColor?: string
}

export interface ProjectSummary {
  readonly id: ProjectId
  readonly name: string
  readonly revision?: Revision
  readonly duration?: Timecode
  readonly canvas?: ProjectCanvas
}

export interface ProjectSnapshot extends ProjectSummary {
  readonly schemaVersion?: string | number
  readonly data: JsonObject
}

export interface ProjectInspectRequest {
  readonly projectId?: ProjectId
  readonly includeTimeline?: boolean
  readonly includeMedia?: boolean
}

export interface ProjectCreateRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly name: string
  readonly canvas?: ProjectCanvas
}

export interface ProjectUpdateRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly name?: string
  readonly canvas?: Partial<ProjectCanvas>
  readonly metadata?: JsonObject
}

export interface ProjectSaveRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly snapshot?: ProjectSnapshot
}

export type ProjectInspectResult = OperationResult<ProjectSnapshot | null>
export type ProjectCreateResult = OperationResult<ProjectSummary>
export type ProjectUpdateResult = OperationResult<ProjectSummary>
export type ProjectSaveResult = OperationResult<ProjectSummary>
