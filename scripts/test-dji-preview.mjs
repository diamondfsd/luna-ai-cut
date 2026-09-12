/* global Buffer */

import assert from 'node:assert/strict'

import {
  DJI_PREVIEW_FIRST_MARKER,
  DjiPreviewReassembler,
} from '../electron/devices/dji/djiPreview.ts'

function u32le(value) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value, 0)
  return bytes
}

function previewPacket(fragment, sequence, fragmentHeader = Buffer.alloc(12)) {
  const payload = Buffer.concat([fragmentHeader, fragment])
  const total = 8 + payload.length
  const header = Buffer.alloc(8)
  header.writeUInt16LE(0x8000 | total, 0)
  header.writeUInt16LE(0x1234, 2)
  header.writeUInt16LE(sequence, 4)
  header[6] = 0x02
  header[7] = header.subarray(0, 7).reduce((sum, byte) => sum ^ byte, 0)
  const raw = Buffer.concat([header, payload])
  return { packetType: 0x02, sessionId: 0x1234, sequence, payload, raw }
}

function legacyPreviewPacket(fragment, sequence, frameNo, position) {
  const fragmentHeader = Buffer.alloc(12)
  fragmentHeader[8] = frameNo
  fragmentHeader[9] = (position & 1) === 1 ? 0x80 : 0x00
  fragmentHeader[10] = position >> 1
  return previewPacket(fragment, sequence, fragmentHeader)
}

const hevc = Buffer.from([
  0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0x02,
  0x00, 0x00, 0x01, 0x42, 0x03, 0x04,
  0x00, 0x00, 0x01, 0x44, 0x05,
  0x00, 0x00, 0x01, 0x26, 0x06,
])
const first = Buffer.concat([
  DJI_PREVIEW_FIRST_MARKER,
  u32le(hevc.length),
  Buffer.alloc(8),
  hevc.subarray(0, 11),
])
const continuation = hevc.subarray(11)
const units = []
const reassembler = new DjiPreviewReassembler((unit) => units.push(unit))

assert.equal(reassembler.feed(previewPacket(first, 0x1000)), null)
const unit = reassembler.feed(previewPacket(continuation, 0x1008))
assert.ok(unit)
assert.deepEqual(unit.data, hevc)
assert.deepEqual(unit.nalTypes, [32, 33, 34, 19])
assert.equal(unit.parts, 2)
assert.deepEqual(units, [unit])

assert.equal(reassembler.feed(previewPacket(continuation, 0x1008)), null)
const snapshot = reassembler.snapshot()
assert.equal(snapshot.completedMessages, 1)
assert.equal(snapshot.accessUnitsWithVps, 1)
assert.equal(snapshot.accessUnitsWithSps, 1)
assert.equal(snapshot.accessUnitsWithPps, 1)
assert.equal(snapshot.accessUnitsWithIdr, 1)
assert.equal(snapshot.duplicatePackets, 1)

const singlePacket = new DjiPreviewReassembler()
const singlePacketUnit = singlePacket.feed(previewPacket(Buffer.concat([
  DJI_PREVIEW_FIRST_MARKER,
  u32le(hevc.length),
  Buffer.alloc(8),
  hevc,
]), 0x1100))
assert.ok(singlePacketUnit, 'a complete sized frame in one datagram must emit immediately')
assert.deepEqual(singlePacketUnit.data, hevc)
assert.equal(singlePacketUnit.parts, 1)

const avc = Buffer.from([
  0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1f,
  0x00, 0x00, 0x01, 0x68, 0xee, 0x06,
  0x00, 0x00, 0x01, 0x65, 0x88, 0x84,
])
const legacyFirst = Buffer.concat([
  DJI_PREVIEW_FIRST_MARKER,
  u32le(0),
  Buffer.alloc(8),
  avc.subarray(0, 12),
])
const legacy = new DjiPreviewReassembler()
assert.equal(legacy.feed(legacyPreviewPacket(legacyFirst, 0x2000, 1, 0)), null)
assert.equal(legacy.feed(legacyPreviewPacket(avc.subarray(12), 0x2008, 1, 1)), null)
const legacyUnit = legacy.feed(legacyPreviewPacket(legacyFirst, 0x2010, 2, 0))
assert.ok(legacyUnit)
assert.equal(legacyUnit.codec, 'h264')
assert.deepEqual(legacyUnit.data, avc)
assert.equal(legacyUnit.parts, 2)

const legacyWithSequenceGap = new DjiPreviewReassembler()
assert.equal(legacyWithSequenceGap.feed(legacyPreviewPacket(legacyFirst, 0x3000, 3, 0)), null)
assert.equal(legacyWithSequenceGap.feed(legacyPreviewPacket(avc.subarray(12), 0x3020, 3, 1)), null)
const gapUnit = legacyWithSequenceGap.feed(legacyPreviewPacket(legacyFirst, 0x3028, 4, 0))
assert.ok(gapUnit, 'legacy Pocket 3 frames must use fragment positions, not strict transport sequence')
assert.deepEqual(gapUnit.data, avc)
assert.equal(legacyWithSequenceGap.snapshot().sequenceGaps, 1)

const invalidRaw = Buffer.from(previewPacket(first, 0x1010).raw)
invalidRaw[7] ^= 0xff
const invalidPacket = { packetType: 0x02, sessionId: 0x1234, sequence: 0x1010, payload: invalidRaw.subarray(8), raw: invalidRaw }
assert.equal(reassembler.feed(invalidPacket), null)
assert.equal(reassembler.snapshot().invalidTransportPackets, 1)

const bounded = new DjiPreviewReassembler(undefined, true, false, 8)
assert.equal(bounded.feed(previewPacket(first, 0x1020)), null)
assert.equal(bounded.snapshot().invalidFirstFragments, 1)

console.log('DJI live preview reassembler tests passed')
