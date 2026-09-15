/* global Buffer */
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { setTimeout as delay } from 'node:timers/promises'
import { MockCameraServer } from '../../dji_mock_server/server.mjs'
import { decodeTransport, scanFrames, handshakeDatagram, wrapCommand } from '../../dji_mock_server/opc/protocol.js'

export async function openMockSession(t, options = {}) {
  const server = new MockCameraServer({
    host: '127.0.0.1', udpPort: 0, tcpPort: 0, httpPort: 0,
    model: 'pocket4', log: 'json', ...options,
  })
  server.log = () => {}
  await server.listen()
  const socket = dgram.createSocket('udp4')
  t.after(async () => {
    socket.close()
    server.stop()
    await delay(20)
  })
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', resolve)
  })
  const packets = []
  const listeners = new Set()
  socket.on('message', (raw) => {
    const packet = decodeTransport(raw)
    const event = { raw, packet, frames: scanFrames(packet.payload) }
    packets.push(event)
    for (const listener of listeners) listener(event)
  })
  function waitFor(predicate, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(listener)
        reject(new Error('Timed out waiting for DJI Mock packet'))
      }, timeoutMs)
      const listener = (event) => {
        if (!predicate(event)) return
        clearTimeout(timer)
        listeners.delete(listener)
        resolve(event)
      }
      listeners.add(listener)
    })
  }
  function send(packet) {
    return new Promise((resolve, reject) => socket.send(packet, server.udp.address().port, '127.0.0.1', (error) => error ? reject(error) : resolve()))
  }
  const sessionId = 0x7787
  const baseSeq = 0x4400
  const handshakeReply = waitFor(({ packet }) => packet.pktType === 0)
  await send(handshakeDatagram({ sessionId, seq: baseSeq, baseSeq }))
  await handshakeReply

  let transportSeq = baseSeq + 8
  let cmdCounter = 1
  let frameSeq = 0x600
  async function exchange(packet, command) {
    const reply = waitFor(({ frames }) => frames.some((frame) => frame.seq === command.seq && frame.cmdSet === command.cmdSet && frame.cmdId === command.cmdId && frame.flags === (command.cmdSet === 3 || command.cmdSet === 4 ? 0x80 : 0xc0)))
    await send(packet)
    const event = await reply
    return event.frames.find((frame) => frame.seq === command.seq && frame.cmdSet === command.cmdSet && frame.cmdId === command.cmdId).payload
  }
  let lastCommand
  async function issue(overrides) {
    const command = { sender: 2, receiver: 1, seq: frameSeq++, flags: 0x40, payload: Buffer.alloc(0), ...overrides }
    const packet = wrapCommand(command, { sessionId, transportSeq, cmdCounter })
    transportSeq = (transportSeq + 8) & 0xffff
    cmdCounter = (cmdCounter + 1) & 0xff
    lastCommand = { packet, command }
    return exchange(packet, command)
  }
  const register = Buffer.alloc(62)
  register.set([0x41, 0x50, 0x50], 1)
  register[41] = 2
  register.set([2, 8], 50)
  assert.deepEqual(await issue({ receiver: 0x48, flags: 0x80, cmdSet: 0, cmdId: 0x81, payload: register }), Buffer.from([0]))
  assert.deepEqual(await issue({ receiver: 0x28, cmdSet: 0, cmdId: 0x88, payload: Buffer.from('170046237c415050000000000002', 'hex') }), Buffer.from([0]))
  if (server.state.profile.hasGimbal) {
    assert.deepEqual(await issue({ receiver: 3, cmdSet: 3, cmdId: 0xda, payload: Buffer.from('05ffffffff', 'hex') }), Buffer.from([0]))
  }
  const name = Buffer.from('camcap_video_format', 'ascii')
  const subscription = Buffer.alloc(19 + name.length)
  subscription.set([2, 2, 0, 0])
  subscription.writeUInt32LE(0x69df, 4)
  subscription.writeUInt16LE(name.length + 6, 11)
  subscription.writeUInt16LE(name.length, 13)
  // Subscription strings begin after the two length fields.
  name.copy(subscription, 15)
  assert.deepEqual(await issue({ receiver: 0x28, cmdSet: 0, cmdId: 0x99, payload: subscription }), Buffer.from([0]))

  return {
    server, socket, packets, waitFor, issue,
    replay: () => exchange(lastCommand.packet, lastCommand.command),
    baseUrl: 'http://127.0.0.1:' + server.http.address().port,
    async enableLive() {
      assert.deepEqual(await issue(server.state.profile.id === 'nano'
        ? { cmdSet: 2, cmdId: 9, payload: Buffer.from('0000000000000000000003', 'hex') }
        : { cmdSet: 2, cmdId: 0x68, payload: Buffer.from([8]) }), Buffer.from([0]))
      assert.deepEqual(await issue({ receiver: server.state.profile.receiver, cmdSet: 9, cmdId: 0xa8, payload: Buffer.from('00040200000000000000', 'hex') }), Buffer.from([0]))
    },
  }
}
