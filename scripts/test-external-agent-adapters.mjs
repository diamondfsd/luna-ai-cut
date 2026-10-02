import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../electron/features/external-agents/externalAgentService.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const exports = {}
vm.runInNewContext(code, { exports, Map, Error })
const calls = []
const adapter = {
  descriptor: { id: 'test', name: 'Test', capabilities: { open: true, download: false, skillInstallation: false, task: 'clipboard' } },
  isInstalled: async () => true,
  open: async () => { calls.push('open') },
}
const service = exports.createExternalAgentService([adapter], {
  openExternal: async url => { calls.push(url) },
  copyText: text => { calls.push(text) },
})
await assert.rejects(() => service.download('test'), /不支持下载/)
await assert.rejects(() => service.installSkill('test'), /不支持安装技能/)
await assert.rejects(() => service.open('../../other'), /不支持此 Agent/)
await assert.rejects(() => service.startTask('test', { prompt: '' }), /有效/)
assert.equal(calls.length, 0)
assert.equal((await service.startTask('test', { prompt: 'create plan' })).mode, 'clipboard')
assert.deepEqual(calls, ['open', 'create plan'])
adapter.isInstalled = async () => false
await assert.rejects(() => service.startTask('test', { prompt: 'task' }), /未检测到/)
assert.equal(calls.length, 2)
const native = { ...adapter, descriptor: { ...adapter.descriptor, id: 'native', capabilities: { ...adapter.descriptor.capabilities, task: 'draft' } }, isInstalled: async () => true, startTask: async () => ({ mode: 'draft' }) }
const nativeService = exports.createExternalAgentService([native], { openExternal: async () => {}, copyText: () => { throw Error('must not copy') } })
assert.equal((await nativeService.startTask('native', { prompt: 'task' })).mode, 'draft')
assert.throws(() => exports.createExternalAgentService([adapter, adapter], {}), /重复/)
console.log('External Agent adapter routing and unsupported capability checks passed')

const protocolSource = fs.readFileSync(new URL('../electron/features/external-agents/protocolLauncher.ts', import.meta.url), 'utf8')
const protocolExports = {}
vm.runInNewContext(ts.transpileModule(protocolSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: protocolExports, Error })
let handler = ''
const opened = []
const launcher = protocolExports.createProtocolLauncher('workbuddy://', {
  getApplicationNameForProtocol: () => handler,
  openExternal: async url => { opened.push(url) },
})
assert.equal(launcher.isRegistered(), false)
assert.equal(await launcher.open(), false)
assert.equal(opened.length, 0)
handler = 'WorkBuddy'
assert.equal(launcher.isRegistered(), true)
assert.equal(opened.length, 0)
assert.equal(await launcher.open(), true)
assert.deepEqual(opened, ['workbuddy://'])
assert.throws(() => protocolExports.createProtocolLauncher('https://example.com', {}), /协议无效/)
console.log('Protocol detection stays passive and opens only registered schemes')

const linkSource = fs.readFileSync(new URL('../electron/features/external-agents/taskLinks.ts', import.meta.url), 'utf8')
const links = {}
vm.runInNewContext(ts.transpileModule(linkSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: links, URL, Error })
const originalPrompt = '创建导演计划\n读取 http://127.0.0.1:12345/skill.md?a=1&b=2\n#旅行 + 100% &autoSend=true'
for (const [build, expected] of [[links.buildWorkBuddyTaskUrl, 'workbuddy:'], [links.buildCodexTaskUrl, 'codex:']]) {
  const url = new URL(build(originalPrompt))
  assert.equal(url.protocol, expected)
  assert.equal(url.searchParams.get('prompt'), originalPrompt)
  assert.equal(url.searchParams.has('autoSend'), false)
}
assert.equal(new URL(links.buildWorkBuddyTaskUrl('task')).searchParams.get('action'), 'start')
assert.equal(new URL(links.buildCodexTaskUrl('task')).pathname, '/new')
assert.throws(() => links.buildWorkBuddyTaskUrl('x'.repeat(8001)), /过长/)
assert.equal(new URL(links.buildWorkBuddyTaskUrl('x'.repeat(8000))).searchParams.get('prompt').length, 8000)
console.log('Task link encoding, draft-only behavior and length checks passed')

const ipcSource = fs.readFileSync(new URL('../electron/ipc/ipcExternalAgentService.ts', import.meta.url), 'utf8')
const ipcExports = {}
const handlers = new Map()
const windowCalls = []
vm.runInNewContext(ts.transpileModule(ipcSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
  exports: ipcExports,
  Error,
  require: name => {
    if (name === 'electron') return { ipcMain: { handle: (name, run) => handlers.set(name, run) }, shell: {}, clipboard: {} }
    if (name.endsWith('externalAgentService')) return { createExternalAgentService: () => ({}) }
    return {}
  },
})
ipcExports.register({ win: {
  isDestroyed: () => false, isMinimized: () => true,
  webContents: { send: (...args) => windowCalls.push(args) },
  restore: () => windowCalls.push('restore'), show: () => windowCalls.push('show'), focus: () => windowCalls.push('focus'),
} })
const openChat = handlers.get('external-agent:open-chat')
assert.throws(() => openChat({}, { purpose: 'unknown' }), /任务无效/)
assert.throws(() => openChat({}, { purpose: 'editing', request: {} }), /任务无效/)
assert.equal(windowCalls.length, 0)
openChat({}, { purpose: 'editing', request: 'edit', projectId: 'project-1', command: 'ignored' })
assert.deepEqual(JSON.parse(JSON.stringify(windowCalls)), [
  ['external-agent:chat-open', { purpose: 'editing', request: 'edit', projectId: 'project-1' }], 'restore', 'show', 'focus',
])

const mergeSource = fs.readFileSync(new URL('../src/components/agent-chat/mergeAgentActivity.ts', import.meta.url), 'utf8')
const mergeExports = {}
vm.runInNewContext(ts.transpileModule(mergeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: mergeExports, Map })
const event = sequence => ({ sequence, session: { sessionId: 'task', progress: sequence } })
const merged = mergeExports.mergeAgentActivity({ session: null, events: [event(1), event(2)] }, [event(3), event(2)])
assert.deepEqual(Array.from(merged.events, value => value.sequence), [1, 2, 3])
assert.equal(merged.session.progress, 3)
assert.equal(mergeExports.mergeAgentActivity(merged, [event(1)]).session.progress, 3)
assert.equal(mergeExports.mergeAgentActivity(merged, Array.from({ length: 250 }, (_, index) => event(index + 4))).events.length, 200)
console.log('Global chat window handoff and concurrent activity replay passed')
