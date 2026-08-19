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
