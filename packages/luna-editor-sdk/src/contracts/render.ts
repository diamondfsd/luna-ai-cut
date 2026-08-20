import type { JsonObject, OperationResult, ProjectId, RangeInput } from "./common.js"
import type { Job } from "./jobs.js"

export type RenderFormat = "mp4" | "webm" | "mov" | "wav" | "png" | "jpeg" | "webp"
export type SubtitleRenderMode = "off" | "burn" | "sidecar" | "embedded"

export interface RenderCapabilities {
  readonly formats: readonly RenderFormat[]
  readonly subtitleModes: readonly SubtitleRenderMode[]
  readonly gpu: boolean
  readonly audio: boolean
}

export interface RenderPreflightRequest {
  readonly projectId?: ProjectId
  readonly format?: RenderFormat
  readonly subtitleMode?: SubtitleRenderMode
  readonly range?: RangeInput
}

export interface RenderIssue {
  readonly severity: "error" | "warning"
  readonly code: string
  readonly message: string
  readonly entityIds?: readonly string[]
}

export interface RenderPreflight {
  readonly ready: boolean
  readonly capabilities: RenderCapabilities
  readonly issues: readonly RenderIssue[]
}

export interface RenderFrameRequest {
  readonly projectId?: ProjectId
  /** Explicitly seconds or frames; adapters must not infer the unit. */
  readonly at: import("./common.js").Timecode
  readonly format?: Extract<RenderFormat, "png" | "jpeg" | "webp">
  readonly scale?: number
}

export interface RenderExportRequest {
  readonly projectId?: ProjectId
  readonly format?: RenderFormat
  readonly subtitleMode?: SubtitleRenderMode
  readonly range?: RangeInput
  readonly outputUri?: string
  readonly settings?: JsonObject
}

export interface RenderFrame {
  readonly uri: string
  readonly format: Extract<RenderFormat, "png" | "jpeg" | "webp">
  readonly width: number
  readonly height: number
  readonly at: import("./common.js").Timecode
}

export type RenderPreflightResult = OperationResult<RenderPreflight>
export type RenderFrameResult = OperationResult<RenderFrame>
export type RenderExportResult = OperationResult<Job>
