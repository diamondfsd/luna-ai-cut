export interface LunaEditorSdkRequest {
  requestId: string
  sessionId: string
  projectId?: string
  name: string
  args: Record<string, unknown>
}

export interface LunaEditorSdkResponse {
  requestId: string
  ok: boolean
  result?: unknown
  error?: {
    code?: string
    message: string
    details?: unknown
    retryable?: boolean
  }
}

export interface LunaEditorSdkApi {
  onRequest(callback: (request: LunaEditorSdkRequest) => void): () => void
  respond(response: LunaEditorSdkResponse): void
}
