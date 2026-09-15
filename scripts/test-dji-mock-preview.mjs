/* global Buffer, process */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { DjiPreviewReassembler } from '../electron/devices/dji/djiPreview.ts'
import { parseMockArgs } from '../dji_mock_server/server.mjs'
import { configureMockLogging } from '../dji_mock_server/logging.mjs'
import { openMockSession } from './helpers/djiMockSession.mjs'
import './test-dji-mock-client-preview.mjs'

test('DJI Mock default logging suppresses packet floods but retains diagnostics', () => {
  const events = []
  const server = { log: (event, details) => events.push({ event, details }) }
  configureMockLogging(server)
  for (let index = 0; index < 1000; index += 1) {
    server.log('rx', { pktType: '0x04' })
    server.log('tx', { label: 'video' })
    server.log('command', { valid: true })
    server.log('invalid', { reason: 'bad frame' })
    server.log('command', { valid: false, reason: 'invalid delete payload' })
  }
  server.log('ready')
  server.log('error', { error: 'socket error' })
  server.log('stop')
  assert.deepEqual(events.map(({ event }) => event), ['invalid', 'command', 'ready', 'error', 'stop'])
  const verbose = { log: (event) => events.push({ event }) }
  configureMockLogging(verbose, true)
  verbose.log('rx')
  assert.equal(events.at(-1).event, 'rx')
  assert.equal(parseMockArgs(['--verbose-log']).verboseLog, true)
})

test('DJI preview entrypoint starts the copied service with existing root alias', async (t) => {
  assert.equal(parseMockArgs([]).strictProtocol, true)
  assert.equal(parseMockArgs(['--root', '/tmp']).mediaRoot, path.resolve('/tmp'))
  assert.throws(() => parseMockArgs(['--unknown']), /unknown argument/)
  const child = spawn(process.execPath, ['dji_mock_server/server.mjs', '--udp-port', '0', '--tcp-port', '0', '--http-port', '0'])
  const closed = once(child, 'close')
  t.after(async () => { child.kill('SIGTERM'); await closed })
  await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Mock startup timeout')), 3000)
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      const events = output.trim().split('\n').flatMap((line) => {
        try { return [JSON.parse(line)] } catch { return [] }
      })
      if (events.filter((event) => event.event === 'ready').length !== 3) return
      clearTimeout(timer)
      resolve()
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('Mock exited: ' + code)) })
  })
})

for (const model of ['pocket3', 'pocket4', 'pocket4pro', 'nano']) {
  test('DJI preview strict UDP reassembles complete frames for ' + model, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'luna-dji-preview-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const source = path.join(root, 'preview.hex')
    const codec = model === 'pocket3' || model === 'nano' ? 'h264' : 'h265'
    const accessUnit = Buffer.concat([
      Buffer.from(codec === 'h264' ? '000000016764001f0000000168ee06000000016588' : '0000000140010200000001420304000000014405000000012606', 'hex'),
      Buffer.alloc(2500, 0x55),
    ])
    await writeFile(source, accessUnit.toString('hex') + '\n', 'ascii')
    const session = await openMockSession(t, { model, videoSource: source })
    const units = []
    let onUnit
    const nextUnit = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview frame reassembly timeout')), 1500)
      onUnit = (unit) => { clearTimeout(timer); onUnit = undefined; resolve(unit) }
    })
    const reassembler = new DjiPreviewReassembler((unit) => { units.push(unit); onUnit?.(unit) })
    session.socket.on('message', (raw) => {
      if (raw[6] !== 2) return
      reassembler.feed({ raw, packetType: 2, sessionId: raw.readUInt16LE(2), sequence: raw.readUInt16LE(4), payload: raw.subarray(8) })
    })
    const firstFrame = nextUnit()
    await session.enableLive()
    await firstFrame
    assert.ok(units.length > 0, 'Mock fragments must produce a complete preview frame')
    assert.deepEqual(units[0].data, accessUnit)
    assert.equal(units[0].codec, codec)
    assert.equal(units[0].parts, 3)
    assert.equal(reassembler.snapshot().droppedPartialMessages, 0)

    const fault = async (value) => {
      const response = await fetch(session.baseUrl + '/control', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'fault', name: 'dropVideo', value }),
      })
      assert.equal(response.status, 200)
      await response.json()
    }
    await fault(true)
    await delay(50)
    const count = units.length
    await delay(80)
    assert.equal(units.length, count)
    const resumed = nextUnit()
    await fault(false)
    await resumed
    assert.ok(units.length > count)
    assert.deepEqual(units.at(-1).data, accessUnit)
    assert.equal(session.server.metrics.rejectedCommands, 0)
  })
}
