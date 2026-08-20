import assert from 'node:assert/strict'

import {
  BRIDGE_FLAGS,
  BRIDGE_HEADER_BYTES,
  BRIDGE_MAGIC,
  BRIDGE_TRAILER_BYTES,
  BRIDGE_TYPES,
  BRIDGE_VERSION,
  BridgeFrameParser,
} from '../electron/cameraBridgeProtocol.ts'

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function encodeFrame({ type, flags = 0, sequence, timestampUs, payload }) {
  const header = Buffer.alloc(BRIDGE_HEADER_BYTES)
  BRIDGE_MAGIC.copy(header, 0)
  header.writeUInt8(BRIDGE_VERSION, 4)
  header.writeUInt8(type, 5)
  header.writeUInt16LE(flags, 6)
  header.writeBigUInt64LE(BigInt(timestampUs), 8)
  header.writeUInt32LE(sequence, 16)
  header.writeUInt32LE(payload.length, 20)
  const body = Buffer.concat([header, payload])
  const trailer = Buffer.alloc(BRIDGE_TRAILER_BYTES)
  trailer.writeUInt32LE(crc32(body), 0)
  return Buffer.concat([body, trailer])
}

const hello = encodeFrame({
  type: BRIDGE_TYPES.HELLO,
  sequence: 1,
  timestampUs: 1000,
  payload: Buffer.from('{"transport":"android-aoa"}'),
})
const video = encodeFrame({
  type: BRIDGE_TYPES.VIDEO,
  flags: BRIDGE_FLAGS.KEYFRAME | BRIDGE_FLAGS.ANNEX_B | BRIDGE_FLAGS.END_OF_FRAME,
  sequence: 2,
  timestampUs: 2000,
  payload: Buffer.from([0, 0, 0, 1, 0x65, 0x88]),
})

const parser = new BridgeFrameParser()
const input = Buffer.concat([Buffer.from([0x12, 0x34]), hello, video])
const frames = []
for (let offset = 0; offset < input.length; offset += 3) frames.push(...parser.push(input.subarray(offset, offset + 3)))
assert.equal(frames.length, 2)
assert.equal(frames[0].type, BRIDGE_TYPES.HELLO)
assert.equal(frames[0].sequence, 1)
assert.equal(frames[1].type, BRIDGE_TYPES.VIDEO)
assert.equal(frames[1].flags & BRIDGE_FLAGS.KEYFRAME, BRIDGE_FLAGS.KEYFRAME)
assert.deepEqual(frames[1].payload, Buffer.from([0, 0, 0, 1, 0x65, 0x88]))

const corrupted = Buffer.from(video)
corrupted[corrupted.length - 1] ^= 0xff
assert.equal(parser.push(corrupted).length, 0)
assert.equal(parser.errors.at(-1), 'USB Bridge CRC 校验失败')

console.log('camera bridge protocol tests passed')
