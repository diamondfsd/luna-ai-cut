import type { ClipId, OperationResult, ProjectId, Timecode } from "./common.js"

export interface PreviewState {
  readonly projectId?: ProjectId
  readonly currentTime?: Timecode
  readonly playing: boolean
  readonly playbackRate: number
  readonly proxyEnabled: boolean
}

export interface PreviewInspectRequest {
  readonly projectId?: ProjectId
}

export interface PreviewSeekRequest {
  readonly projectId?: ProjectId
  readonly time: Timecode
}

export interface PreviewCaptureFrameRequest {
  readonly projectId?: ProjectId
  readonly time?: Timecode
  readonly format?: "png" | "jpeg" | "webp"
  readonly scale?: number
}

export interface PreviewFrame {
  readonly uri: string
  readonly format: "png" | "jpeg" | "webp"
  readonly width: number
  readonly height: number
  readonly time?: Timecode
}

export interface PreviewLayoutRequest {
  readonly projectId?: ProjectId
  readonly time?: Timecode
  readonly clipIds?: readonly ClipId[]
}

export interface PreviewLayoutItem {
  readonly clipId: ClipId
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly visible: boolean
  readonly zIndex: number
}

export interface PreviewLayout {
  readonly width: number
  readonly height: number
  readonly items: readonly PreviewLayoutItem[]
}

export type PreviewStateResult = OperationResult<PreviewState>
export type PreviewSeekResult = OperationResult<PreviewState>
export type PreviewCaptureFrameResult = OperationResult<PreviewFrame>
export type PreviewLayoutResult = OperationResult<PreviewLayout>
