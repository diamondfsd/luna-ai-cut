export interface DeepSeekHarnessWebState {
  projectId: string
  status: 'starting' | 'ready' | 'error'
  url?: string
  error?: string
}

export interface DeepSeekHarnessToolRequest {
  requestId: string
  projectId: string
  name: string
  args: Record<string, unknown>
}

export interface DeepSeekHarnessApi {
  getWebUrl(projectId: string): Promise<string>
  onWebState(callback: (state: DeepSeekHarnessWebState) => void): () => void
  onToolRequest(callback: (request: DeepSeekHarnessToolRequest) => Promise<unknown>): () => void
  onToolCancel(callback: (requestId: string) => void): () => void
}
