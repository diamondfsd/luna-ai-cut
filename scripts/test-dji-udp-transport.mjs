/* global Buffer */

import assert from 'node:assert/strict'

import {
  buildAckPayload,
  buildRoutingHeader,
  cameraChannelFromPacket,
  nextSequenceForCameraChannel,
} from '../electron/devices/dji/djiUdpProtocol.ts'

const sequence = 0x9008
const routing = buildRoutingHeader(sequence, 0x37)
assert.equal(routing.length, 12)
assert.equal(routing.readUInt16LE(0), 0x9000, '命令 ACK 必须使用前一个本机序号')
assert.equal(routing.readUInt16LE(2), sequence)
assert.equal(routing[8], 0x37)
assert.deepEqual(routing.subarray(4, 8), Buffer.alloc(4))
assert.deepEqual(routing.subarray(10), Buffer.alloc(2))

const ack = buildAckPayload(0x1122, 0x3344, 0x5566)
assert.equal(ack.length, 26)
assert.equal(ack.toString('hex'), '2211221100000000443344330000000066556655000000000000')

assert.equal(
  cameraChannelFromPacket({ packetType: 0x02, sessionId: 1, sequence: 2, payload: Buffer.from('3412', 'hex'), raw: Buffer.alloc(0) }),
  0x1234,
  'reliable packet route prefix must expose camera channel',
)
assert.equal(
  cameraChannelFromPacket({ packetType: 0x00, sessionId: 1, sequence: 2, payload: Buffer.from('3412', 'hex'), raw: Buffer.alloc(0) }),
  0x1234,
  'handshake reply must expose the camera channel before command traffic starts',
)
assert.equal(
  cameraChannelFromPacket({ packetType: 0x04, sessionId: 1, sequence: 2, payload: Buffer.from('3412', 'hex'), raw: Buffer.alloc(0) }),
  null,
  'window ACK payload must not be treated as a camera-channel packet',
)
assert.equal(
  cameraChannelFromPacket({ packetType: 0x05, sessionId: 1, sequence: 2, payload: Buffer.from('3412', 'hex'), raw: Buffer.alloc(0) }),
  0x1234,
  'command replies also carry the camera channel in their route prefix',
)
assert.equal(nextSequenceForCameraChannel(0xfff8), 0x0000, 'camera-channel sequence must wrap')

console.log('DJI UDP transport tests passed')
