import type { AiEditorAgentEvent, AiEditorAgentPhase, AiEditorAgentSession, AiEditorAgentSessionStatus } from '../../src/shared/types'

export interface AgentToolError {
  code: string
  message: string
  retryable?: boolean
  suggestedAction?: string
}

export interface AgentToolResult {
  ok: boolean
  summary: string
  data?: unknown
  error?: AgentToolError
}

export class AgentSessionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentSessionError'
    this.code = code
  }
}

export interface AgentWaitResult {
  ok: true
  state: 'claimed' | 'idle'
  session?: AiEditorAgentSession
}

export interface AgentRequestResult {
  ok: true
  session: AiEditorAgentSession
  changed: boolean
}

export interface AgentToolGate {
  session: AiEditorAgentSession
  allowed: boolean
  error?: AgentToolError
}

export interface AgentRequestContext {
  sessionId: string
  revision: number
  request: string
  changed: boolean
}

export interface Waiter {
  resolve: (result: AgentWaitResult) => void
  timer: NodeJS.Timeout
  agentId: string | null
  agentType: string | null
  agentModel: string | null
}

export interface ExportConfirmationDecision {
  approved: boolean
  code?: string
  message?: string
}

export interface ExportConfirmationWaiter {
  sessionId: string
  revision: number
  resolve: (decision: ExportConfirmationDecision) => void
  timer: NodeJS.Timeout
}

export type Listener = (event: AiEditorAgentEvent) => void

export type AgentEventInput =
  | {
      type: 'session-created' | 'session-claimed' | 'request-updated' | 'progress' | 'result' | 'error' | 'cancel-requested' | 'cancelled' | 'export-confirmation-required' | 'export-confirmed' | 'export-denied'
      session: AiEditorAgentSession
      message?: string
    }
  | {
      type: 'tool-start' | 'tool-finished'
      session: AiEditorAgentSession
      callId: string
      toolName: string
      args?: Record<string, unknown>
      ok?: boolean
      summary?: string
      error?: AgentToolError
      durationMs?: number
    }

export const ACTIVE_STATUSES = new Set<AiEditorAgentSessionStatus>(['queued', 'running'])
export const INACTIVE_EXECUTION_STATUSES = new Set<AiEditorAgentSessionStatus>(['completed', 'failed', 'cancelled'])
export const MAX_EVENTS = 200
export const DEFAULT_WAIT_SECONDS = 300
export const MAX_WAIT_SECONDS = 900
export const EXPORT_CONFIRMATION_TIMEOUT_MS = 15 * 60 * 1_000

export function nowIso(): string {
  return new Date().toISOString()
}

export function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)))
}

export function copySession(session: AiEditorAgentSession): AiEditorAgentSession {
  return {
    ...session,
    directorPlanRef: session.directorPlanRef ? { ...session.directorPlanRef } : undefined,
    result: session.result ? { ...session.result } : undefined,
  }
}

export function phaseForStatus(status: AiEditorAgentSessionStatus): AiEditorAgentPhase {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'waiting'
}

