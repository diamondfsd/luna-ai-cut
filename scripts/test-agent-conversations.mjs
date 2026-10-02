import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentConversationStore } from '../electron/features/external-agents/agentConversationStore.ts'
import { createAgentTaskCoordinator } from '../electron/features/external-agents/agentTaskCoordinator.ts'
import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'
import { agentPersonalSpace } from '../electron/features/agent-space/agentPersonalSpace.ts'

const dir = await mkdtemp(join(tmpdir(), 'luna-conversations-'))
try {
  const store = createAgentConversationStore(async () => dir)
  const manager = new AgentSessionManager()
  manager.subscribe(event => { void store.capture(event) })
  let launches = 0
  let installed = true
  let failLaunch = false
  let expectedPurpose = 'director-plan'
  const adapters = {
    list: () => [{ id: 'test', name: 'Test Agent' }],
    isInstalled: async () => installed,
    startTask: async (_id, { prompt }) => {
      launches++
      const saved = JSON.parse(await readFile(join(dir, 'conversations.json'), 'utf8')).at(-1)
      assert.equal(saved.request, '  帮我创建导演计划\n')
      assert.equal(saved.prompt, prompt)
      assert.match(prompt, /技能清单查询工具/)
      assert.doesNotMatch(prompt, /\/skills\/|\/skill\.md/)
      assert.doesNotMatch(prompt, /只要求拍摄方案|选择 director-plan|选择 editing/)
      assert.match(prompt, /\/\.well-known\/agent/)
      assert.match(prompt, new RegExp(saved.id))
      assert.equal(saved.purpose, expectedPurpose)
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
  failLaunch = false
  expectedPurpose = 'auto'
  const automatic = await launch('test', { request: input.request })
  assert.equal(automatic.conversation.session.purpose, 'auto', 'no local keyword routing')
  manager.startExternalRequest(input.request, 'external', null, null, null, 'auto')
  manager.selectWorkflow(automatic.conversation.id, 1, 'director-plan')
  manager.updateRequest(automatic.conversation.id, '用户在外部 Agent 的后续要求')
  await store.flush()
  assert.equal((await store.list())[0].purpose, 'director-plan')
  assert.equal((await store.list())[0].request, input.request)
  assert.equal((await reopened.list()).length, 3, 'legacy explicit-purpose archives remain readable')
  manager.cancelRequest(automatic.conversation.id)
  await store.flush()
  const personal = agentPersonalSpace(join(dir, 'home'))
  const migrating = createAgentConversationStore(async () => personal.conversationsDir, async () => dir)
  const legacyContent = await readFile(join(dir, 'conversations.json'), 'utf8')
  assert.equal((await migrating.list()).length, 3, 'existing task history migrates into the personal space')
  assert.equal(await readFile(join(dir, 'conversations.json'), 'utf8'), legacyContent, 'migration never removes the legacy archive')
  const personalFile = join(personal.conversationsDir, 'conversations.json')
  assert.equal(JSON.parse(await readFile(personalFile, 'utf8')).length, 3)
  await writeFile(personalFile, '[]')
  assert.equal((await migrating.list()).length, 0, 'an existing personal archive is never replaced or repopulated from legacy data')
  await writeFile(personalFile, '{broken')
  await assert.rejects(migrating.list())
  assert.equal(await readFile(personalFile, 'utf8'), '{broken', 'corrupt personal data cannot trigger a legacy overwrite')
  await writeFile(join(dir, 'conversations.json'), '{broken')
  const invalidMigration = createAgentConversationStore(async () => join(dir, 'another-personal-space'), async () => dir)
  await assert.rejects(invalidMigration.list(), 'corrupt legacy data cannot produce an empty personal archive')
  await assert.rejects(store.capture(creation))
  assert.equal(await readFile(join(dir, 'conversations.json'), 'utf8'), '{broken')
  const before = launches
  await assert.rejects(launch('test', input))
  assert.equal(launches, before, 'archive failure must prevent external handoff')
  await store.flush()
  console.log('Conversation persistence, ordered replay and save-before-handoff tests passed')
} finally { await rm(dir, { recursive: true, force: true }) }
