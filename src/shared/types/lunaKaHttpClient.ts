export type LunaKaHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface LunaKaHttpRequestOptions {
  method?: LunaKaHttpMethod
  body?: unknown
}

export interface LunaKaChannelMessageEvent {
  endpoint: string
  message: unknown
}

export interface LunaKaChannelStatusEvent {
  endpoint: string
  state: 'open' | 'closed' | 'error'
  code?: number
  reason?: string
}

export interface LunaKaHttpClientApi {
  connect(endpoint: string): Promise<void>
  request<T>(endpoint: string, path: string, options?: LunaKaHttpRequestOptions): Promise<T>
  connectChannel(endpoint: string): Promise<void>
  sendChannelMessage(endpoint: string, message: unknown): Promise<void>
  disconnectChannel(endpoint: string): Promise<void>
  onChannelMessage(callback: (event: LunaKaChannelMessageEvent) => void): () => void
  onChannelStatus(callback: (event: LunaKaChannelStatusEvent) => void): () => void
}
