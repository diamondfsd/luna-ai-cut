import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseAdbDevices, removeAdbForward } from '../electron/media/live-stream/androidAdbClient.ts'
import { AndroidAdbReceiver } from '../electron/media/live-stream/androidAdbReceiver.ts'
import { stageAndroidAdbResources, verifyAndroidAdbResources } from './android-adb-resources.mjs'

const tick = () => new Promise((resolve) => setImmediate(resolve))
async function until(predicate) {
  const deadline = Date.now() + 3_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'condition must complete within timeout')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function frame(streamType, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  const packet = Buffer.alloc(25 + bytes.length)
  packet.write('UCD2')
  packet[4] = 1
  packet[5] = 12
  packet[6] = 1
  packet.writeUInt32LE(9 + bytes.length, 8)
  packet[12] = streamType
  packet.writeBigUInt64LE(1_000_000n, 13)
  bytes.copy(packet, 21)
  return packet
}

class FakeSocket extends EventEmitter {
  destroyed = false
  writable = true
  writes = []
  write(bytes, callback) { this.writes.push(bytes); callback(); return true }
  destroy() { this.destroyed = true; this.emit('close') }
}

function fixture(overrides = {}) {
  const commands = []
  const sockets = []
  const received = []
  let disconnected = 0
  let output = 'List of devices attached\nPHONE\tdevice product:test model:test transport_id:1'
  const run = async (args) => {
    commands.push(args)
    if (args[0] === 'devices') return output
    if (args.includes('--list')) return 'PHONE tcp:12345 tcp:4184\nOTHER tcp:12346 tcp:1234'
    if (args.includes('tcp:0')) return '12345'
    return ''
  }
  const receiver = new AndroidAdbReceiver((value) => received.push(value), () => { disconnected += 1 }, {
    run,
    connect: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
    retryMs: 15, handshakeMs: 500,
    ...overrides,
  })
  return { receiver, commands, sockets, received, setDevices: (next) => { output = next }, disconnections: () => disconnected }
}

await test('only USB candidates are accepted; unauthorized/offline and multiple phones remain visible', async () => {
  assert.deepEqual(parseAdbDevices('List of devices attached\nPHONE device product:p\nPHONE device\nBLOCKED unauthorized\nOFF offline\nemulator-5554 device\n192.168.1.2:5555 device\nadb-PHONE._adb-tls-connect._tcp device'), [
    { serial: 'PHONE', state: 'device' }, { serial: 'BLOCKED', state: 'unauthorized' }, { serial: 'OFF', state: 'offline' },
  ])
  for (const output of ['PHONE unauthorized', 'PHONE offline', 'PHONE device\nOTHER device']) {
    const current = fixture()
    current.setDevices(output)
    current.receiver.start()
    await tick()
    assert.equal(current.receiver.status().state, 'error')
    assert.equal(current.sockets.length, 0)
    assert.equal(current.commands.some((command) => command.includes('forward')), false)
    await current.receiver.stop()
  }
})

await test('valid frames enable controls; confirmed disconnect notifies once and stale sockets cannot affect reconnect', async () => {
  const current = fixture()
  try {
    current.receiver.start()
    await until(() => current.sockets.length === 1)
    const socket = current.sockets[0]
    socket.emit('connect')
    await tick()
    const probe = JSON.parse(socket.writes[0].subarray(21, -4).toString())
    assert.equal(probe.type, 'capabilities.get')
    assert.equal(current.receiver.status().controlReady, false)
    socket.emit('data', Buffer.from('invalid input'))
    assert.equal(current.receiver.status().controlReady, false)
    socket.emit('data', frame(0x31, { requestId: probe.requestId, type: probe.type, ok: true }))
    const video = frame(0x20, Buffer.from([0, 0, 0, 1, 0x26, 1]))
    socket.emit('data', video.subarray(0, 8))
    socket.emit('data', video.subarray(8))
    assert.equal(current.receiver.status().state, 'streaming')
    await current.receiver.sendControl({ ...probe, type: 'gimbal.center' })
    assert.equal(socket.writes[1][12], 0x30)
    socket.emit('close')
    assert.equal(current.disconnections(), 1)
    assert.equal(current.receiver.status().controlReady, false)
    await until(() => current.sockets.length === 2)
    const replacement = current.sockets[1]
    replacement.emit('connect')
    replacement.emit('data', video)
    socket.emit('error', new Error('late socket error'))
    socket.emit('data', video)
    assert.equal(current.disconnections(), 1)
    assert.equal(current.receiver.status().state, 'streaming')
  } finally { await current.receiver.stop() }
  assert.equal(current.disconnections(), 1, 'intentional stop must not report a physical disconnect')
  assert.ok(current.commands.some((command) => command.includes('--remove') && command.includes('tcp:12345')))
  assert.equal(current.commands.some((command) => command.includes('--remove-all') || command.includes('kill-server')), false)
})

await test('stop during forward creation rolls back the late result without opening a socket', async () => {
  let release
  let forwarding = false
  const commands = []
  const current = fixture({ run: async (args) => {
    commands.push(args)
    if (args[0] === 'devices') return 'PHONE device'
    if (args.includes('tcp:0')) {
      forwarding = true
      return await new Promise((resolve) => { release = resolve })
    }
    if (args.includes('--list')) return 'PHONE tcp:12345 tcp:4184'
    return ''
  } })
  current.receiver.start()
  await until(() => forwarding)
  const stopped = current.receiver.stop()
  release('12345')
  await stopped
  assert.equal(current.sockets.length, 0)
  assert.equal(current.receiver.status().state, 'idle')
  assert.ok(commands.some((command) => command.includes('--remove')))
})

await test('cleanup never removes another device or repurposed forwarding rule', async () => {
  for (const output of ['OTHER tcp:12345 tcp:4184', 'PHONE tcp:12345 tcp:9999']) {
    const commands = []
    await removeAdbForward(async (args) => { commands.push(args); return output }, { serial: 'PHONE', port: 12345 })
    assert.deepEqual(commands, [['forward', '--list']])
  }
})

await test('real TCP forwarding carries fragmented video and reverse controls; unplug requests preview closure', async () => {
  const clients = new Set()
  const received = []
  const commands = []
  let disconnected = 0
  const server = createServer((socket) => {
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    let pending = Buffer.alloc(0)
    socket.on('data', (bytes) => {
      pending = Buffer.concat([pending, bytes])
      while (pending.length >= 12) {
        const length = 16 + pending.readUInt32LE(8)
        if (pending.length < length) return
        const command = JSON.parse(pending.subarray(21, length - 4).toString())
        commands.push(command)
        pending = pending.subarray(length)
        socket.write(frame(0x31, { requestId: command.requestId, type: command.type, ok: true }))
        if (command.type === 'capabilities.get') {
          const video = frame(0x20, Buffer.from([0, 0, 0, 1, 0x26, 1]))
          socket.write(video.subarray(0, 8))
          socket.write(video.subarray(8))
        }
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const receiver = new AndroidAdbReceiver((value) => received.push(value), () => { disconnected += 1 }, {
    run: async (args) => args[0] === 'devices' ? 'PHONE device' : args.includes('tcp:0') ? String(port)
      : args.includes('--list') ? `PHONE tcp:${port} tcp:4184` : '',
    retryMs: 100, handshakeMs: 500,
  })
  try {
    receiver.start()
    await until(() => receiver.status().state === 'streaming')
    assert.equal(received.filter((value) => value.streamType === 0x20).length, 1)
    await receiver.sendControl({ version: 1, requestId: 'control-test', delivery: 'transactional', type: 'gimbal.center' })
    await until(() => commands.some((command) => command.requestId === 'control-test'))
    for (const socket of clients) socket.destroy()
    await until(() => disconnected === 1)
    assert.equal(receiver.status().controlReady, false)
  } finally {
    await receiver.stop()
    for (const socket of clients) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
})

await test('packaging includes only the verified minimum, licenses and provenance; bad or extra files are rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'luna-adb-resources-'))
  try {
    assert.equal(verifyAndroidAdbResources().length, 4)
    stageAndroidAdbResources(directory)
    assert.equal(verifyAndroidAdbResources(directory).length, 4)
    writeFileSync(join(directory, 'fastboot.exe'), 'not permitted')
    assert.throws(() => verifyAndroidAdbResources(directory), /未登记/)
    rmSync(join(directory, 'fastboot.exe'))
    writeFileSync(join(directory, 'adb.exe'), 'damaged')
    assert.throws(() => verifyAndroidAdbResources(directory), /SHA256/)
    cpSync('resources/android-adb/win-x64/adb.exe', join(directory, 'adb.exe'))
    rmSync(join(directory, 'AdbWinUsbApi.dll'))
    assert.throws(() => verifyAndroidAdbResources(directory), /AdbWinUsbApi/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
