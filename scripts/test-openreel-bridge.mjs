import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('./luna-openreel-bridge.js', import.meta.url), 'utf8')
const listeners = new Map()
const postedMessages = []
const openReelLogs = []
const rendererLogs = []
const hostWindow = {
  postMessage: (message) => postedMessages.push(message),
  luna: {
    logOpenReel: (...args) => openReelLogs.push(args),
    log: (...args) => rendererLogs.push(args),
  },
}
const iframeWindow = {
  parent: hostWindow,
  addEventListener: (type, listener) => {
    listeners.set(type, listener)
  },
}
const consoleMethods = Object.fromEntries(
  ['debug', 'log', 'info', 'warn', 'error'].map((level) => [level, () => {}]),
)

vm.runInNewContext(source, {
  window: iframeWindow,
  console: consoleMethods,
  Error,
})

assert.equal(openReelLogs.length, 1)
assert.equal(openReelLogs[0][0], 'info')
assert.equal(openReelLogs[0][1], '[OpenReel] [bridge] ready')
assert.equal(rendererLogs.length, openReelLogs.length)
openReelLogs.length = 0
rendererLogs.length = 0

consoleMethods.warn('export warning', { phase: 'render' })
assert.deepEqual(JSON.parse(JSON.stringify(openReelLogs[0])), [
  'warn',
  '[OpenReel] export warning',
  { args: ['{"phase":"render"}'] },
])
assert.deepEqual(JSON.parse(JSON.stringify(rendererLogs[0])), JSON.parse(JSON.stringify(openReelLogs[0])))

listeners.get('error')({
  message: 'render failed',
  filename: 'export.js',
  lineno: 12,
  colno: 4,
  error: new Error('render failed'),
})
assert.equal(openReelLogs[1][0], 'error')
assert.match(openReelLogs[1][1], /^\[OpenReel\] /)
assert.equal(openReelLogs[1][2].error.message, 'render failed')

listeners.get('unhandledrejection')({ reason: new Error('promise failed') })
assert.equal(openReelLogs[2][0], 'error')
assert.match(openReelLogs[2][1], /^\[OpenReel\] /)
assert.equal(openReelLogs[2][2].reason.message, 'promise failed')
assert.equal(rendererLogs.length, openReelLogs.length)

const removeMcpHandler = iframeWindow.openreel.mcp.onRequest(async (request) => ({
  ok: true,
  result: { echoed: request.name, args: request.args },
}))
await listeners.get('message')({
  source: hostWindow,
  data: {
    source: 'luna-host',
    type: 'mcp-request',
    callId: 'mcp-test',
    kind: 'callTool',
    name: 'rename_project',
    args: { name: '测试项目' },
  },
})
assert.deepEqual(JSON.parse(JSON.stringify(postedMessages.at(-1))), {
  source: 'luna-openreel',
  type: 'mcp-response',
  callId: 'mcp-test',
  response: { ok: true, result: { echoed: 'rename_project', args: { name: '测试项目' } } },
})
removeMcpHandler()

console.log('OpenReel bridge logging passed')
