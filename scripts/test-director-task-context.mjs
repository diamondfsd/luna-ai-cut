import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'
import { createAgentTaskCoordinator } from '../electron/features/external-agents/agentTaskCoordinator.ts'
import { createAgentConversationStore } from '../electron/features/external-agents/agentConversationStore.ts'
const root = await mkdtemp(path.join(tmpdir(), 'luna-plan-task-'))
try {
  const manager = new AgentSessionManager()
  const store = createAgentConversationStore(async () => root)
  let handedOff = 0
  const launch = createAgentTaskCoordinator({ manager, store,
    adapters: { list: () => [{ id: 'test', name: 'Test' }], isInstalled: async () => true,
      startTask: async () => { handedOff++; return { mode: 'draft' } } },
    resolveDirectorPlan: async planId => { if (planId !== 'plan') throw new Error('missing plan'); return { planId, signature: 'snapshot' } },
    connection: async () => ({ discoveryFile: '/discovery', toolsUrl: 'http://localhost/tools' }), copy: () => {},
  })
  const result = await launch('test', { request: '剪辑当前计划', directorPlanId: 'plan' })
  assert.deepEqual(result.conversation.session.directorPlanRef, { planId: 'plan', signature: 'snapshot' })
  assert.equal(result.conversation.request, '剪辑当前计划')
  assert.equal(result.conversation.session.purpose, 'auto')
  assert.match(result.conversation.prompt, /上下文拍摄计划 ID："plan"/)
  assert.deepEqual((await store.list())[0].session.directorPlanRef, result.conversation.session.directorPlanRef)
  manager.cancelRequest(result.conversation.id)
  await assert.rejects(launch('test', { request: '剪辑', directorPlanId: 'missing' }), /missing plan/)
  assert.equal(handedOff, 1)
  console.log('Local plan context persistence, original request preservation and missing-plan handoff rejection passed')
} finally { await rm(root, { recursive: true, force: true }) }
