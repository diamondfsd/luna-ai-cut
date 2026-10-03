/* global Buffer */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const root = mkdtempSync(join(tmpdir(), 'luna-ios-receiver-'))
const harnessKey = '__lunaIosReceiverTest'

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kills = []

  kill(signal) {
    this.killed = true
    this.kills.push(signal)
    queueMicrotask(() => this.emit('close', null, signal))
    return true
  }
}

class FakeSocket extends EventEmitter {
  destroyed = false
  writable = true
  writes = []

  write(data, callback) {
    this.writes.push(Buffer.from(data))
    queueMicrotask(() => callback?.(null))
    return true
  }

  destroy() {
    this.destroyed = true
    queueMicrotask(() => this.emit('close'))
  }
}

function createHarness() {
  let now = 0
  let nextTimer = 0
  const timers = new Map()
  const harness = {
    proxies: [], scans: [], sockets: [], throwSpawn: false,
    setTimeout(callback, delay) {
      const timer = ++nextTimer
      timers.set(timer, { callback, due: now + delay })
      return timer
    },
    clearTimeout(timer) { timers.delete(timer) },
    advance(duration) {
      const end = now + duration
      for (;;) {
        const entry = [...timers.entries()].filter(([, value]) => value.due <= end)
          .sort((first, second) => first[1].due - second[1].due)[0]
        if (!entry) break
        timers.delete(entry[0])
        now = entry[1].due
        entry[1].callback()
      }
      now = end
    },
    spawn(_binary, args) {
      if (args[0] !== '-l' && harness.throwSpawn) throw new Error('spawn failed')
      const child = new FakeProcess()
      if (args[0] === '-l') harness.scans.push(child)
      else harness.proxies.push(child)
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
    createConnection() {
      const socket = new FakeSocket()
      harness.sockets.push(socket)
      return socket
    },
    timerCount() { return timers.size },
  }
  return harness
}

function frame(streamType, body) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  const bytes = Buffer.alloc(25 + payload.length)
  bytes.write('UCD2')
  bytes[4] = 1
  bytes[5] = 12
  bytes[6] = 1
  bytes[12] = streamType
  bytes.writeUInt32LE(9 + payload.length, 8)
  payload.copy(bytes, 21)
  return bytes
}

const videoFrame = frame(0x20, Buffer.from([0, 0, 0, 1, 0x26, 1]))
const tick = async () => { await Promise.resolve(); await Promise.resolve() }

try {
  const result = await build({
    entryPoints: ['electron/media/live-stream/iosTcpReceiver.ts'],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    define: {
      setTimeout: `globalThis.${harnessKey}.setTimeout`,
      clearTimeout: `globalThis.${harnessKey}.clearTimeout`,
    },
    plugins: [{ name: 'ios-test-boundaries', setup(builder) {
      builder.onResolve({ filter: /^(?:node:child_process|node:net|usb)$|loggerService$|iosUsbTool$/ }, (args) => ({ path: args.path, namespace: 'ios-test' }))
      builder.onLoad({ filter: /.*/, namespace: 'ios-test' }, ({ path }) => {
        const contents = path.endsWith('iosUsbTool') ? 'export const iosUsbToolBinary = (tool) => `/fixture/ios-usb/${tool}`;' : path === 'node:child_process'
          ? `export const spawn = (...args) => globalThis.${harnessKey}.spawn(...args);`
          : path === 'node:net'
            ? `export const createConnection = (...args) => globalThis.${harnessKey}.createConnection(...args);`
            : path === 'usb' ? 'export default {};'
              : 'export const logMainInfo = () => {}; export const logMainWarn = () => {};'
        return { contents, loader: 'js' }
      })
    } }],
  })
  const bundle = join(root, 'receiver.cjs')
  writeFileSync(bundle, result.outputFiles[0].contents)
  const { IosTcpReceiver } = require(bundle)

  await test('iPhone receiver lifecycle and protocol regressions', async (suite) => {
    async function setup(context) {
      const harness = createHarness()
      globalThis[harnessKey] = harness
      const received = []
      const receiver = new IosTcpReceiver((value) => received.push(value))
      context.after(async () => {
        await receiver.stop()
        await tick()
        assert.equal(harness.timerCount(), 0, 'stop must clear all owned timers')
      })
      receiver.start()
      await tick()
      harness.advance(0)
      return { harness, receiver, received, socket: harness.sockets[0] }
    }

    await suite.test('only valid protocol data confirms connection; video and controls are bidirectional', async (context) => {
      const { receiver, socket, received } = await setup(context)
      socket.emit('connect')
      await tick()
      const probe = JSON.parse(socket.writes[0].subarray(21, -4).toString())
      assert.equal(probe.type, 'capabilities.get')
      assert.equal(receiver.status().controlReady, false)
      await assert.rejects(receiver.sendControl(probe), /尚未连接/)
      socket.emit('data', Buffer.from('not-a-phone'))
      assert.equal(receiver.status().state, 'waiting')
      socket.emit('data', frame(0x31, { requestId: probe.requestId, type: probe.type, ok: true }))
      assert.equal(receiver.status().state, 'connected')
      assert.equal(receiver.status().videoFrames, 0)
      socket.emit('data', videoFrame.subarray(0, 8))
      socket.emit('data', videoFrame.subarray(8))
      assert.equal(receiver.status().state, 'streaming')
      assert.equal(receiver.status().videoFrames, 1)
      assert.equal(received.length, 2)
      await receiver.sendControl({ ...probe, type: 'gimbal.center' })
      assert.equal(socket.writes[1][12], 0x30)
      assert.equal(socket.writes[1][7], (socket.writes[0][7] + 1) & 0xff)
    })

    await suite.test('silent TCP listeners time out without pretending to be an iPhone', async (context) => {
      const { harness, receiver, socket } = await setup(context)
      socket.emit('connect')
      harness.advance(400)
      assert.equal(receiver.status().state, 'waiting')
      harness.advance(9_600)
      assert.equal(socket.destroyed, true)
      assert.equal(receiver.status().controlReady, false)
      harness.advance(1_500)
      assert.equal(harness.sockets.length, 2)
    })

    await suite.test('proxy exit closes its connection and restarts with bounded retries', async (context) => {
      const { harness, receiver, socket } = await setup(context)
      socket.emit('connect')
      socket.emit('data', videoFrame)
      const oldProxy = harness.proxies[0]
      oldProxy.emit('exit', 1, null)
      assert.equal(socket.destroyed, true)
      assert.equal(receiver.status().controlReady, false)
      harness.advance(1_499)
      assert.equal(harness.proxies.length, 1)
      harness.advance(1)
      await tick()
      harness.advance(0)
      assert.equal(harness.proxies.length, 2)
      const replacement = harness.sockets[1]
      replacement.emit('connect')
      replacement.emit('data', videoFrame)
      oldProxy.emit('error', new Error('late old process error'))
      socket.emit('error', new Error('late old socket error'))
      await tick()
      assert.equal(receiver.status().state, 'streaming')
      assert.equal(replacement.destroyed, false)
    })

    await suite.test('failed process startup is retried rather than abandoned', async (context) => {
      const { harness, receiver, socket } = await setup(context)
      harness.proxies[0].emit('error', new Error('missing executable'))
      assert.equal(socket.destroyed, true)
      harness.throwSpawn = true
      harness.advance(1_500)
      assert.equal(receiver.status().controlReady, false)
      assert.equal(harness.proxies.length, 1)
      harness.throwSpawn = false
      harness.advance(1_500)
      await tick()
      harness.advance(0)
      assert.equal(harness.proxies.length, 2)
      assert.equal(harness.sockets.length, 2)
    })

    await suite.test('stop destroys pending sockets and ignores callbacks from the previous session', async (context) => {
      const { harness, receiver, socket, received } = await setup(context)
      const oldScan = harness.scans[0]
      await receiver.stop()
      assert.equal(socket.destroyed, true)
      socket.emit('connect')
      socket.emit('data', videoFrame)
      assert.equal(receiver.status().state, 'idle')
      receiver.start()
      await tick()
      harness.advance(0)
      const current = harness.sockets[1]
      current.emit('connect')
      oldScan.stdout.emit('data', 'old-device\n')
      oldScan.emit('close', 0)
      socket.emit('error', new Error('stale connection'))
      socket.emit('data', videoFrame)
      assert.equal(receiver.status().deviceLabel, null)
      assert.equal(received.length, 0)
      assert.equal(current.destroyed, false)
      current.emit('data', videoFrame)
      assert.equal(receiver.status().state, 'streaming')
    })

    await suite.test('ordinary disconnect reconnects through the existing proxy', async (context) => {
      const { harness, receiver, socket } = await setup(context)
      socket.emit('connect')
      socket.emit('data', videoFrame)
      socket.destroy()
      await tick()
      assert.equal(receiver.status().state, 'waiting')
      harness.advance(1_500)
      assert.equal(harness.proxies.length, 1)
      assert.equal(harness.sockets.length, 2)
      harness.sockets[1].emit('connect')
      harness.sockets[1].emit('data', videoFrame)
      assert.equal(receiver.status().videoFrames, 2)
    })
  })

  await test('real TCP video reaches the local HTTP preview and control requests return to the phone', async (context) => {
    globalThis[harnessKey] = createHarness()
    const sockets = new Set()
    const commands = []
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      let pending = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 12) {
          const totalLength = 16 + pending.readUInt32LE(8)
          if (pending.length < totalLength) break
          const command = JSON.parse(pending.subarray(21, totalLength - 4).toString())
          commands.push(command)
          pending = pending.subarray(totalLength)
          socket.write(frame(0x31, { requestId: command.requestId, type: command.type, ok: true }))
          if (command.type === 'capabilities.get') {
            socket.write(videoFrame.subarray(0, 8))
            socket.write(videoFrame.subarray(8))
          }
        }
      })
    })
    let receiver
    let preview
    const previousPort = process.env.USB_VIDEO_IOS_PROXY_PORT
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 5_000)
    context.after(async () => {
      clearTimeout(timeout)
      abort.abort()
      await receiver?.stop()
      await preview?.stop()
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
      if (previousPort === undefined) delete process.env.USB_VIDEO_IOS_PROXY_PORT
      else process.env.USB_VIDEO_IOS_PROXY_PORT = previousPort
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    process.env.USB_VIDEO_IOS_PROXY_PORT = String(server.address().port)
    const transport = await build({
      stdin: {
        contents: "export { IosTcpReceiver } from './electron/media/live-stream/iosTcpReceiver.ts'; export { LivePreviewStreamService } from './electron/media/live-stream/livePreviewStreamService.ts';",
        resolveDir: process.cwd(),
      },
      bundle: true, write: false, platform: 'node', format: 'cjs',
      plugins: [{ name: 'ios-process-boundaries', setup(builder) {
        builder.onResolve({ filter: /^node:child_process$|^usb$|loggerService$|iosUsbTool$/ }, (args) => ({ path: args.path, namespace: 'ios-test' }))
        builder.onLoad({ filter: /.*/, namespace: 'ios-test' }, ({ path }) => ({
          contents: path.endsWith('iosUsbTool') ? 'export const iosUsbToolBinary = (tool) => `/fixture/ios-usb/${tool}`;' : path === 'node:child_process'
            ? `export const spawn = (...args) => globalThis.${harnessKey}.spawn(...args);`
            : path === 'usb' ? 'export default {};'
              : 'export const logMainInfo = () => {}; export const logMainWarn = () => {};',
          loader: 'js',
        }))
      } }],
    })
    const realBundle = join(root, 'transport.cjs')
    writeFileSync(realBundle, transport.outputFiles[0].contents)
    const actual = require(realBundle)
    preview = new actual.LivePreviewStreamService()
    const info = await preview.start()
    receiver = new actual.IosTcpReceiver((value) => {
      if (value.streamType === 0x20) preview.pushHevcFrame(value.body)
    })
    receiver.start()
    const response = await fetch(info.url, { signal: abort.signal })
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    const chunk = await reader.read()
    assert.deepEqual(Buffer.from(chunk.value), videoFrame.subarray(21, -4))
    assert.equal(receiver.status().state, 'streaming')
    await receiver.sendControl({ version: 1, requestId: 'real-control', delivery: 'transactional', type: 'gimbal.center' })
    const deadline = Date.now() + 2_000
    while (!commands.some((command) => command.requestId === 'real-control')) {
      assert.ok(Date.now() < deadline, 'reverse control must reach the TCP peer')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await reader.cancel()
  })
} finally {
  delete globalThis[harnessKey]
  rmSync(root, { recursive: true, force: true })
}
