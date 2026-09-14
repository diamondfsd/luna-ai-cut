import { randomUUID } from 'node:crypto'

import type {
  AiEditorAgentEvent,
  AiEditorAgentPhase,
  AiEditorAgentSession,
  AiEditorAgentSessionStatus,
  AiEditorAgentSnapshot,
} from '../../src/shared/types'

export interface AgentToolError {
  code: string
  message: string
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

interface Waiter {
  resolve: (result: AgentWaitResult) => void
  timer: NodeJS.Timeout
  agentId: string | null
}

type Listener = (event: AiEditorAgentEvent) => void

type AgentEventInput =
  | {
      type: 'session-created' | 'session-claimed' | 'request-updated' | 'progress' | 'result' | 'error' | 'cancel-requested' | 'cancelled'
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
      durationMs?: number
    }

const ACTIVE_STATUSES = new Set<AiEditorAgentSessionStatus>(['queued', 'running'])
const TERMINAL_STATUSES = new Set<AiEditorAgentSessionStatus>(['completed', 'failed', 'cancelled'])
const MAX_EVENTS = 200
const DEFAULT_WAIT_SECONDS = 300
const MAX_WAIT_SECONDS = 900

function nowIso(): string {
  return new Date().toISOString()
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)))
}

function copySession(session: AiEditorAgentSession): AiEditorAgentSession {
  return {
    ...session,
    result: session.result ? { ...session.result } : undefined,
  }
}

function phaseForStatus(status: AiEditorAgentSessionStatus): AiEditorAgentPhase {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'waiting'
}

export class AgentSessionManager {
  private session: AiEditorAgentSession | null = null
  private activeSessionId: string | null = null
  private acknowledgedRevision = 0
  private sequence = 0
  private events: AiEditorAgentEvent[] = []
  private readonly listeners = new Set<Listener>()
  private readonly waiters: Waiter[] = []

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): AiEditorAgentSnapshot {
    return {
      session: this.session ? copySession(this.session) : null,
      events: this.events.map((event) => ({
        ...event,
        session: copySession(event.session),
        ...('args' in event && event.args ? { args: { ...event.args } } : {}),
      })),
    }
  }

  createRequest(request: string, projectId: string | null = null): AiEditorAgentSession {
    const trimmed = request.trim()
    if (!trimmed) throw new Error('剪辑要求不能为空')

    if (this.session && ACTIVE_STATUSES.has(this.session.status)) {
      return this.updateRequest(this.session.sessionId, trimmed)
    }

    const timestamp = nowIso()
    this.session = {
      sessionId: randomUUID(),
      request: trimmed,
      revision: 1,
      projectId,
      status: 'queued',
      phase: 'waiting',
      progress: 0,
      message: '等待外部 Agent 领取任务',
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelRequested: false,
      agentId: null,
    }
    this.activeSessionId = null
    this.acknowledgedRevision = 0
    this.emit({ type: 'session-created', session: this.session })
    this.resolveNextWaiter()
    return copySession(this.session)
  }

  startExternalRequest(
    request: string,
    agentId: string | null = null,
    projectId: string | null = null,
  ): AgentWaitResult {
    const trimmed = request.trim()
    if (!trimmed) throw new AgentSessionError('INVALID_REQUEST', '剪辑要求不能为空')

    const normalizedAgentId = agentId?.trim() || null
    const current = this.session
    if (current && ACTIVE_STATUSES.has(current.status)) {
      const sameRequest = current.request === trimmed
      const sameAgent = !normalizedAgentId || !current.agentId || current.agentId === normalizedAgentId
      if (sameRequest && sameAgent) {
        if (current.status === 'queued') return this.claim(current, normalizedAgentId)
        return { ok: true, state: 'claimed', session: copySession(current) }
      }
      throw new AgentSessionError('SESSION_ALREADY_ACTIVE', '已有其他剪辑任务正在执行，请先完成或停止当前任务')
    }

    const created = this.createRequest(trimmed, projectId)
    if (created.status !== 'queued') {
      if (this.session?.agentId === normalizedAgentId) {
        return { ok: true, state: 'claimed', session: copySession(this.session) }
      }
      throw new AgentSessionError('SESSION_ALREADY_CLAIMED', '剪辑任务已被其他 Agent 领取')
    }
    const claimed = this.claim(created, normalizedAgentId)
    this.resolveWaitersAsIdle()
    return claimed
  }

  updateRequest(sessionId: string, request: string): AiEditorAgentSession {
    const current = this.requireSession(sessionId)
    const trimmed = request.trim()
    if (!trimmed) throw new Error('剪辑要求不能为空')
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new Error('任务已经结束，不能修改剪辑要求')
    }

    this.session = {
      ...current,
      request: trimmed,
      revision: current.revision + 1,
      updatedAt: nowIso(),
      message: '用户已更新剪辑要求，等待 Agent 读取最新版本',
    }
    this.emit({
      type: 'request-updated',
      session: this.session,
      message: '用户已更新剪辑要求',
    })
    return copySession(this.session)
  }

  cancelRequest(sessionId: string): AiEditorAgentSession {
    const current = this.requireSession(sessionId)
    if (TERMINAL_STATUSES.has(current.status)) return copySession(current)

    if (current.status === 'queued') {
      this.session = {
        ...current,
        status: 'cancelled',
        phase: 'cancelled',
        message: '任务已取消',
        cancelRequested: true,
        updatedAt: nowIso(),
      }
      this.emit({ type: 'cancelled', session: this.session, message: '任务已取消' })
      this.resolveWaitersAsIdle()
      return copySession(this.session)
    }

    this.session = {
      ...current,
      cancelRequested: true,
      message: '正在请求 Agent 停止',
      updatedAt: nowIso(),
    }
    this.emit({ type: 'cancel-requested', session: this.session, message: '正在请求 Agent 停止' })
    return copySession(this.session)
  }

  async waitForRequest(agentId: string | null, timeoutSeconds?: number): Promise<AgentWaitResult> {
    const current = this.session
    if (current?.status === 'queued') return this.claim(current, agentId)
    if (current?.status === 'running') {
      const normalizedAgentId = agentId?.trim() || null
      if (normalizedAgentId && current.agentId && current.agentId !== normalizedAgentId) {
        throw new AgentSessionError('SESSION_ALREADY_CLAIMED', '当前剪辑任务已被其他 Agent 领取')
      }
      return {
        ok: true,
        state: 'claimed',
        session: copySession(current),
      }
    }

    const waitSeconds = Math.max(
      5,
      Math.min(MAX_WAIT_SECONDS, Math.round(timeoutSeconds ?? DEFAULT_WAIT_SECONDS)),
    )
    return await new Promise<AgentWaitResult>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) this.waiters.splice(index, 1)
        resolve({ ok: true, state: 'idle' })
      }, waitSeconds * 1_000)
      this.waiters.push({ resolve, timer, agentId })
    })
  }

  getRequest(sessionId: string, knownRevision?: number): AgentRequestResult {
    const current = this.requireSession(sessionId)
    const changed = knownRevision !== undefined
      ? knownRevision !== current.revision
      : this.acknowledgedRevision !== current.revision
    this.acknowledgedRevision = current.revision
    return { ok: true, session: copySession(current), changed }
  }

  reportProgress(
    sessionId: string,
    revision: number,
    phase: AiEditorAgentPhase,
    progress: number,
    message: string,
  ): AgentToolResult {
    const gate = this.gate(sessionId, revision)
    if (!gate.allowed) return { ok: false, summary: gate.error?.message ?? '任务不可用', error: gate.error }

    this.session = {
      ...gate.session,
      status: 'running',
      phase,
      progress: clampProgress(progress),
      message: message.trim() || gate.session.message,
      updatedAt: nowIso(),
    }
    this.emit({ type: 'progress', session: this.session, message: this.session.message })
    return {
      ok: true,
      summary: '进度已更新',
      data: { sessionId, revision: this.session.revision, phase, progress: this.session.progress },
    }
  }

  reportResult(
    sessionId: string,
    revision: number,
    status: Extract<AiEditorAgentSessionStatus, 'completed' | 'failed' | 'cancelled'>,
    summary?: string,
    projectId?: string,
    projectName?: string,
    exportPath?: string,
  ): AgentToolResult {
    const current = this.requireSession(sessionId)
    const gate = status === 'cancelled' && current.cancelRequested && revision === current.revision
      ? { session: copySession(current), allowed: true }
      : this.gate(sessionId, revision)
    if (!gate.allowed) return { ok: false, summary: gate.error?.message ?? '任务不可用', error: gate.error }

    const message = summary?.trim() || (status === 'completed' ? '剪辑已完成' : status === 'cancelled' ? '任务已取消' : '剪辑失败')
    const nextProjectId = projectId?.trim() || gate.session.projectId
    this.session = {
      ...gate.session,
      projectId: nextProjectId,
      status,
      phase: phaseForStatus(status),
      progress: status === 'completed' ? 100 : gate.session.progress,
      message,
      cancelRequested: false,
      updatedAt: nowIso(),
      result: {
        ...(projectId?.trim() ? { projectId: projectId.trim() } : {}),
        ...(projectName?.trim() ? { projectName: projectName.trim() } : {}),
        ...(exportPath?.trim() ? { exportPath: exportPath.trim() } : {}),
        ...(summary?.trim() ? { summary: summary.trim() } : {}),
      },
    }
    this.activeSessionId = null
    this.emit({
      type: 'result',
      session: this.session,
      message,
    })
    return { ok: true, summary: message, data: { session: copySession(this.session) } }
  }

  gateActiveTool(): AgentToolGate | null {
    if (!this.session) return null
    if (!this.activeSessionId || this.session.sessionId !== this.activeSessionId) {
      if (!TERMINAL_STATUSES.has(this.session.status)) return null
      return {
        session: copySession(this.session),
        allowed: false,
        error: { code: 'SESSION_NOT_ACTIVE', message: '剪辑任务已结束，不能继续修改' },
      }
    }
    const session = this.session
    if (session.cancelRequested) {
      return {
        session: copySession(session),
        allowed: false,
        error: { code: 'CANCEL_REQUESTED', message: '用户已请求停止任务，请停止继续编辑' },
      }
    }
    if (this.acknowledgedRevision !== session.revision) {
      return {
        session: copySession(session),
        allowed: false,
        error: { code: 'REQUEST_UPDATED', message: '用户更新了剪辑要求，请先调用 get_edit_request 获取最新版本' },
      }
    }
    return { session: copySession(session), allowed: true }
  }

  activeContext(): AgentRequestContext | null {
    const session = this.session
    if (!session || !this.activeSessionId || session.sessionId !== this.activeSessionId) return null
    return {
      sessionId: session.sessionId,
      revision: session.revision,
      request: session.request,
      changed: this.acknowledgedRevision !== session.revision,
    }
  }

  toolStarted(callId: string, toolName: string, args: Record<string, unknown>): void {
    const active = this.gateActiveTool()
    if (!active || !active.allowed) return
    this.emit({
      type: 'tool-start',
      session: active.session,
      callId,
      toolName,
      args,
    })
  }

  toolFinished(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ok: boolean,
    summary: string,
    durationMs: number,
  ): void {
    const session = this.session
    if (!session || !this.activeSessionId || session.sessionId !== this.activeSessionId) return
    this.emit({
      type: 'tool-finished',
      session: copySession(session),
      callId,
      toolName,
      args,
      ok,
      summary,
      durationMs,
    })
  }

  private requireSession(sessionId: string): AiEditorAgentSession {
    if (!sessionId || !this.session || this.session.sessionId !== sessionId) {
      throw new AgentSessionError('SESSION_NOT_FOUND', '剪辑任务不存在或已被替换，请重新调用 wait_for_edit_request')
    }
    return this.session
  }

  private gate(sessionId: string, revision: number): AgentToolGate {
    const current = this.requireSession(sessionId)
    if (!this.activeSessionId || current.sessionId !== this.activeSessionId || TERMINAL_STATUSES.has(current.status)) {
      return {
        session: copySession(current),
        allowed: false,
        error: { code: 'SESSION_NOT_ACTIVE', message: '剪辑任务已结束或尚未被 Agent 领取，不能继续修改' },
      }
    }
    if (current.cancelRequested) {
      return {
        session: copySession(current),
        allowed: false,
        error: { code: 'CANCEL_REQUESTED', message: '用户已请求停止任务' },
      }
    }
    if (revision !== current.revision || this.acknowledgedRevision !== current.revision) {
      return {
        session: copySession(current),
        allowed: false,
        error: { code: 'REQUEST_UPDATED', message: '用户更新了剪辑要求，请先调用 get_edit_request 获取最新版本' },
      }
    }
    return { session: copySession(current), allowed: true }
  }

  private claim(session: AiEditorAgentSession, agentId: string | null): AgentWaitResult {
    this.activeSessionId = session.sessionId
    this.acknowledgedRevision = session.revision
    this.session = {
      ...session,
      status: 'running',
      phase: 'waiting',
      message: '外部 Agent 已领取任务',
      agentId: agentId?.trim() || null,
      updatedAt: nowIso(),
    }
    this.emit({ type: 'session-claimed', session: this.session, message: '外部 Agent 已领取任务' })
    return { ok: true, state: 'claimed', session: copySession(this.session) }
  }

  private resolveNextWaiter(): void {
    const waiter = this.waiters.shift()
    if (!waiter || !this.session || this.session.status !== 'queued') return
    clearTimeout(waiter.timer)
    waiter.resolve(this.claim(this.session, waiter.agentId))
  }

  private resolveWaitersAsIdle(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      if (!waiter) continue
      clearTimeout(waiter.timer)
      waiter.resolve({ ok: true, state: 'idle' })
    }
  }

  private emit(input: AgentEventInput): void {
    const event = {
      ...input,
      sequence: ++this.sequence,
      timestamp: nowIso(),
      session: copySession(input.session),
    } as AiEditorAgentEvent
    this.events = [...this.events.slice(-(MAX_EVENTS - 1)), event]
    for (const listener of this.listeners) listener(event)
  }
}

export const agentSessionManager = new AgentSessionManager()
