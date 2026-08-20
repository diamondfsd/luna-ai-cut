export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined
}

export type EntityId = string
export type ProjectId = string
export type MediaId = string
export type TrackId = string
export type ClipId = string
export type JobId = string
export type Revision = string

export interface TimecodeSeconds {
  readonly seconds: number
}

export interface TimecodeFrames {
  readonly frames: number
  readonly fps?: number
}

export type Timecode = TimecodeSeconds | TimecodeFrames

export interface RangeInput {
  readonly start: Timecode
  readonly end?: Timecode
  readonly duration?: Timecode
}

export interface RequestContext {
  readonly sessionId?: string
  readonly projectId?: ProjectId
  readonly clientId?: string
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export interface OperationResult<TData> {
  readonly data: TData
  readonly operationId: string
  readonly revision?: Revision
  readonly affectedIds: readonly EntityId[]
  readonly createdIds: readonly EntityId[]
  readonly removedIds: readonly EntityId[]
  readonly warnings: readonly string[]
}

export interface OperationResultInput<TData> {
  readonly data: TData
  readonly operationId?: string
  readonly revision?: Revision
  readonly affectedIds?: readonly EntityId[]
  readonly createdIds?: readonly EntityId[]
  readonly removedIds?: readonly EntityId[]
  readonly warnings?: readonly string[]
}

export interface MutationRequest {
  readonly expectedRevision?: Revision
  readonly force?: boolean
}
