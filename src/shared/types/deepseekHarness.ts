export interface DeepSeekHarnessContext {
  sessionId: string
  feature?: string
  projectId?: string
  metadata?: Record<string, string>
}

export interface DeepSeekHarnessWebState {
  sessionId: string
  status: 'starting' | 'ready' | 'error'
  url?: string
  error?: string
}

export interface DeepSeekHarnessToolRequest {
  requestId: string
  sessionId: string
  feature?: string
  projectId?: string
  name: string
  args: Record<string, unknown>
}

export interface DeepSeekHarnessToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface DeepSeekHarnessApi {
  /** Request the embedded assistant panel to open. */
  openWindow(context?: DeepSeekHarnessContext): Promise<void>
  getWebUrl(context: DeepSeekHarnessContext): Promise<string>
  onOpenRequested(callback: (context?: DeepSeekHarnessContext) => void): () => void
  onWebState(callback: (state: DeepSeekHarnessWebState) => void): () => void
}
