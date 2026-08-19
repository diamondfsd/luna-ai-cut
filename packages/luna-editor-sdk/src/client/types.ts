import type {
  AddClipRequest,
  AddEffectRequest,
  AddKeyframeRequest,
  AddTextRequest,
  AddTrackRequest,
  AddTransitionRequest,
  ClipMutationResult,
  DeleteClipRequest,
  EffectMutationResult,
  KeyframeMutationResult,
  MoveClipRequest,
  RemoveEffectRequest,
  RemoveKeyframeRequest,
  RemoveTrackRequest,
  RemoveTransitionRequest,
  SetAudioRequest,
  SetTransformRequest,
  SplitClipRequest,
  TimelineInspectRequest,
  TimelineInspectResult,
  TimelineEditRequest,
  TimelineEditResult,
  TrackMutationResult,
  TrimClipRequest,
  TransitionMutationResult,
  UpdateClipRequest,
  UpdateEffectRequest,
  UpdateKeyframeRequest,
  UpdateTrackRequest,
  UpdateTransitionRequest,
} from "../contracts/timeline.js"
import type {
  AiProvidersResult,
  AiTaskResult,
  AnalyzeMediaRequest,
  CandidateRangesResult,
  FillerDetectRequest,
  MusicGenerateRequest,
  SilenceDetectRequest,
  SpeechGenerateRequest,
  TranscribeRequest,
  TranscribeResult,
} from "../contracts/ai.js"
import type {
  CapabilitiesListRequest,
  CapabilitiesListResult,
  CapabilityDescribeRequest,
  CapabilityDescribeResult,
} from "../contracts/capabilities.js"
import type { RequestContext, RequestOptions, OperationResult } from "../contracts/common.js"
import type {
  CancelJobRequest,
  GetJobRequest,
  JobListResult,
  JobResult,
  ListJobsRequest,
  RetryJobRequest,
  WaitJobRequest,
} from "../contracts/jobs.js"
import type {
  MediaAnalyzeRequest,
  MediaAnalyzeResult,
  MediaListRequest,
  MediaListResult,
  MediaReadRequest,
  MediaReadResult,
  MediaTranscriptSearchRequest,
  MediaTranscriptSearchResult,
} from "../contracts/media.js"
import type {
  ProjectCreateRequest,
  ProjectCreateResult,
  ProjectInspectRequest,
  ProjectInspectResult,
  ProjectSaveRequest,
  ProjectSaveResult,
  ProjectUpdateRequest,
  ProjectUpdateResult,
} from "../contracts/project.js"
import type {
  PreviewCaptureFrameRequest,
  PreviewCaptureFrameResult,
  PreviewInspectRequest,
  PreviewLayoutRequest,
  PreviewLayoutResult,
  PreviewSeekRequest,
  PreviewSeekResult,
  PreviewStateResult,
} from "../contracts/preview.js"
import type {
  RenderExportRequest,
  RenderExportResult,
  RenderFrameRequest,
  RenderFrameResult,
  RenderPreflightRequest,
  RenderPreflightResult,
} from "../contracts/render.js"
import type { LunaTransport } from "../transport/transport.js"

export type ClientCall = <TParams, TData>(
  method: string,
  params: TParams,
  options?: RequestOptions,
) => Promise<OperationResult<TData>>

export interface ProjectClient {
  inspect(request?: ProjectInspectRequest, options?: RequestOptions): Promise<ProjectInspectResult>
  create(request: ProjectCreateRequest, options?: RequestOptions): Promise<ProjectCreateResult>
  update(request: ProjectUpdateRequest, options?: RequestOptions): Promise<ProjectUpdateResult>
  save(request?: ProjectSaveRequest, options?: RequestOptions): Promise<ProjectSaveResult>
}

export interface MediaClient {
  list(request?: MediaListRequest, options?: RequestOptions): Promise<MediaListResult>
  read(request: MediaReadRequest, options?: RequestOptions): Promise<MediaReadResult>
  analyze(request: MediaAnalyzeRequest, options?: RequestOptions): Promise<MediaAnalyzeResult>
  searchTranscript(request: MediaTranscriptSearchRequest, options?: RequestOptions): Promise<MediaTranscriptSearchResult>
}

export interface TimelineTrackClient {
  add(request: AddTrackRequest, options?: RequestOptions): Promise<TrackMutationResult>
  update(request: UpdateTrackRequest, options?: RequestOptions): Promise<TrackMutationResult>
  remove(request: RemoveTrackRequest, options?: RequestOptions): Promise<TrackMutationResult>
}

export interface TimelineClipClient {
  add(request: AddClipRequest, options?: RequestOptions): Promise<ClipMutationResult>
  update(request: UpdateClipRequest, options?: RequestOptions): Promise<ClipMutationResult>
  move(request: MoveClipRequest, options?: RequestOptions): Promise<ClipMutationResult>
  delete(request: DeleteClipRequest, options?: RequestOptions): Promise<ClipMutationResult>
  split(request: SplitClipRequest, options?: RequestOptions): Promise<ClipMutationResult>
  trim(request: TrimClipRequest, options?: RequestOptions): Promise<ClipMutationResult>
  setTransform(request: SetTransformRequest, options?: RequestOptions): Promise<ClipMutationResult>
  setAudio(request: SetAudioRequest, options?: RequestOptions): Promise<ClipMutationResult>
}

export interface TimelineEffectClient {
  add(request: AddEffectRequest, options?: RequestOptions): Promise<EffectMutationResult>
  update(request: UpdateEffectRequest, options?: RequestOptions): Promise<EffectMutationResult>
  remove(request: RemoveEffectRequest, options?: RequestOptions): Promise<EffectMutationResult>
}

export interface TimelineKeyframeClient {
  add(request: AddKeyframeRequest, options?: RequestOptions): Promise<KeyframeMutationResult>
  update(request: UpdateKeyframeRequest, options?: RequestOptions): Promise<KeyframeMutationResult>
  remove(request: RemoveKeyframeRequest, options?: RequestOptions): Promise<KeyframeMutationResult>
}

export interface TimelineTransitionClient {
  add(request: AddTransitionRequest, options?: RequestOptions): Promise<TransitionMutationResult>
  update(request: UpdateTransitionRequest, options?: RequestOptions): Promise<TransitionMutationResult>
  remove(request: RemoveTransitionRequest, options?: RequestOptions): Promise<TransitionMutationResult>
}

export interface TimelineClient {
  inspect(request?: TimelineInspectRequest, options?: RequestOptions): Promise<TimelineInspectResult>
  edit(request: TimelineEditRequest, options?: RequestOptions): Promise<TimelineEditResult>
  readonly tracks: TimelineTrackClient
  readonly clips: TimelineClipClient
  readonly effects: TimelineEffectClient
  readonly keyframes: TimelineKeyframeClient
  readonly transitions: TimelineTransitionClient
  addText(request: AddTextRequest, options?: RequestOptions): Promise<ClipMutationResult>
}

export interface PreviewClient {
  inspect(request?: PreviewInspectRequest, options?: RequestOptions): Promise<PreviewStateResult>
  seek(request: PreviewSeekRequest, options?: RequestOptions): Promise<PreviewSeekResult>
  captureFrame(request?: PreviewCaptureFrameRequest, options?: RequestOptions): Promise<PreviewCaptureFrameResult>
  layout(request?: PreviewLayoutRequest, options?: RequestOptions): Promise<PreviewLayoutResult>
}

export interface RenderClient {
  preflight(request?: RenderPreflightRequest, options?: RequestOptions): Promise<RenderPreflightResult>
  frame(request: RenderFrameRequest, options?: RequestOptions): Promise<RenderFrameResult>
  export(request?: RenderExportRequest, options?: RequestOptions): Promise<RenderExportResult>
}

export interface AiClient {
  listProviders(options?: RequestOptions): Promise<AiProvidersResult>
  transcribe(request: TranscribeRequest, options?: RequestOptions): Promise<TranscribeResult>
  analyze(request: AnalyzeMediaRequest, options?: RequestOptions): Promise<AiTaskResult>
  detectSilence(request: SilenceDetectRequest, options?: RequestOptions): Promise<CandidateRangesResult>
  detectFillers(request: FillerDetectRequest, options?: RequestOptions): Promise<CandidateRangesResult>
  generateSpeech(request: SpeechGenerateRequest, options?: RequestOptions): Promise<AiTaskResult>
  generateMusic(request: MusicGenerateRequest, options?: RequestOptions): Promise<AiTaskResult>
}

export interface JobsClient {
  get(request: GetJobRequest, options?: RequestOptions): Promise<JobResult>
  list(request?: ListJobsRequest, options?: RequestOptions): Promise<JobListResult>
  wait(request: WaitJobRequest, options?: RequestOptions): Promise<JobResult>
  cancel(request: CancelJobRequest, options?: RequestOptions): Promise<JobResult>
  retry(request: RetryJobRequest, options?: RequestOptions): Promise<JobResult>
}

export interface CapabilitiesClient {
  list(request?: CapabilitiesListRequest, options?: RequestOptions): Promise<CapabilitiesListResult>
  describe(request: CapabilityDescribeRequest, options?: RequestOptions): Promise<CapabilityDescribeResult>
}

export interface LunaClientOptions {
  readonly transport?: LunaTransport
  readonly endpoint?: string
  readonly token?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly context?: RequestContext
  readonly defaultTimeoutMs?: number
  readonly requestIdFactory?: () => string
}

export interface LunaClient {
  readonly transport: LunaTransport
  readonly request: ClientCall
  readonly project: ProjectClient
  readonly media: MediaClient
  readonly timeline: TimelineClient
  readonly preview: PreviewClient
  readonly render: RenderClient
  readonly ai: AiClient
  readonly jobs: JobsClient
  readonly capabilities: CapabilitiesClient
  close(): void
}
