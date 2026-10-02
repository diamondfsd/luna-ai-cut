import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentConversation } from '../../../src/shared/types/agentConversation'
import type { AiEditorAgentEvent } from '../../../src/shared/types'

/** Serial atomic commits: a failed write never replaces the last valid archive. */
export function createAgentConversationStore(directory: () => Promise<string>) {
  let queue: Promise<unknown> = Promise.resolve()
  const transact = <T>(operation: (items: AgentConversation[]) => Promise<{ items?: AgentConversation[]; result: T }>): Promise<T> => {
    const next = queue.then(async () => {
      const dir = await directory()
      const file = join(dir, 'conversations.json')
      let items: AgentConversation[] = []
      try {
        const saved: unknown = JSON.parse(await readFile(file, 'utf8'))
        if (!Array.isArray(saved) || saved.some(value => !value || typeof value.id !== 'string' || typeof value.request !== 'string' || typeof value.updatedAt !== 'string' || !['editing', 'director-plan'].includes(value.purpose) || !value.session || !Array.isArray(value.events))) {
          throw new Error('任务历史内容无效')
        }
        items = saved
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const change = await operation(items)
      if (change.items) {
        await mkdir(dir, { recursive: true })
        const temporary = join(dir, `${randomUUID()}.tmp`)
        try {
          await writeFile(temporary, JSON.stringify(change.items), { mode: 0o600 })
          await rename(temporary, file)
        } finally { await rm(temporary, { force: true }) }
      }
      return change.result
    })
    queue = next.catch(() => undefined)
    return next
  }
  return {
    flush: () => queue,
    list: () => transact(async items => ({ result: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) })),
    save: (conversation: AgentConversation) => transact(async items => ({
      items: [...items.filter(item => item.id !== conversation.id), conversation], result: conversation,
    })),
    capture: (event: AiEditorAgentEvent) => transact(async items => {
      const current = items.find(item => item.id === event.session.sessionId)
      const base: AgentConversation = current ?? {
        id: event.session.sessionId, agentId: event.session.agentId ?? '', agentName: event.session.agentType ?? 'Agent',
        purpose: event.session.purpose ?? 'editing', request: event.session.request, prompt: '',
        createdAt: event.session.createdAt, updatedAt: event.timestamp, handoff: 'pending', session: event.session, events: [],
      }
      // Tool arguments can contain large media payloads; archive progress summaries only.
      const safeEvent = { ...event, ...('args' in event ? { args: undefined } : {}) }
      const events = [...base.events.filter(item => item.sequence !== event.sequence), safeEvent]
        .sort((a, b) => a.sequence - b.sequence).slice(-200)
      const latest = events[events.length - 1]
      const updated = { ...base, session: latest.session, events, updatedAt: base.updatedAt > latest.timestamp ? base.updatedAt : latest.timestamp }
      return { items: [...items.filter(item => item.id !== base.id), updated], result: updated }
    }),
    patch: (id: string, change: Partial<Pick<AgentConversation, 'request' | 'agentId' | 'agentName' | 'prompt' | 'handoff' | 'error'>>) => transact(async items => {
      const current = items.find(item => item.id === id)
      if (!current) throw new Error('任务记录不存在')
      const updated = { ...current, ...change, updatedAt: new Date().toISOString() }
      return { items: items.map(item => item.id === id ? updated : item), result: updated }
    }),
    remove: (id: string) => transact(async items => ({ items: items.filter(item => item.id !== id), result: undefined })),
  }
}
