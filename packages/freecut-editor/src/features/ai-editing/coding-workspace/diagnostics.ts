export interface CodingWorkspaceDiagnostic {
  code: string
  message: string
  severity: 'error' | 'warning'
  stage: 'check'
  retryable: boolean
  path?: string
  details?: Readonly<Record<string, unknown>>
}
