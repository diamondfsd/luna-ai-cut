import type { AgentTaskInput } from '../../../src/shared/types/agentConversation'
import type { AiEditorHttpConnection } from '../../../src/shared/types'
import type { AgentSessionManager } from '../../mcp/agentSessionManager'
import type { createAgentConversationStore } from './agentConversationStore'
import type { createExternalAgentService } from './externalAgentService'
import { buildAssistantAgentPrompt } from '../../../src/lib/assistantAgentPrompt.ts'

export function createAgentTaskCoordinator(options: {
  manager: AgentSessionManager
  store: ReturnType<typeof createAgentConversationStore>
  adapters: ReturnType<typeof createExternalAgentService>
  connection(): Promise<AiEditorHttpConnection>
  copy(text: string): void
}) {
  let busy = false
  return async (agentId: string, input: AgentTaskInput, copyOnly = false) => {
    if (busy) throw new Error('正在发起任务，请稍后')
    if (!input || typeof input.request !== 'string' || !input.request.trim() || input.request.length > 6000
      || (input.purpose !== undefined && !['auto', 'editing', 'director-plan'].includes(input.purpose))
      || (input.projectId != null && typeof input.projectId !== 'string')) throw new Error('任务要求无效')
    const purpose = input.purpose ?? 'auto'
    const agent = options.adapters.list().find(value => value.id === agentId)
    if (!agent) throw new Error('不支持此 Agent')
    busy = true
    let sessionId: string | undefined
    try {
      const current = options.manager.snapshot().session
      if (current && ['queued', 'running'].includes(current.status)) throw new Error('请先完成或停止当前任务')
      if (!copyOnly && !await options.adapters.isInstalled(agentId)) throw new Error(`未检测到 ${agent.name}`)
      const connection = await options.connection()
      const session = options.manager.createRequest(input.request, purpose !== 'director-plan' ? input.projectId ?? null : null, purpose)
      sessionId = session.sessionId
      const base = buildAssistantAgentPrompt(connection, input.request)
      const prompt = `${base}\n\nLuna 已创建任务：sessionId=${session.sessionId}，purpose=${purpose}，revision=${session.revision}。请按技能工具返回的公共指引领取此任务并核对编号，不要新建其他任务。${session.projectId ? `上下文项目 ID：${JSON.stringify(session.projectId)}；仅当所选流程需要剪辑时通过工具确认并打开。` : ''}`
      // Capture and persist the first exact user request before any application is opened or clipboard is changed.
      const creation = options.manager.snapshot().events.find(event => event.type === 'session-created' && event.session.sessionId === sessionId)
      if (!creation) throw new Error('任务创建失败')
      await options.store.capture(creation)
      await options.store.patch(sessionId, { request: input.request, agentId, agentName: agent.name, prompt })
      const result = copyOnly ? (options.copy(prompt), { mode: 'clipboard' as const }) : await options.adapters.startTask(agentId, { prompt })
      const conversation = await options.store.patch(sessionId, { handoff: result.mode })
      return { conversation, mode: result.mode }
    } catch (error) {
      if (sessionId) {
        options.manager.cancelRequest(sessionId)
        await options.store.patch(sessionId, { handoff: 'failed', error: error instanceof Error ? error.message : '发起任务失败' }).catch(() => undefined)
      }
      throw error
    } finally { busy = false }
  }
}
