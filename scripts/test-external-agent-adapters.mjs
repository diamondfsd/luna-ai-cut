import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../electron/features/external-agents/externalAgentService.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
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
vm.runInNewContext(ts.transpileModule(protocolSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: protocolExports, Error })
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
vm.runInNewContext(ts.transpileModule(linkSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: links, URL, Error })
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
