/* global Buffer */

import assert from 'node:assert/strict'

import {
  buildStreamHello,
  inspectFrameChecksum,
} from '../electron/devices/insta360/insta360TcpCodec.ts'

const streamVectors = new Map([
  [0x24, '55434432010c052400000000f6cc4f09'],
  [0x25, '55434432010c052500000000abfd9c1e'],
  [0x26, '55434432010c0526000000004caee926'],
  [0x33, '55434432010c05330000000002528417'],
])

for (const [seq, expectedHex] of streamVectors) {
  const frame = buildStreamHello(seq)
  assert.equal(frame.toString('hex'), expectedHex, `STREAM vector mismatch for seq=0x${seq.toString(16)}`)
  assert.deepEqual(inspectFrameChecksum(frame), {
    received: frame.readUInt32LE(12),
    calculated: frame.readUInt32LE(12),
    ok: true,
  })
}

console.log('Luna TCP heartbeat vectors passed')
