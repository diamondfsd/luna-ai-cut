export interface EmbeddedDeepSeekHarnessWebState {
  projectId: string
  status: 'starting' | 'ready' | 'error'
  url?: string
  error?: string
}

export interface EmbeddedDeepSeekHarnessToolRequest {
  requestId: string
  projectId: string
  name: string
  args: Record<string, unknown>
}

export interface EmbeddedDeepSeekHarnessBridge {
  getWebUrl(projectId: string): Promise<string>
  onWebState(callback: (state: EmbeddedDeepSeekHarnessWebState) => void): () => void
  onToolRequest(callback: (request: EmbeddedDeepSeekHarnessToolRequest) => Promise<unknown>): () => void
  onToolCancel(callback: (requestId: string) => void): () => void
}
