export type ObsStreamDemoState = 'idle' | 'starting' | 'running' | 'stopped' | 'error'

export interface ObsStreamDemoStatus {
  state: ObsStreamDemoState
  sourceName: string
  obsStreamUrl: string | null
  previewUrl: string
  port: number | null
  bytes: number
  startedAt: string | null
  message: string
  error: string | null
}

export interface ObsStreamDemoApi {
  status(): Promise<ObsStreamDemoStatus>
  start(): Promise<ObsStreamDemoStatus>
  stop(): Promise<ObsStreamDemoStatus>
}
