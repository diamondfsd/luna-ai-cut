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
const homeDir = await mkdtemp(join(tmpdir(), 'luna-discovery-'))
const server = createLunaMcpServer({ ...options, homeDir })
try {
  await server.start()
  const first = JSON.parse(await readFile(server.endpointPath, 'utf8'))
  assert.match(await (await fetch(`${first.baseUrl}/skills/director-plan.md`)).text(), /director-plan/)
  await server.stop()
  await assert.rejects(readFile(server.endpointPath))
  await server.start()
  const second = JSON.parse(await readFile(server.endpointPath, 'utf8'))
  assert.match(second.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal((await fetch(`${second.baseUrl}/.well-known/agent`)).status, 200)
  console.log('App module routing, director isolation and stable discovery lifecycle tests passed')
} finally { await server.stop(); await rm(homeDir, { recursive: true, force: true }) }
