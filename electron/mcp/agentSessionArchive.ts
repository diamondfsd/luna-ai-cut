import type { AiEditorAgentEvent, AiEditorAgentSession } from '../../src/shared/types'
import { AgentSessionError, ACTIVE_STATUSES, copySession } from './agentSessionState.ts'

type SavedExecution = { session: AiEditorAgentSession; sequence: number }
/** Stable task identity survives replaced executions; disk lookup is injected by storage. */
export class AgentSessionArchive {
  private readonly sessions = new Map<string, SavedExecution>()
  load: ((id: string) => Promise<SavedExecution | null>) | undefined
  capture(event: AiEditorAgentEvent): void {
    this.sessions.set(event.session.sessionId, { session: copySession(event.session), sequence: event.sequence })
  }
  async continuation(id: string, revision: number, current: () => AiEditorAgentSession | null): Promise<SavedExecution> {
    const saved = await this.find(id)
    const active = current()
    const session = active?.sessionId === id ? active : saved?.session
    if (!session) throw new AgentSessionError('SESSION_NOT_FOUND', '任务不存在')
    if (active && active.sessionId !== id && ACTIVE_STATUSES.has(active.status)) {
      throw new AgentSessionError('SESSION_ALREADY_ACTIVE', '请先停止当前执行')
    }
    if (revision !== session.revision) throw new AgentSessionError('REQUEST_UPDATED', '请先读取最新任务要求')
    return { session: copySession(session), sequence: saved?.sequence ?? 0 }
  }
  async find(id: string): Promise<SavedExecution | null> {
    return this.sessions.get(id) ?? await this.load?.(id) ?? null
  }
}
