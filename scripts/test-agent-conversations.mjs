import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentConversationStore } from '../electron/features/external-agents/agentConversationStore.ts'
import { createAgentTaskCoordinator } from '../electron/features/external-agents/agentTaskCoordinator.ts'
import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'

const dir = await mkdtemp(join(tmpdir(), 'luna-conversations-'))
try {
  const store = createAgentConversationStore(async () => dir)
  const manager = new AgentSessionManager()
  manager.subscribe(event => { void store.capture(event) })
  let launches = 0
  let installed = true
  let failLaunch = false
  const adapters = {
    list: () => [{ id: 'test', name: 'Test Agent' }],
    isInstalled: async () => installed,
    startTask: async (_id, { prompt }) => {
      launches++
      const saved = JSON.parse(await readFile(join(dir, 'conversations.json'), 'utf8')).at(-1)
      assert.equal(saved.request, '  帮我创建导演计划\n')
      assert.equal(saved.prompt, prompt)
      assert.match(prompt, /skills\/director-plan.md/)
      assert.match(prompt, new RegExp(saved.id))
      assert.equal(saved.purpose, 'director-plan')
      if (failLaunch) throw new Error('launch failed')
      return { mode: 'draft' }
    },
  }
  const launch = createAgentTaskCoordinator({ manager, store, adapters,
    connection: async () => ({ baseUrl: 'http://127.0.0.1:1234', discoveryPath: '/stable/endpoint.json' }), copy: () => {} })
  const input = { request: '  帮我创建导演计划\n', purpose: 'director-plan' }
  installed = false
  await assert.rejects(launch('test', input), /未检测到/)
  assert.equal(manager.snapshot().session, null)
  installed = true
  const result = await launch('test', input)
  assert.equal(result.conversation.handoff, 'draft')
  await assert.rejects(launch('test', input), /请先完成/)
  assert.equal(launches, 1)
  const creation = manager.snapshot().events[0]
  manager.startExternalRequest(input.request, 'external', null, null, null, 'director-plan')
  await store.flush()
  await store.capture(creation) // delayed old event cannot regress the running snapshot
  assert.equal((await store.list())[0].session.status, 'running')
  assert.equal((await store.list())[0].request, input.request)
  const reopened = createAgentConversationStore(async () => dir)
  assert.equal((await reopened.list())[0].request, input.request)
  manager.cancelRequest(result.conversation.id)
  await store.flush()
  failLaunch = true
  await assert.rejects(launch('test', input), /launch failed/)
  await store.flush()
  assert.equal(manager.snapshot().session.status, 'cancelled')
  assert.equal((await store.list())[0].handoff, 'failed')
  const events = (await store.list())[0].events
  assert.equal(new Set(events.map(e => e.sequence)).size, events.length)
  await writeFile(join(dir, 'conversations.json'), '{broken')
  await assert.rejects(store.capture(creation))
  assert.equal(await readFile(join(dir, 'conversations.json'), 'utf8'), '{broken')
  const before = launches
  await assert.rejects(launch('test', input))
  assert.equal(launches, before, 'archive failure must prevent external handoff')
  await store.flush()
  console.log('Conversation persistence, ordered replay and save-before-handoff tests passed')
} finally { await rm(dir, { recursive: true, force: true }) }
