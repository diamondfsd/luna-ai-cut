/* global Buffer, process */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import dgram from 'node:dgram'

const handshakePayload = Buffer.from(
  '341200640064c005140000640000019001c005140000640014006400c00514000064000101040102',
  'hex',
)

function udpHeader(packetType, payloadLength, sessionId, sequence) {
  const header = Buffer.alloc(8)
  header.writeUInt16LE(0x8000 | ((8 + payloadLength) & 0x3fff), 0)
  header.writeUInt16LE(sessionId, 2)
  header.writeUInt16LE(sequence, 4)
  header[6] = packetType
  header[7] = header.subarray(0, 7).reduce((sum, value) => sum ^ value, 0)
  return header
}

function commandPacket(frame, sessionId, sequence) {
  const routing = Buffer.alloc(12)
  return Buffer.concat([
    udpHeader(0x05, routing.length + frame.length, sessionId, sequence),
    routing,
    frame,
  ])
}

function parsePacket(data) {
  if (data.length < 8) return null
  const total = data.readUInt16LE(0) & 0x3fff
  if (total < 8 || total > data.length) return null
  return { packetType: data[6], payload: data.subarray(8, total) }
}

function send(socket, packet, port) {
  return new Promise((resolve, reject) => {
    socket.send(packet, port, '127.0.0.1', (error) => error ? reject(error) : resolve())
  })
}

function waitForPackets(socket, predicate, count, timeoutMs) {
  return new Promise((resolve, reject) => {
    const packets = []
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error(`等待 DJI Mock 预览包超时（收到 ${packets.length}/${count}）`))
    }, timeoutMs)
    const onMessage = (data) => {
      const packet = parsePacket(data)
      if (!packet || !predicate(packet)) return
      packets.push(packet)
      if (packets.length < count) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(packets)
    }
    socket.on('message', onMessage)
  })
}

async function startMock(model, ports, root) {
  const child = spawn(process.execPath, [
    'dji_mock_server/server.mjs', '--model', model, '--root', root,
    '--http-port', String(ports.http), '--udp-port', String(ports.udp), '--tcp-port', String(ports.tcp),
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('"event":"ready"')) resolve()
    })
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.once('error', reject)
  })
  await ready
  return child
}

async function verifyModel(model, ports, root) {
  const child = await startMock(model, ports, root)
  const socket = dgram.createSocket('udp4')
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, '127.0.0.1', resolve)
    })
    const sessionId = 0x2345
    await send(socket, Buffer.concat([udpHeader(0x00, handshakePayload.length, sessionId, 0), handshakePayload]), ports.udp)
    await waitForPackets(socket, (packet) => packet.packetType === 0x00, 1, 1000)

    const { encodeDjiMessage } = await import('../electron/devices/dji/djiBytes.ts')
    const liveFrame = model === 'pocket3'
      ? encodeDjiMessage({ target: 0x0102, id: 0xa000, flags: 0x40, cmdSet: 0x01, cmdId: 0x01, payload: Buffer.from('0300000000040000000701', 'hex') })
      : encodeDjiMessage({ target: 0x0102, id: 0xa000, flags: 0x40, cmdSet: 0x02, cmdId: 0x68, payload: Buffer.from([0x08]) })
    const packets = waitForPackets(socket, (packet) => packet.packetType === 0x02, 2, 1500)
    await send(socket, commandPacket(liveFrame, sessionId, 8), ports.udp)
    assert.equal((await packets).length, 2)
  } finally {
    socket.close()
    if (!child.killed) child.kill('SIGTERM')
    await once(child, 'close')
  }
}

const root = await mkdtemp(path.join(tmpdir(), 'luna-dji-preview-'))
try {
  await verifyModel('pocket3', { http: 18183, tcp: 17183, udp: 19183 }, root)
  await verifyModel('pocket4', { http: 18184, tcp: 17184, udp: 19184 }, root)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('DJI mock live preview tests passed')
