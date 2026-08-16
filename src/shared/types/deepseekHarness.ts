export interface DeepSeekHarnessWebState {
  projectId: string
  status: 'starting' | 'ready' | 'error'
  url?: string
  error?: string
}

export interface DeepSeekHarnessSourceToolRequest {
  requestId: string
  projectId: string
  name: string
  args: Record<string, unknown>
}

export interface DeepSeekHarnessApi {
  getWebUrl(projectId: string): Promise<string>
  onWebState(callback: (state: DeepSeekHarnessWebState) => void): () => void
  onSourceToolRequest(callback: (request: DeepSeekHarnessSourceToolRequest) => Promise<unknown>): () => void
  onSourceToolCancel(callback: (requestId: string) => void): () => void
}
