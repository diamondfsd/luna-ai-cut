export interface DeepSeekHarnessConfig {
  baseUrl: string
  model: string
  contextWindowTokens: number
  maxOutputTokens: number
  hasApiKey: boolean
}

export interface DeepSeekHarnessConfigInput {
  baseUrl: string
  model: string
  contextWindowTokens: number
  maxOutputTokens: number
  apiKey?: string
  clearApiKey?: boolean
}

export interface DeepSeekHarnessConfigTestResult {
  config: DeepSeekHarnessConfig
  connected: boolean
  message: string
}

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
  getConfig(): Promise<DeepSeekHarnessConfig>
  saveConfig(input: DeepSeekHarnessConfigInput): Promise<DeepSeekHarnessConfig>
  testConfig(input: DeepSeekHarnessConfigInput): Promise<DeepSeekHarnessConfigTestResult>
  getWebUrl(projectId: string): Promise<string>
  onWebState(callback: (state: DeepSeekHarnessWebState) => void): () => void
  onSourceToolRequest(callback: (request: DeepSeekHarnessSourceToolRequest) => Promise<unknown>): () => void
}
