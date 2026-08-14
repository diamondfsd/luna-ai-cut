export interface EmbeddedDeepSeekHarnessConfig {
  baseUrl: string
  model: string
  contextWindowTokens: number
  maxOutputTokens: number
  hasApiKey: boolean
}

export interface EmbeddedDeepSeekHarnessConfigInput {
  baseUrl: string
  model: string
  contextWindowTokens: number
  maxOutputTokens: number
  apiKey?: string
  clearApiKey?: boolean
}

export interface EmbeddedDeepSeekHarnessConfigTestResult {
  config: EmbeddedDeepSeekHarnessConfig
  connected: boolean
  message: string
}

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
  getConfig(): Promise<EmbeddedDeepSeekHarnessConfig>
  saveConfig(input: EmbeddedDeepSeekHarnessConfigInput): Promise<EmbeddedDeepSeekHarnessConfig>
  testConfig(input: EmbeddedDeepSeekHarnessConfigInput): Promise<EmbeddedDeepSeekHarnessConfigTestResult>
  getWebUrl(projectId: string): Promise<string>
  onWebState(callback: (state: EmbeddedDeepSeekHarnessWebState) => void): () => void
  onSourceToolRequest(callback: (request: EmbeddedDeepSeekHarnessSourceToolRequest) => Promise<unknown>): () => void
}
