import assert from 'node:assert/strict'

import {
  encodeVirtualCameraFrame,
  VIRTUAL_CAMERA_FRAME_HEADER_BYTES,
  VIRTUAL_CAMERA_FRAME_MAGIC,
} from '../electron/macVirtualCamera.ts'

const payload = new Uint8Array([0, 0, 0, 1, 0x65, 0x88])
const encoded = encodeVirtualCameraFrame({
  type: 3,
  flags: 3,
  sequence: 42,
  timestampUs: '123456',
  payload,
})

assert.equal(encoded.byteLength, VIRTUAL_CAMERA_FRAME_HEADER_BYTES + payload.byteLength)
assert.deepEqual(encoded.subarray(0, 4), VIRTUAL_CAMERA_FRAME_MAGIC)
assert.equal(encoded.readUInt8(4), 1)
assert.equal(encoded.readUInt8(5), 3)
assert.equal(encoded.readUInt16LE(6), 3)
assert.equal(encoded.readBigUInt64LE(8), 123456n)
assert.equal(encoded.readUInt32LE(16), 42)
assert.equal(encoded.readUInt32LE(20), payload.byteLength)
assert.deepEqual(encoded.subarray(VIRTUAL_CAMERA_FRAME_HEADER_BYTES), Buffer.from(payload))

console.log('mac camera bridge frame protocol tests passed')
