import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const directory = mkdtempSync(join(tmpdir(), 'luna-live-retry-'))
const harness = { receivers: [], previews: [], startGate: null, failStart: false, failStop: false }
globalThis.__lunaLiveRetry = harness
const modules = {
  electron: 'export const app = { getPath: () => "unused" }',
  loggerService: 'export const logMainInfo = () => {}; export const logMainWarn = () => {}',
  usbAoaReceiver: 'export const USB_STREAM_CONTROL_RESULT = 0x31; export const USB_STREAM_VIDEO = 0x20; export const controlDelivery = () => "transactional"',
  appleDeviceSupportService: 'export const getAppleDeviceSupportStatus = async () => ({}); export const getAppleDriverDownloadStatus = () => ({})',
  mediaReceiver: `export function createLiveMediaReceiver(onFrame, onDisconnected) {
    const h = globalThis.__lunaLiveRetry;
    const receiver = { onFrame, onDisconnected, stopped: false, value: { state: 'waiting', transport: 'ios-tcp', controlReady: false },
      status() { return { ...this.value } },
      start() { if (h.failStart) throw new Error('start failed') },
      async stop() { this.stopped = true; if (h.failStop) throw new Error('stop failed') }
    }; h.receivers.push(receiver); return receiver;
  }`,
  livePreviewStreamService: `export class LivePreviewStreamService {
    constructor() { this.stopped = false; globalThis.__lunaLiveRetry.previews.push(this) }
    async start() { await globalThis.__lunaLiveRetry.startGate }
    status() { return { url: 'http://local/preview', error: null } }
    async stop() { this.stopped = true }
    pushHevcFrame() {}
  }`,
}
try {
  const bundle = await build({
    entryPoints: ['electron/media/live-stream/liveStreamService.ts'],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'live-retry-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => {
        const name = path.split('/').pop()
        if (name in modules) return { path: name, namespace: 'fixture' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: modules[path], loader: 'js' }))
    } }],
  })
  const file = join(directory, 'service.cjs')
  writeFileSync(file, bundle.outputFiles[0].text)
  process.env.LUNA_PHONE_RECONNECT_GRACE_MS = '120'
  const service = require(file)
  await test('live session recovery without restarting the application', async () => {
    await service.startLiveStream()
    const old = harness.receivers.at(-1)
    old.value.state = 'error'
    harness.failStop = true
    await service.startLiveStream()
    assert.equal(old.stopped, true)
    assert.equal(harness.previews[0].stopped, true, 'preview cleanup survives receiver shutdown failure')
    assert.notEqual(harness.receivers.at(-1), old, 'retry creates a fresh receiver')
    old.onDisconnected()
    await Promise.resolve()
    assert.equal((await service.getLiveStreamStatus()).state, 'waiting-usb', 'old disconnect cannot stop the new session')
    await assert.rejects(service.stopLiveStream(), /stop failed/)
    assert.equal((await service.getLiveStreamStatus()).state, 'idle', 'failed shutdown still clears the session')
    harness.failStop = false
    await service.stopLiveStream()
    let releaseStart
    harness.startGate = new Promise((resolve) => { releaseStart = resolve })
    const starting = service.startLiveStream()
    const stopping = service.stopLiveStream()
    releaseStart()
    await Promise.all([starting, stopping])
    assert.equal((await service.getLiveStreamStatus()).state, 'idle', 'stop requested during startup really stops')
    harness.startGate = null
    await service.startLiveStream()
    harness.receivers.at(-1).value.state = 'waiting'
    await service.startLiveStream()
    assert.equal(harness.receivers.at(-2).stopped, true, 'waiting session can be retried')
    await service.stopLiveStream()
    harness.failStart = true
    await assert.rejects(service.startLiveStream(), /start failed/)
    assert.equal((await service.getLiveStreamStatus()).state, 'idle', 'startup failure releases the active session')
    assert.equal(harness.previews.at(-1).stopped, true)
    harness.failStart = false
    await service.startLiveStream()
    assert.equal((await service.getLiveStreamStatus()).state, 'waiting-usb')
    await service.stopLiveStream()
  })

  await test('a phone reconnect inside the grace window keeps the desktop session', async () => {
    await service.startLiveStream()
    const receiver = harness.receivers.at(-1)
    receiver.value.state = 'streaming'
    receiver.value.state = 'waiting'
    receiver.onDisconnected()
    assert.equal((await service.getLiveStreamStatus()).state, 'waiting-usb', 'drop alone does not stop the session')
    receiver.value.state = 'streaming'
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal((await service.getLiveStreamStatus()).state, 'running', 'reconnected phone resumes without a manual retry')
    await service.stopLiveStream()
  })

  await test('a phone that stays away stops the desktop session', async () => {
    await service.startLiveStream()
    const receiver = harness.receivers.at(-1)
    receiver.value.state = 'streaming'
    receiver.value.state = 'waiting'
    receiver.onDisconnected()
    assert.equal((await service.getLiveStreamStatus()).state, 'waiting-usb')
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal((await service.getLiveStreamStatus()).state, 'idle', 'session stops once the phone stops coming back')
  })
} finally {
  delete globalThis.__lunaLiveRetry
  rmSync(directory, { recursive: true, force: true })
}
