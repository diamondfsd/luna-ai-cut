import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHdcForward, createHdcRunner, parseHdcTargets, removeHdcForward } from '../electron/media/live-stream/harmonyHdcClient.ts'
import { HarmonyHdcReceiver } from '../electron/media/live-stream/harmonyHdcReceiver.ts'
import { canProbeUsbAccessory } from '../electron/media/live-stream/usbAccessoryProbe.ts'
import { stageHarmonyHdcResources, verifyHarmonyHdcResources } from './harmony-hdc-resources.mjs'

async function until(predicate) {
  const deadline = Date.now() + 2000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'condition timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
class FakeSocket extends EventEmitter {
  destroyed = false
  writable = true
  writes = []
  write(bytes, callback) { this.writes.push(bytes); callback(); return true }
  destroy() { this.destroyed = true; this.emit('close') }
}
function videoFrame() {
  const packet = Buffer.alloc(31)
  packet.write('UCD2'); packet[4] = 1; packet[5] = 12; packet[6] = 1
  packet.writeUInt32LE(15, 8); packet[12] = 0x20
  packet.writeBigUInt64LE(1000000n, 13)
  Buffer.from([0, 0, 0, 1, 0x26, 1]).copy(packet, 21)
  return packet
}

await test('HDC verbose discovery excludes network targets and exposes unavailable USB phones', () => {
  assert.deepEqual(parseHdcTargets('[Empty]\nPHONE USB Connected\nPHONE USB Connected\nLOCKED USB Unauthorized\nOFF USB Offline\n192.168.1.2:8710 TCP Connected'), [
    { serial: 'PHONE', state: 'device' }, { serial: 'LOCKED', state: 'unauthorized' }, { serial: 'OFF', state: 'offline' },
  ])
})
await test('only a currently connected USB HDC phone prevents Huawei accessory switching', async () => {
  assert.equal(await canProbeUsbAccessory(0x12d1, async () => 'PHONE USB Connected'), false)
  for (const listing of ['PHONE USB Offline', 'PHONE USB Unauthorized', '[Empty]', 'IP TCP Connected']) {
    assert.equal(await canProbeUsbAccessory(0x12d1, async () => listing), true)
  }
  assert.equal(await canProbeUsbAccessory(0x1234, async () => assert.fail('unrelated phone queried HDC')), true)
  assert.equal(await canProbeUsbAccessory(0x12d1, null), true)
  assert.equal(await canProbeUsbAccessory(0x12d1, async () => { throw new Error('unavailable') }), true)
  let listing = 'PHONE USB Connected'
  const run = async () => listing
  assert.equal(await canProbeUsbAccessory(0x12d1, run), false)
  listing = 'PHONE USB Offline'
  assert.equal(await canProbeUsbAccessory(0x12d1, run), true, 'old phone cannot retain ownership')
})
await test('forward creation retries a port conflict; cleanup only removes the owned forward direction', async () => {
  let calls = 0
  const forward = await createHdcForward(async args => {
    assert.deepEqual(args.slice(0, 3), ['-t', 'PHONE', 'fport'])
    assert.equal(args[4], 'tcp:4184')
    if (++calls === 1) throw new Error('port busy')
    return 'Forwardport result:OK'
  }, 'PHONE')
  assert.equal(calls, 2)
  assert.ok(forward.port > 0)
  for (const listing of [`OTHER tcp:${forward.port} tcp:4184 [Forward]`,
    `PHONE tcp:${forward.port} tcp:9999 [Forward]`, `PHONE tcp:${forward.port} tcp:4184 [Reverse]`]) {
    const commands = []
    await removeHdcForward(async args => { commands.push(args); return listing }, forward)
    assert.deepEqual(commands, [['fport', 'ls']])
  }
  const commands = []
  await removeHdcForward(async args => { commands.push(args); return `PHONE tcp:${forward.port} tcp:4184 [Forward]` }, forward)
  assert.deepEqual(commands[1], ['-t', 'PHONE', 'fport', 'rm', `tcp:${forward.port}`, 'tcp:4184'])
})
await test('HDC receives fragmented UCD2, sends controls, reconnects and cleans up its rule', async () => {
  const sockets = [], commands = [], frames = []
  let port, disconnected = 0
  const receiver = new HarmonyHdcReceiver(frame => frames.push(frame), () => disconnected++, {
    run: async args => {
      commands.push(args)
      if (args[0] === 'list') return 'PHONE USB Connected'
      if (args[1] === 'ls') return `PHONE tcp:${port} tcp:4184 [Forward]`
      if (args[2] === 'fport' && args[3] !== 'rm') port = Number(args[3].slice(4))
      return 'OK'
    },
    connect: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
    retryMs: 10, handshakeMs: 500,
  })
  try {
    receiver.start()
    await until(() => sockets.length === 1)
    const socket = sockets[0]
    socket.emit('connect')
    assert.equal(JSON.parse(socket.writes[0].subarray(21, -4)).type, 'capabilities.get')
    const packet = videoFrame()
    socket.emit('data', packet.subarray(0, 8))
    assert.equal(receiver.status().controlReady, false)
    socket.emit('data', packet.subarray(8))
    assert.equal(receiver.status().transport, 'harmony-hdc')
    assert.equal(receiver.status().state, 'streaming')
    assert.equal(frames.length, 1)
    await receiver.sendControl({ version: 1, requestId: 'center', type: 'gimbal.center', delivery: 'priority' })
    assert.equal(socket.writes[1][12], 0x30)
    socket.emit('close')
    assert.equal(disconnected, 1)
    await until(() => sockets.length === 2)
    socket.emit('data', packet)
    assert.equal(frames.length, 1, 'stale socket must be ignored')
  } finally { await receiver.stop() }
  assert.ok(commands.some(args => args[3] === 'rm'))
  assert.equal(commands.some(args => args.includes('kill') || args.includes('reconnect')), false)
})
await test('stop while creating HDC forwarding removes the late result', async () => {
  let release, port
  const commands = []
  const receiver = new HarmonyHdcReceiver(() => assert.fail('unexpected frame'), () => {}, {
    run: async args => {
      commands.push(args)
      if (args[0] === 'list') return 'PHONE USB Connected'
      if (args[1] === 'ls') return `PHONE tcp:${port} tcp:4184 [Forward]`
      if (args[2] === 'fport' && args[3] !== 'rm') {
        port = Number(args[3].slice(4))
        return new Promise(resolve => { release = resolve })
      }
      return 'OK'
    }, connect: () => assert.fail('must not connect after stopping'),
  })
  receiver.start()
  await until(() => release)
  const stopped = receiver.stop()
  release('OK')
  await stopped
  assert.equal(receiver.status().state, 'idle')
  assert.ok(commands.some(args => args[3] === 'rm'))
})
await test('resource staging preserves minimum files and rejects damaged binaries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'luna-hdc-'))
  try {
    assert.equal(stageHarmonyHdcResources(directory, 'darwin', 'arm64'), true)
    assert.equal(verifyHarmonyHdcResources(directory).length, 4)
    writeFileSync(join(directory, 'hdc'), 'damaged')
    assert.throws(() => verifyHarmonyHdcResources(directory), /SHA256/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
await test('HDC runner rejects zero-exit task failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'luna-hdc-runner-'))
  try {
    const binary = join(directory, 'hdc')
    writeFileSync(binary, '#!/bin/sh\nprintf "[Fail] Forwardport failed\\n"\n', { mode: 0o755 })
    await assert.rejects(createHdcRunner(binary)([]), /Forwardport failed/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
await test('Windows staging includes x64 PE binaries and SDK notices; other platforms stay empty', () => {
  const directory = mkdtempSync(join(tmpdir(), 'luna-hdc-windows-'))
  const unsupported = mkdtempSync(join(tmpdir(), 'luna-hdc-intel-'))
  try {
    assert.equal(stageHarmonyHdcResources(directory, 'win32', 'x64'), true)
    assert.equal(verifyHarmonyHdcResources(directory).length, 5)
    writeFileSync(join(directory, 'libusb_shared.dll'), 'damaged')
    assert.throws(() => verifyHarmonyHdcResources(directory), /SHA256/)
    assert.equal(stageHarmonyHdcResources(unsupported, 'darwin', 'x64'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
    rmSync(unsupported, { recursive: true, force: true })
  }
})
