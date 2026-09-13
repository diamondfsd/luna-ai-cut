import type { WorkspaceMediaAsset } from './workspace'

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
}

export interface AiEditorMcpApi {
  onRequest(callback: (request: AiEditorMcpRequest) => Promise<AiEditorMcpResponse>): () => void
  getLauncherPath(): Promise<string | null>
}

export interface AiEditorFileApi {
  project: AiEditorProjectApi
  mcp: AiEditorMcpApi
  listLocalMedia(query?: AiEditorLocalMediaQuery): Promise<AiEditorLocalMedia[]>
  getLocalMedia(mediaId: string): Promise<AiEditorLocalMedia>
  readLocalMediaBytes(mediaId: string): Promise<ArrayBuffer>
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
