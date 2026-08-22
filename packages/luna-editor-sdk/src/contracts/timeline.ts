import type {
  ClipId,
  EntityId,
  JsonObject,
  MediaId,
  MutationRequest,
  OperationResult,
  ProjectId,
  Timecode,
  TrackId,
} from "./common.js"

export type TimelineItemType =
  | "video"
  | "audio"
  | "image"
  | "text"
  | "shape"
  | "subtitle"
  | "lottie"
  | "adjustment"
  | "controller"
  | "composition"

export type TrackType = "video" | "audio" | "overlay" | "subtitle" | "group"

export interface TimelineTrack {
  readonly id: TrackId
  readonly name: string
  readonly type: TrackType
  readonly index: number
  readonly muted?: boolean
  readonly solo?: boolean
  readonly locked?: boolean
  readonly volumeDb?: number
}

export interface TimelineClip {
  readonly id: ClipId
  readonly trackId: TrackId
  readonly type: TimelineItemType
  readonly name?: string
  readonly mediaId?: MediaId
  readonly start: Timecode
  readonly duration: Timecode
  readonly sourceStart?: Timecode
  readonly sourceDuration?: Timecode
  readonly speed?: number
  readonly reverse?: boolean
  readonly properties?: JsonObject
  readonly effects?: readonly EffectInstance[]
  readonly keyframes?: readonly Keyframe[]
}

export interface TimelineSnapshot {
  readonly projectId: ProjectId
  readonly fps: number
  readonly duration: Timecode
  readonly tracks: readonly TimelineTrack[]
  readonly clips: readonly TimelineClip[]
  readonly transitions: readonly Transition[]
  readonly markers?: readonly TimelineMarker[]
}

export interface TimelineInspectRequest {
  readonly projectId?: ProjectId
  readonly trackIds?: readonly TrackId[]
  readonly clipIds?: readonly ClipId[]
  readonly includeEffects?: boolean
  readonly includeKeyframes?: boolean
}

export interface TimelineEditRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly ops: readonly JsonObject[]
}

export interface AddTrackRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly type: TrackType
  readonly name?: string
  readonly index?: number
}

export interface UpdateTrackRequest extends MutationRequest {
  readonly trackId: TrackId
  readonly projectId?: ProjectId
  readonly name?: string
  readonly muted?: boolean
  readonly solo?: boolean
  readonly locked?: boolean
  readonly volumeDb?: number
}

export interface RemoveTrackRequest extends MutationRequest {
  readonly trackId: TrackId
  readonly projectId?: ProjectId
}

export interface AddClipRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly trackId: TrackId
  readonly type: TimelineItemType
  readonly mediaId?: MediaId
  readonly start: Timecode
  readonly duration: Timecode
  readonly sourceStart?: Timecode
  readonly sourceDuration?: Timecode
  readonly properties?: JsonObject
}

export interface UpdateClipRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly properties?: JsonObject
  readonly start?: Timecode
  readonly duration?: Timecode
  readonly sourceStart?: Timecode
  readonly sourceDuration?: Timecode
  readonly speed?: number
  readonly reverse?: boolean
}

export interface MoveClipRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly trackId?: TrackId
  readonly start: Timecode
}

export type ClipDeleteMode = "remove" | "ripple" | "lift"

export interface DeleteClipRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly mode?: ClipDeleteMode
}

export interface SplitClipRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly at: Timecode
}

export type TrimEdge = "start" | "end"
export type TrimMode = "normal" | "ripple" | "rolling" | "slip" | "slide"

export interface TrimClipRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly edge: TrimEdge
  readonly amount: Timecode
  readonly mode?: TrimMode
}

export interface SetTransformRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly transform: JsonObject
  readonly autoKeyframe?: boolean
}

export interface SetAudioRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly audio: JsonObject
}

export interface AddTextRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly trackId: TrackId
  readonly start: Timecode
  readonly duration: Timecode
  readonly text: string
  readonly style?: JsonObject
  /** Normalized horizontal center position of the text box, from 0 (left) to 1 (right). */
  readonly x?: number
  /** Normalized vertical center position of the text box, from 0 (top) to 1 (bottom). */
  readonly y?: number
  /** Normalized text box width as a fraction of the canvas width. */
  readonly width?: number
  /** Normalized text box height as a fraction of the canvas height. */
  readonly height?: number
  readonly rotation?: number
  readonly opacity?: number
  readonly flipHorizontal?: boolean
  readonly flipVertical?: boolean
  readonly cornerRadius?: number
}

export interface EffectInstance {
  readonly id: EntityId
  readonly type: string
  readonly enabled: boolean
  readonly params: JsonObject
}

export interface AddEffectRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly type: string
  readonly params?: JsonObject
  readonly enabled?: boolean
}

export interface UpdateEffectRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly effectId: EntityId
  readonly projectId?: ProjectId
  readonly params?: JsonObject
  readonly enabled?: boolean
}

export interface RemoveEffectRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly effectId: EntityId
  readonly projectId?: ProjectId
}

export type KeyframeValue = number | readonly number[] | JsonObject

export interface Keyframe {
  readonly id: EntityId
  readonly property: string
  readonly at: Timecode
  readonly value: KeyframeValue
  readonly easing?: string
  readonly interpolation?: "linear" | "bezier" | "hold" | "spring"
}

export interface AddKeyframeRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly projectId?: ProjectId
  readonly property: string
  readonly at: Timecode
  readonly value: KeyframeValue
  readonly easing?: string
  readonly interpolation?: Keyframe["interpolation"]
}

export interface UpdateKeyframeRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly keyframeId: EntityId
  readonly projectId?: ProjectId
  readonly at?: Timecode
  readonly value?: KeyframeValue
  readonly easing?: string
  readonly interpolation?: Keyframe["interpolation"]
}

export interface RemoveKeyframeRequest extends MutationRequest {
  readonly clipId: ClipId
  readonly keyframeId: EntityId
  readonly projectId?: ProjectId
}

export interface Transition {
  readonly id: EntityId
  readonly type: string
  readonly fromClipId: ClipId
  readonly toClipId: ClipId
  readonly duration: Timecode
  readonly direction?: string
  readonly properties?: JsonObject
}

export interface AddTransitionRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly fromClipId: ClipId
  readonly toClipId: ClipId
  readonly type: string
  readonly duration: Timecode
  readonly direction?: string
  readonly properties?: JsonObject
}

export interface UpdateTransitionRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly transitionId: EntityId
  readonly type?: string
  readonly duration?: Timecode
  readonly direction?: string
  readonly properties?: JsonObject
}

export interface RemoveTransitionRequest extends MutationRequest {
  readonly projectId?: ProjectId
  readonly transitionId: EntityId
}

export interface TimelineMarker {
  readonly id: EntityId
  readonly at: Timecode
  readonly name?: string
  readonly color?: string
}

export type TimelineInspectResult = OperationResult<TimelineSnapshot>
export type TimelineEditResult = OperationResult<unknown>
export type TrackMutationResult = OperationResult<TimelineTrack>
export type ClipMutationResult = OperationResult<TimelineClip>
export type EffectMutationResult = OperationResult<EffectInstance>
export type KeyframeMutationResult = OperationResult<Keyframe>
export type TransitionMutationResult = OperationResult<Transition>
