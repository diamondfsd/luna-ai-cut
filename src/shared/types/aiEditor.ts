import type { DirectorLanShot, DirectorLanTake } from './directorLab'
import type { WorkspaceMediaAsset } from './workspace'
import type { WorkspaceSubtitleTranscriptionResult } from './subtitles'

export interface AiEditorFileFilter {
  name: string
  extensions: string[]
}

export interface AiEditorFileDialogOptions {
  defaultPath?: string
  filters?: AiEditorFileFilter[]
}

export interface AiEditorProjectSnapshot {
  projectId: string
  projectName: string
  editorDocument: string | null
}

export interface AiEditorProjectSummary {
  projectId: string
  projectName: string
  createdAt: string
  updatedAt: string
}

export interface GeneratedMusicTiming {
  source: 'generated-score'
  bpm: number
  duration: number
  beatTimes: number[]
  downbeats: number[]
  percussionHits: { time: number; pitch: number; velocity: number }[]
}

export interface AiEditorDirectorContext {
  planId: string
  planTitle: string
  mainContent: string
  planSignature: string
  shotId: string
  shotOrder: number
  shotName: string
  attributes: DirectorLanShot['attributes']
  remark: string
  suggestedDurationMs: number
  recipe?: DirectorLanShot['shot_recipe']
  takeId: string
  selectedRange: DirectorLanTake['selected_range']
  markers: DirectorLanTake['markers']
}

export interface AiEditorLocalMedia {
  directorContexts?: AiEditorDirectorContext[]
  musicTiming?: GeneratedMusicTiming
  /** Native renderer recovery only; omitted from public media listings. */
  sourceFingerprint?: string
  sourcePath?: string
  mediaId: string
  name: string
  kind: 'image' | 'video' | 'audio'
  bytes: number
  capturedAt: string | null
  modifiedAt: string
  groupDay: string
  sourceDeviceName?: string
  sourceDeviceId?: string
  duration?: number
}

export interface AiEditorLocalMediaQuery {
  planId?: string
  limit?: number
  from?: string
  to?: string
  kind?: 'image' | 'video' | 'audio'
}

export interface AiEditorLocalMediaMetadata {
  mediaId: string
  name: string
  kind: 'image' | 'video' | 'audio'
  bytes: number
  capturedAt: string | null
  modifiedAt: string
  groupDay: string
  sourceDeviceName?: string
  sourceDeviceId?: string
  extension: string
  mimeType: string
  width: number | null
  height: number | null
  durationSec: number | null
  frameRate: number | null
  frameCount: number | null
  videoCodec: string | null
  audioCodecs: string[]
  formatName: string | null
  raw: {
    ffprobe: {
      streams: unknown[]
      format: Record<string, unknown> | null
      chapters: unknown[]
    } | null
    exif: unknown | null
  }
  error?: string
}

export type AiEditorLocalMediaInspectionMode = 'overview' | 'detail'

export interface AiEditorLocalMediaInspectionOptions {
  /** Requested original-source seconds, at most 12 per media and 60 per request. */
  frameTimes?: Record<string, number[]>
  mode?: AiEditorLocalMediaInspectionMode
  maxWidth?: number
}

export interface AiEditorLocalMediaInspectionFrame {
  timeSec: number
  mimeType: 'image/jpeg'
  base64: string
}

export interface AiEditorLocalMediaInspectionItem {
  directorContexts?: AiEditorDirectorContext[]
  mediaId: string
  name: string
  kind: 'image' | 'video'
  duration?: number
  capturedAt: string | null
  frames: AiEditorLocalMediaInspectionFrame[]
  error?: string
}

export interface AiEditorLocalMediaInspectionResult {
  mode: AiEditorLocalMediaInspectionMode
  maxWidth: number
  items: AiEditorLocalMediaInspectionItem[]
}

export interface AiEditorLocalMediaContactSheetOptions {
  mode?: AiEditorLocalMediaInspectionMode
  maxWidth?: number
  columns?: number
}

export interface AiEditorLocalMediaContactSheetCell {
  mediaId: string
  frameIndex: number
  frameId: string
  timeSec: number
  sheetIndex: number
  x: number
  y: number
  width: number
  height: number
}

export interface AiEditorLocalMediaContactSheetItem {
  directorContexts?: AiEditorDirectorContext[]
  mediaId: string
  name: string
  kind: 'image' | 'video'
  duration?: number
  capturedAt: string | null
  frames: Array<{
    timeSec: number
    mimeType: 'image/jpeg'
    /** Original preview frame used by the renderer to add contact-sheet labels. */
    base64: string
  }>
  error?: string
}

export interface AiEditorLocalMediaContactSheetResult {
  mode: AiEditorLocalMediaInspectionMode
  maxWidth: number
  items: AiEditorLocalMediaContactSheetItem[]
  contactSheet: {
    mimeType: 'image/jpeg'
    base64: string
    width: number
    height: number
    columns: number
    rows: number
    cellWidth: number
    cellHeight: number
    gap: number
    cells: AiEditorLocalMediaContactSheetCell[]
  }
}

export interface AiEditorLocalMediaTranscriptionOptions {
  /** Recognition range start in the original video's timeline. */
  startSec?: number
  /** Recognition range end in the original video's timeline. */
  endSec?: number
  /** Logical chunk length. Long videos are split automatically when needed. */
  chunkDurationSec?: number
  /** Extra recognition context on both sides of each logical chunk. */
  overlapSec?: number
}

export interface AiEditorLocalMediaTranscriptionRange {
  startSec: number
  endSec: number
}

export interface AiEditorLocalMediaTranscriptionChunk {
  index: number
  /** The portion represented by this chunk in the final timeline. */
  startSec: number
  endSec: number
  /** The wider range actually sent to the speech model. */
  recognitionStartSec: number
  recognitionEndSec: number
  cueCount: number
}

export interface AiEditorLocalMediaTranscriptionResult extends WorkspaceSubtitleTranscriptionResult {
  mediaId: string
  name: string
  durationSec: number
  requestedRange: AiEditorLocalMediaTranscriptionRange
  chunkDurationSec: number
  overlapSec: number
  chunks: AiEditorLocalMediaTranscriptionChunk[]
}

export interface AiEditorMcpContent {
  type: 'text' | 'image'
  text?: string
  data?: string
  mimeType?: string
}

export interface AiEditorProjectApi {
  list(): Promise<AiEditorProjectSummary[]>
  create(name: string, assets?: WorkspaceMediaAsset[]): Promise<AiEditorProjectSummary>
  load(projectId: string): Promise<AiEditorProjectSnapshot>
  save(projectId: string, editorDocument: string): Promise<void>
  delete(projectId: string): Promise<void>
  rename(projectId: string, name: string): Promise<AiEditorProjectSummary>
}

export interface AiEditorMcpRequest {
  callId: string
  kind: 'listTools' | 'callTool'
  name?: string
  args?: Record<string, unknown>
}

export interface AiEditorMcpResponse {
  ok: boolean
  result?: unknown
  error?: string
  content?: AiEditorMcpContent[]
}

export const AI_EDITOR_USER_STOPPED_ERROR = {
  code: 'USER_STOPPED',
  message: '用户已停止',
  retryable: false,
  suggestedAction: '不要重试当前任务',
} as const

export function createAiEditorUserStoppedResult(): {
  ok: false
  summary: string
  error: typeof AI_EDITOR_USER_STOPPED_ERROR
} {
  return {
    ok: false,
    summary: AI_EDITOR_USER_STOPPED_ERROR.message,
    error: { ...AI_EDITOR_USER_STOPPED_ERROR },
  }
}

export type AiEditorAgentSessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type AiEditorAgentExportConfirmation = 'idle' | 'pending'

export type AiEditorAgentPhase =
  | 'waiting'
  | 'analyzing_media'
  | 'creating_project'
  | 'importing_media'
  | 'editing'
  | 'captioning'
  | 'saving'
  | 'exporting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AgentTaskPurpose = 'auto' | 'editing' | 'director-plan'

export interface AiEditorAgentSession {
  directorPlanRef?: { planId: string; signature: string }
  purpose?: AgentTaskPurpose
  sessionId: string
  request: string
  revision: number
  projectId: string | null
  status: AiEditorAgentSessionStatus
  phase: AiEditorAgentPhase
  progress: number
  message: string
  createdAt: string
  updatedAt: string
  cancelRequested: boolean
  agentId: string | null
  agentType: string | null
  agentModel: string | null
  exportConfirmation: AiEditorAgentExportConfirmation
  result?: {
    projectId?: string
    projectName?: string
    exportPath?: string
    summary?: string
  }
}

export interface AiEditorAgentToolError {
  code: string
  message: string
  retryable?: boolean
  suggestedAction?: string
}

export type AiEditorAgentEvent =
  | {
      type: 'session-created' | 'session-claimed' | 'request-updated' | 'progress' | 'result' | 'error' | 'cancel-requested' | 'cancelled' | 'export-confirmation-required' | 'export-confirmed' | 'export-denied'
      sequence: number
      timestamp: string
      session: AiEditorAgentSession
      message?: string
    }
  | {
      type: 'tool-start' | 'tool-finished'
      sequence: number
      timestamp: string
      session: AiEditorAgentSession
      callId: string
      toolName: string
      args?: Record<string, unknown>
      ok?: boolean
      summary?: string
      error?: AiEditorAgentToolError
      durationMs?: number
    }

export interface AiEditorAgentSnapshot {
  session: AiEditorAgentSession | null
  events: AiEditorAgentEvent[]
}

export interface AiEditorAgentApi {
  createRequest(request: string, projectId?: string | null): Promise<AiEditorAgentSession>
  updateRequest(sessionId: string, request: string): Promise<AiEditorAgentSession>
  cancelRequest(sessionId: string): Promise<AiEditorAgentSession>
  confirmExport(sessionId: string): Promise<AiEditorAgentSession>
  denyExport(sessionId: string): Promise<AiEditorAgentSession>
  getSnapshot(): Promise<AiEditorAgentSnapshot>
  onEvent(callback: (event: AiEditorAgentEvent) => void): () => void
  onActivate(callback: () => void): () => void
}

export interface AiEditorMcpApi {
  onRequest(callback: (request: AiEditorMcpRequest) => Promise<AiEditorMcpResponse>): () => void
  getLauncherPath(): Promise<string | null>
  getHttpConnection(): Promise<AiEditorHttpConnection | null>
}

export interface AiEditorHttpConnection {
  baseUrl: string
  skillUrl: string
  toolsUrl: string
  openapiUrl: string
  apiUrl: string
  discoveryPath?: string
}

export interface AiEditorFileApi {
  onOpenProject(callback: (projectId: string | null) => void): () => void
  openWindow(assets?: WorkspaceMediaAsset[]): Promise<void>
  project: AiEditorProjectApi
  mcp: AiEditorMcpApi
  agent: AiEditorAgentApi
  listLocalMedia(query?: AiEditorLocalMediaQuery): Promise<AiEditorLocalMedia[]>
  getLocalMedia(mediaId: string): Promise<AiEditorLocalMedia>
  getLocalMediaMetadata(mediaIds: string[]): Promise<AiEditorLocalMediaMetadata[]>
  readLocalMediaBytes(mediaId: string): Promise<ArrayBuffer>
  inspectLocalMedia(mediaIds: string[], options?: AiEditorLocalMediaInspectionOptions): Promise<AiEditorLocalMediaInspectionResult>
  createMediaContactSheet(mediaIds: string[], options?: AiEditorLocalMediaContactSheetOptions): Promise<AiEditorLocalMediaContactSheetResult>
  transcribeLocalMedia(mediaId: string, options?: AiEditorLocalMediaTranscriptionOptions): Promise<AiEditorLocalMediaTranscriptionResult>
  transcribeAudioSamples(samples: Float32Array, options?: AiEditorLocalMediaTranscriptionOptions): Promise<AiEditorLocalMediaTranscriptionResult>
  showSaveDialog(options: AiEditorFileDialogOptions): Promise<string | null>
  showOpenDialog(options: AiEditorFileDialogOptions): Promise<string | null>
  readFile(filePath: string): Promise<string>
  readFileBytes(filePath: string): Promise<ArrayBuffer>
  tempFilePath(extension: string): Promise<string>
  writeFile(filePath: string, data: string): Promise<void>
  openWrite(filePath: string): Promise<string>
  writeChunk(handleId: string, data: ArrayBuffer | Uint8Array, position: number): Promise<void>
  closeWrite(handleId: string): Promise<void>
  abortWrite(handleId: string): Promise<void>
  revealInFolder(filePath: string): Promise<void>
}
