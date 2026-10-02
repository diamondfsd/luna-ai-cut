import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleRpc } from '../electron/mcp/lunaMcpRpc.ts'
import { createToolRegistry } from '../electron/mcp/lunaToolModule.ts'
import { createLunaMcpServer } from '../electron/mcp/lunaMcpServer.ts'
import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'

const manager = new AgentSessionManager()
let rendererCalls = 0
let activations = 0
const module = { id: 'future-feature', tools: [{ name: 'future_operation', description: 'New app domain', inputSchema: { type: 'object' } }],
  execute: async (_name, args) => ({ ok: true, result: { ok: true, value: args.value } }) }
const options = { agentSession: manager, toolModules: [module], activateWindow: () => { activations++ },
  requestRenderer: async request => { rendererCalls++; return { ok: request.kind !== 'listTools', result: [] } } }
const call = (name, args = {}) => handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, options)
assert.throws(() => createToolRegistry([module, module]), /Duplicate tool/)
const catalog = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, options)
assert.equal(catalog.result.tools.find(t => t.name === 'future_operation')._meta.module, 'future-feature')
assert.equal((await call('future_operation', { value: 42 })).result.structuredContent.value, 42)
const callsBeforeDiscovery = rendererCalls
const nativeSkills = (await call('list_agent_skills')).result.structuredContent.data
assert.equal(nativeSkills.skills.find(skill => skill.skillId === 'editing').moduleId, 'editing-guide')
assert.equal(nativeSkills.skills.some(skill => 'instructions' in skill), false, 'list only metadata')
assert.match(nativeSkills.guidance, /select_task_workflow/)
assert.match((await call('get_agent_skill', { skillId: 'editing' })).result.structuredContent.data.instructions, /HTTP Agent Skill/)
assert.equal(rendererCalls, callsBeforeDiscovery, 'skill discovery must work without renderer startup')
assert.equal(manager.snapshot().session, null, 'skill discovery must not create or claim tasks')
assert.equal((await call('get_agent_skill', { skillId: '../../secret' })).result.structuredContent.error.code, 'SKILL_NOT_FOUND')
assert.equal((await call('get_agent_skill')).result.structuredContent.error.code, 'INVALID_PARAMS')
assert.equal((await call('list_agent_skills', { query: [] })).result.structuredContent.error.code, 'INVALID_PARAMS')
assert.equal((await call('list_agent_skills', { filePath: '/private' })).result.structuredContent.error.code, 'INVALID_PARAMS')
manager.createRequest('Create a plan', null, 'director-plan')
const before = rendererCalls
assert.equal((await call('create_project')).result.structuredContent.error.code, 'TASK_TYPE_CONFLICT')
assert.equal((await call('generate_background_music')).result.structuredContent.error.code, 'TASK_TYPE_CONFLICT')
assert.equal(rendererCalls, before)
assert.equal((await call('future_operation', { value: 43 })).result.structuredContent.value, 43)
await call('wait_for_edit_request', { agentId: 'test', agentType: 'director', agentModel: 'test-model', timeoutSec: 0 })
await call('activate_luna_window')
assert.equal(activations, 0)
options.toolModules = [{ ...module, allowedPurposes: ['editing'] }]
assert.equal((await call('future_operation')).result.isError, true)
options.toolModules = [{ ...module, execute: async () => null }]
assert.equal((await call('future_operation')).error.code, -32603)
assert.equal(rendererCalls, before, 'registered handler failures never fall through to renderer')
assert.throws(() => manager.startExternalRequest('Create a plan', null, null, null, null, 'editing'), /任务类型不同/)
// Auto tasks remain inert until the Agent reads the index, claims and selects a workflow.
options.toolModules = [module]
options.directorPlanTools = {} // guards must reject before any domain service is reached
manager.cancelRequest(manager.snapshot().session.sessionId)
const auto = manager.createRequest('Write a shooting plan', 'project-context', 'auto')
assert.equal((await call('select_task_workflow', { sessionId: auto.sessionId, revision: 1, workflow: 'director-plan' })).result.structuredContent.error.code, 'SESSION_NOT_ACTIVE')
await call('wait_for_edit_request', { agentId: 'test', agentType: 'assistant', agentModel: 'test-model' })
assert.equal(activations, 0, 'claiming auto tasks must not open editing')
assert.equal((await call('create_project')).result.isError, true)
assert.equal((await call('create_director_plan', { sessionId: auto.sessionId, revision: 1, idempotencyKey: 'test', markdown: '# plan', formatVersion: 1 })).result.structuredContent.error.code, 'TASK_WORKFLOW_REQUIRED')
assert.equal((await call('select_task_workflow', { sessionId: auto.sessionId, revision: 2, workflow: 'director-plan' })).result.structuredContent.error.code, 'REQUEST_UPDATED')
assert.equal((await call('select_task_workflow', { sessionId: 'wrong-id', revision: 1, workflow: 'director-plan' })).result.structuredContent.error.code, 'SESSION_NOT_FOUND')
const selected = await call('select_task_workflow', { sessionId: auto.sessionId, revision: 1, workflow: 'director-plan' })
assert.equal(selected.result.structuredContent.data.session.purpose, 'director-plan')
assert.equal(selected.result.structuredContent.data.session.projectId, null)
assert.equal((await call('select_task_workflow', { sessionId: auto.sessionId, revision: 1, workflow: 'director-plan' })).result.structuredContent.ok, true)
assert.equal((await call('select_task_workflow', { sessionId: auto.sessionId, revision: 1, workflow: 'editing' })).result.structuredContent.error.code, 'TASK_TYPE_CONFLICT')
assert.equal(activations, 0)
manager.cancelRequest(auto.sessionId)
assert.equal((await call('select_task_workflow', { sessionId: auto.sessionId, revision: 1, workflow: 'director-plan' })).result.structuredContent.error.code, 'USER_STOPPED')
const editAuto = manager.createRequest('Make a video from the plan', 'project-context', 'auto')
await call('wait_for_edit_request', { agentId: 'test', agentType: 'assistant', agentModel: 'test-model' })
const editing = await call('select_task_workflow', { sessionId: editAuto.sessionId, revision: 1, workflow: 'editing' })
assert.equal(editing.result.structuredContent.data.nextAction, 'list_agent_skills')
assert.deepEqual(editing.result.structuredContent.data.skillFilter, { workflow: 'editing' })
assert.equal(editing.result.structuredContent.data.session.projectId, 'project-context')
await call('activate_luna_window')
assert.equal(activations, 1)
const followUp = await call('update_task_request', { sessionId: editAuto.sessionId, revision: 1, request: '请导出成片' })
assert.equal(followUp.result.structuredContent.data.session.revision, 2)
assert.equal((await call('update_task_request', { sessionId: editAuto.sessionId, revision: 1, request: 'old request' })).result.structuredContent.error.code, 'REQUEST_UPDATED')
assert.equal((await call('select_task_workflow', { sessionId: editAuto.sessionId, revision: 2, workflow: 'editing' })).result.structuredContent.error.code, 'REQUEST_UPDATED', 'follow-up must be acknowledged before more operations')
await call('get_edit_request', { sessionId: editAuto.sessionId })
const pendingExport = manager.waitForExportConfirmation(editAuto.sessionId, 2)
assert.equal((await call('update_task_request', { sessionId: editAuto.sessionId, revision: 2, request: '先不导出' })).result.structuredContent.data.session.revision, 3)
assert.equal((await pendingExport).code, 'REQUEST_UPDATED', 'new user request cancels stale export confirmation')
await call('get_edit_request', { sessionId: editAuto.sessionId })
manager.cancelRequest(editAuto.sessionId)
assert.equal((await call('update_task_request', { sessionId: editAuto.sessionId, revision: 3, request: '继续修改' })).result.structuredContent.data.session.revision, 4)
assert.equal(manager.snapshot().session.cancelRequested, false)
const customSkill = { id: 'future-guide', description: 'A future domain skill', instructions: '# Future instructions' }
options.toolModules = [{ ...module, skills: [customSkill] }]
const futureList = (await call('list_agent_skills', { moduleId: module.id })).result.structuredContent.data.skills
assert.deepEqual(futureList, [{ skillId: customSkill.id, moduleId: module.id, description: customSkill.description }])
assert.equal((await call('list_agent_skills', { query: 'FUTURE DOMAIN' })).result.structuredContent.data.skills[0].skillId, customSkill.id)
assert.equal((await call('get_agent_skill', { skillId: customSkill.id })).result.structuredContent.data.instructions, customSkill.instructions)
options.toolModules = [{ ...module, skills: [{ ...customSkill, instructions: '# Updated without prompt changes' }] }]
assert.match((await call('get_agent_skill', { skillId: customSkill.id })).result.structuredContent.data.instructions, /Updated/)
const countBeforeFilter = rendererCalls
assert.equal((await call('list_agent_skills', { workflow: 'director-plan' })).result.structuredContent.data.skills[0].skillId, 'director-plan')
assert.equal(rendererCalls, countBeforeFilter)
options.toolModules = [{ ...module, skills: [customSkill] }]
assert.throws(() => createToolRegistry([{ ...module, skills: [customSkill, customSkill] }]), /Duplicate skill/)
assert.throws(() => createToolRegistry([{ ...module, skills: [{ ...customSkill, id: 'index' }] }]), /Invalid skill/)
const homeDir = await mkdtemp(join(tmpdir(), 'luna-discovery-'))
const server = createLunaMcpServer({ ...options, homeDir })
try {
  await server.start()
  const first = JSON.parse(await readFile(server.endpointPath, 'utf8'))
  assert.match(await (await fetch(`${first.baseUrl}/skills/director-plan.md`)).text(), /director-plan/)
  const index = await (await fetch(`${first.baseUrl}/skills/index.md`)).text()
  assert.match(index, /select_task_workflow/)
  assert.match(index, /future-guide/)
  assert.equal(await (await fetch(`${first.baseUrl}/skills/future-guide.md`)).text(), '# Future instructions')
  const httpList = await (await fetch(`${first.baseUrl}/api/tools/list_agent_skills`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arguments: { moduleId: module.id } }),
  })).json()
  assert.equal(httpList.ok, true)
  assert.equal(httpList.data.skills[0].skillId, customSkill.id)
  const httpSkill = await (await fetch(`${first.baseUrl}/api/tools/get_agent_skill`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arguments: { skillId: httpList.data.skills[0].skillId } }),
  })).json()
  assert.equal(httpSkill.data.instructions, customSkill.instructions)
  const discoveryTools = (await (await fetch(`${first.baseUrl}/tools`)).json()).tools
  assert.equal(discoveryTools.find(tool => tool.name === 'list_agent_skills')._meta.module, 'agent-skills')
  const api = await (await fetch(`${first.baseUrl}/openapi.json`)).json()
  assert.ok(api.paths['/api/tools/get_agent_skill'])
  await server.stop()
  await assert.rejects(readFile(server.endpointPath))
  await server.start()
  const second = JSON.parse(await readFile(server.endpointPath, 'utf8'))
  assert.match(second.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal((await fetch(`${second.baseUrl}/.well-known/agent`)).status, 200)
  console.log('App module routing, director isolation and stable discovery lifecycle tests passed')
} finally { await server.stop(); await rm(homeDir, { recursive: true, force: true }) }
