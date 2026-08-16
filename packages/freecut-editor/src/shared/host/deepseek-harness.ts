export interface EmbeddedDeepSeekHarnessWebState {
  projectId: string
  status: 'starting' | 'ready' | 'error'
  url?: string
  error?: string
}

export interface EmbeddedDeepSeekHarnessSourceToolRequest {
  requestId: string
  projectId: string
  name: string
  args: Record<string, unknown>
}

export interface EmbeddedDeepSeekHarnessBridge {
  getWebUrl(projectId: string): Promise<string>
  onWebState(callback: (state: EmbeddedDeepSeekHarnessWebState) => void): () => void
  onSourceToolRequest(callback: (request: EmbeddedDeepSeekHarnessSourceToolRequest) => Promise<unknown>): () => void
  onSourceToolCancel(callback: (requestId: string) => void): () => void
}
