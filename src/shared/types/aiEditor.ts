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

export interface AiEditorLocalMedia {
  mediaId: string
  name: string
  kind: 'image' | 'video'
  bytes: number
  capturedAt: string | null
  modifiedAt: string
  groupDay: string
  sourceDeviceName?: string
  sourceDeviceId?: string
  duration?: number
}

export interface AiEditorLocalMediaQuery {
  limit?: number
  from?: string
  to?: string
  kind?: 'image' | 'video'
}

export type AiEditorLocalMediaInspectionMode = 'overview' | 'detail'

export interface AiEditorLocalMediaInspectionOptions {
  mode?: AiEditorLocalMediaInspectionMode
  maxWidth?: number
}

export interface AiEditorLocalMediaInspectionFrame {
  timeSec: number
  mimeType: 'image/jpeg'
  base64: string
}

export interface AiEditorLocalMediaInspectionItem {
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

export type AiEditorAgentSessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

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

export interface AiEditorAgentSession {
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
  result?: {
    projectId?: string
    projectName?: string
    exportPath?: string
    summary?: string
  }
}

export type AiEditorAgentEvent =
  | {
      type: 'session-created' | 'session-claimed' | 'request-updated' | 'progress' | 'result' | 'error' | 'cancel-requested' | 'cancelled'
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
  getSnapshot(): Promise<AiEditorAgentSnapshot>
  onEvent(callback: (event: AiEditorAgentEvent) => void): () => void
  onActivate(callback: () => void): () => void
}

export interface AiEditorMcpApi {
  onRequest(callback: (request: AiEditorMcpRequest) => Promise<AiEditorMcpResponse>): () => void
  getLauncherPath(): Promise<string | null>
}

export interface AiEditorFileApi {
  project: AiEditorProjectApi
  mcp: AiEditorMcpApi
  agent: AiEditorAgentApi
  listLocalMedia(query?: AiEditorLocalMediaQuery): Promise<AiEditorLocalMedia[]>
  getLocalMedia(mediaId: string): Promise<AiEditorLocalMedia>
  readLocalMediaBytes(mediaId: string): Promise<ArrayBuffer>
  inspectLocalMedia(mediaIds: string[], options?: AiEditorLocalMediaInspectionOptions): Promise<AiEditorLocalMediaInspectionResult>
  transcribeLocalMedia(mediaId: string, options?: AiEditorLocalMediaTranscriptionOptions): Promise<AiEditorLocalMediaTranscriptionResult>
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
