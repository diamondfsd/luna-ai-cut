import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryRepository } from '../electron/features/memory/memoryRepository.ts'
import { createMemoryService } from '../electron/features/memory/memoryService.ts'
import { createMemoryToolModule } from '../electron/features/memory/memoryToolModule.ts'
import { agentPersonalSpace } from '../electron/features/agent-space/agentPersonalSpace.ts'
import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'
import { createLunaMcpServer } from '../electron/mcp/lunaMcpServer.ts'
import { handleRpc } from '../electron/mcp/lunaMcpRpc.ts'

const home = await mkdtemp(join(tmpdir(), 'luna-app-memory-'))
const space = agentPersonalSpace(home)
const manager = new AgentSessionManager()
let editorCalls = 0
let activations = 0
const service = createMemoryService(createMemoryRepository(async () => space.memoryDir))
const server = createLunaMcpServer({ homeDir: home, agentSession: manager, toolModules: [createMemoryToolModule(service)],
  requestRenderer: async request => { editorCalls++; assert.equal(request.kind, 'listTools', 'memory must never request editor operations'); return { ok: false, error: 'AI 剪辑窗口未打开' } },
  activateWindow: () => { activations++ },
})
try {
  const endpoint = await server.start()
  assert.equal(endpoint.baseUrl.startsWith('http://127.0.0.1:'), true)
  assert.equal(server.endpointPath, join(home, '.luna-ai-cut', 'mcp-endpoint.json'))
  const call = async (name, args) => {
    const response = await fetch(`${endpoint.baseUrl}/api/tools/${name}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arguments: args }) })
    assert.equal(response.status, 200)
    return response.json()
  }
  const catalog = await (await fetch(endpoint.toolsUrl)).json()
  assert.equal(catalog.meta.luna.editorToolsReady, false)
  assert.ok(catalog.tools.find(tool => tool.name === 'save_memory'))
  const openapi = await (await fetch(endpoint.openapiUrl)).json()
  assert.ok(openapi.paths['/api/tools/save_memory'])
  const entry = await (await fetch(endpoint.skillUrl)).text()
  assert.match(entry, /全应用发现/)
  assert.doesNotMatch(entry, /external editing Agent|Call activate_luna_window after claiming/)
  const discovered = await call('list_agent_skills', {})
  assert.equal(discovered.data.skills.find(skill => skill.skillId === 'memory').workflow, undefined)
  const memorySkill = await call('get_agent_skill', { skillId: 'memory' })
  assert.match(memorySkill.data.instructions, /application-level capability/)
  const editorCountBeforeMemory = editorCalls

  // Reproduce chat202601002: a request to remember context must stay auto and persist it.
  const quote = '我目前在做一些自媒体视频， 主要是通过一些实拍和录屏来完成的， 然后音频主要是有AI模型来生成的。'
  const original = `我需要你记录一个东西，${quote} 我需要你记录一下这一点到记忆里`
  const task = manager.createRequest(original, null, 'auto')
  const claimed = await call('wait_for_edit_request', { agentId: 'workbuddy-test', agentType: 'WorkBuddy', agentModel: 'test-model' })
  assert.equal(claimed.data.session.sessionId, task.sessionId)
  const context = { sessionId: task.sessionId, revision: 1 }
  const save = { ...context, kind: 'user-context', scope: 'user', content: quote, sourceQuote: quote, idempotencyKey: 'production-context' }
  const saved = await call('save_memory', save)
  assert.equal(saved.ok, true)
  const record = saved.data.memory
  assert.equal(record.status, 'recorded')
  assert.equal(record.source.request, original)
  assert.equal(record.source.origin, 'task-request')
  assert.equal(record.source.taskId, task.sessionId)
  const readBack = await call('get_memory', { ...context, memoryId: record.id })
  assert.equal(readBack.data.memory.content, quote)
  assert.equal(manager.snapshot().session.purpose, 'auto')
  assert.equal(editorCalls, editorCountBeforeMemory)
  assert.equal(activations, 0)
  assert.equal((await call('save_memory', save)).data.replayed, true)
  assert.equal((await call('save_memory', { ...save, content: 'summary' })).error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal((await call('save_memory', { ...save, idempotencyKey: 'fake-source', sourceQuote: '从未说过的偏好' })).error.code, 'SOURCE_UNVERIFIED')
  assert.equal((await call('save_memory', { ...save, idempotencyKey: 'wrong-scope', kind: 'project-decision' })).error.code, 'MEMORY_SCOPE_INVALID')
  assert.equal((await call('save_memory', { ...save, idempotencyKey: 'unbound-project', scope: 'project' })).error.code, 'MEMORY_SCOPE_REQUIRED')
  assert.equal((await call('save_memory', { ...save, idempotencyKey: 'untrusted-actor', actor: 'user' })).error.code, 'INVALID_PARAMS')
  const inferred = await call('save_memory', { ...save, content: '用户一定喜欢快节奏', idempotencyKey: 'inference' })
  assert.equal(inferred.data.memory.status, 'candidate', 'a summary must not upgrade itself into a confirmed fact')
  assert.equal((await call('search_memories', { ...context, query: '实拍' })).data.total, 2)
  await call('report_edit_result', { ...context, status: 'completed', summary: '已记录创作方式' })
  assert.equal(manager.snapshot().session.projectId, null)

  // New execution/repository instance can read the shared context without any editor/project.
  const followUp = await call('update_task_request', { ...context, request: '更正刚才的记忆：现在音频使用真人录音。' })
  assert.equal(followUp.data.session.sessionId, task.sessionId)
  await call('get_edit_request', { sessionId: task.sessionId })
  const nextContext = { sessionId: task.sessionId, revision: 2 }
  const newQuote = '现在音频使用真人录音。'
  const corrections = await Promise.all(['correct-a', 'correct-b'].map(idempotencyKey => call('save_memory', {
    ...nextContext, kind: 'user-context', scope: 'user', memoryId: record.id, expectedVersion: 1,
    content: newQuote, sourceQuote: newQuote, idempotencyKey,
  })))
  assert.equal(corrections.filter(result => result.ok).length, 1)
  assert.equal(corrections.find(result => !result.ok).error.code, 'MEMORY_VERSION_CONFLICT')
  const corrected = (await call('get_memory', { ...nextContext, memoryId: record.id })).data.memory
  assert.equal(corrected.version, 2)
  assert.equal(corrected.history[0].content, quote)
  assert.equal((await call('save_memory', save)).error.code, 'REQUEST_UPDATED', 'old instructions cannot save over new requirements')

  // Project isolation belongs to the service, not a UI or Agent's interpretation.
  manager.cancelRequest(task.sessionId)
  const projectA = manager.createRequest('这个项目保留现场对白', 'project-a', 'auto')
  await manager.waitForRequest('worker', 5)
  const aContext = { sessionId: projectA.sessionId, revision: 1 }
  const projectMemory = await call('save_memory', { ...aContext, kind: 'project-decision', scope: 'project',
    content: projectA.request, sourceQuote: projectA.request, idempotencyKey: 'project-a' })
  assert.equal(projectMemory.ok, true)
  manager.cancelRequest(projectA.sessionId)
  const projectB = manager.createRequest('读取当前项目背景', 'project-b', 'auto')
  await manager.waitForRequest('worker', 5)
  const bContext = { sessionId: projectB.sessionId, revision: 1 }
  assert.equal((await call('get_memory', { ...bContext, memoryId: projectMemory.data.memory.id })).error.code, 'MEMORY_NOT_FOUND')
  assert.equal((await call('search_memories', { ...bContext, scope: 'project' })).data.total, 0)
  assert.equal((await call('search_memories', { ...bContext, scope: 'user', query: '真人' })).data.records[0].id, record.id)

  // Restart persistence and explicit forget remove memory versions; retries cannot resurrect it.
  const restarted = createMemoryService(createMemoryRepository(async () => space.memoryDir))
  const accessContext = { taskId: projectB.sessionId, revision: 1, projectId: 'project-b', actorId: 'test', request: '忘记这条创作背景', assertCurrent: () => {} }
  assert.equal((await restarted.get(accessContext, record.id)).version, 2)
  const forgetting = { memoryId: record.id, expectedVersion: 2, idempotencyKey: 'forget-production' }
  await restarted.forget(accessContext, forgetting)
  assert.equal((await restarted.forget(accessContext, forgetting)).forgotten, true)
  await assert.rejects(restarted.get(accessContext, record.id), error => error.code === 'MEMORY_NOT_FOUND')
  await assert.rejects(restarted.save({ taskId: task.sessionId, revision: 1, projectId: null, actorId: 'test',
    request: original, assertCurrent: () => {} }, save), error => error.code === 'MEMORY_NOT_FOUND', 'old idempotent saves cannot resurrect forgotten memory')
  assert.equal((await call('save_memory', { ...bContext, kind: 'user-context', scope: 'user', memoryId: record.id,
    expectedVersion: 2, content: projectB.request, sourceQuote: projectB.request, idempotencyKey: 'stale-edit' })).error.code, 'MEMORY_NOT_FOUND')
  manager.cancelRequest(projectB.sessionId)
  assert.equal((await call('search_memories', bContext)).error.code, 'USER_STOPPED')

  // Cancellation while filesystem resolution is pending never commits.
  let authorized = true
  const stoppedDir = join(home, 'stopped-memory')
  const stoppedRepository = createMemoryRepository(async () => { authorized = false; return stoppedDir })
  await assert.rejects(stoppedRepository.transact(() => { if (!authorized) throw new Error('stopped') }, document => {
    document.records = []; return { result: true, changed: true }
  }), /stopped/)
  await assert.rejects(access(join(stoppedDir, 'memories.json')), error => error.code === 'ENOENT')

  // An async old tool failure must neither commit nor appear in the new execution's history.
  const delayedTask = manager.createRequest('记住旧背景', null, 'auto')
  await manager.waitForRequest('worker', 5)
  let releaseDirectory
  let notifyDirectory
  const directoryEntered = new Promise(resolve => { notifyDirectory = resolve })
  const directoryReady = new Promise(resolve => { releaseDirectory = resolve })
  const delayedService = createMemoryService(createMemoryRepository(async () => { notifyDirectory(); return directoryReady }))
  const beforeDelayed = await readFile(join(space.memoryDir, 'memories.json'), 'utf8')
  const pendingSave = handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_memory', arguments: {
    sessionId: delayedTask.sessionId, revision: 1, kind: 'user-context', scope: 'user', content: delayedTask.request,
    sourceQuote: delayedTask.request, idempotencyKey: 'delayed-save',
  } } }, { agentSession: manager, toolModules: [createMemoryToolModule(delayedService)], requestRenderer: async () => { throw new Error('no editor') } })
  await directoryEntered
  await manager.continueRequest(delayedTask.sessionId, 1, '改为新的背景')
  const afterUpdateCount = manager.snapshot().events.length
  releaseDirectory(space.memoryDir)
  assert.equal((await pendingSave).result.structuredContent.error.code, 'REQUEST_UPDATED')
  assert.equal(manager.snapshot().events.length, afterUpdateCount, 'obsolete operations must not append events under the new revision')
  assert.equal(await readFile(join(space.memoryDir, 'memories.json'), 'utf8'), beforeDelayed)

  // Closing drains previously accepted commits and rejects any subsequent operation.
  let openShutdownDirectory
  let shutdownEntered
  const shutdownStarted = new Promise(resolve => { shutdownEntered = resolve })
  const shutdownReady = new Promise(resolve => { openShutdownDirectory = resolve })
  const shutdownRepository = createMemoryRepository(async () => { shutdownEntered(); return shutdownReady })
  const acceptedCommit = shutdownRepository.transact(() => {}, () => ({ result: 'saved', changed: true }))
  await shutdownStarted
  const closed = shutdownRepository.close()
  await assert.rejects(shutdownRepository.transact(() => {}, () => ({ result: 'late', changed: true })), error => error.code === 'MEMORY_UNAVAILABLE')
  const shutdownDir = join(home, 'shutdown-memory')
  openShutdownDirectory(shutdownDir)
  assert.equal(await acceptedCommit, 'saved')
  await closed
  assert.equal(JSON.parse(await readFile(join(shutdownDir, 'memories.json'), 'utf8')).formatVersion, 1)

  // Damaged or incompatible personal memory must remain untouched.
  const memoryFile = join(space.memoryDir, 'memories.json')
  await writeFile(memoryFile, '{broken')
  await assert.rejects(restarted.search(accessContext, {}))
  assert.equal(await readFile(memoryFile, 'utf8'), '{broken')
  await writeFile(memoryFile, JSON.stringify({ formatVersion: 999, records: [], receipts: [] }))
  await assert.rejects(restarted.search(accessContext, {}), error => error.code === 'MEMORY_STORAGE_INVALID')
  const persistentFile = await readFile(memoryFile, 'utf8')
  await server.stop()
  assert.equal(await readFile(memoryFile, 'utf8'), persistentFile, 'stopping the service only removes the transient endpoint')
  await assert.rejects(access(server.endpointPath), error => error.code === 'ENOENT')
  console.log('App memory: transcript regression, standalone discovery, persistence, sources, scope, revisions, cancellation and forget passed')
} finally {
  await server.stop()
  await rm(home, { recursive: true, force: true })
}
