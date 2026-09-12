/* global Buffer */

import assert from 'node:assert/strict'

import {
  djiPocketFirstPictureKick,
  djiPocketFirstPictureOriginal,
  djiPocketVideoFormatPayload,
  parseDjiPocketSubscribePush,
  parseDjiPocketVideoFormats,
} from '../electron/devices/dji/djiPocketProtocol.ts'

function u16le(value) {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16LE(value, 0)
  return bytes
}

function subscribePush(name, value) {
  const nameBytes = Buffer.from(name, 'utf8')
  const innerLength = 2 + nameBytes.length + 6 + 2 + value.length
  return Buffer.concat([
    Buffer.from([0x02, 0x06, 0x00, 0x00]),
    Buffer.alloc(4),
    Buffer.alloc(3),
    u16le(innerLength),
    u16le(nameBytes.length),
    nameBytes,
    Buffer.alloc(6),
    u16le(value.length),
    value,
  ])
}

const status = parseDjiPocketSubscribePush(subscribePush('cam_video_param_v2', Buffer.from([0x10, 0x02])))
assert.ok(status)
assert.equal(status.name, 'cam_video_param_v2')
assert.deepEqual(status.value, Buffer.from([0x10, 0x02]))

const capabilities = Buffer.concat([
  Buffer.from([0x01]),
  u16le(1 + 3 * 3),
  Buffer.from([3, 0x10, 0x01, 0, 0x10, 0x02, 0, 0x0a, 0x02, 0]),
])
assert.deepEqual(parseDjiPocketVideoFormats(capabilities), [
  { resolution: 0x10, frameRate: 0x01 },
  { resolution: 0x10, frameRate: 0x02 },
  { resolution: 0x0a, frameRate: 0x02 },
])

const original = djiPocketFirstPictureOriginal({ resolution: 0x10, frameRate: 0x02 })
const kick = djiPocketFirstPictureKick(original, parseDjiPocketVideoFormats(capabilities))
assert.deepEqual(kick, { resolution: 0x0a, frameRate: 0x02 })
assert.deepEqual(djiPocketVideoFormatPayload(kick), Buffer.from([0x0a, 0x02, 0, 0, 0]))
assert.deepEqual(
  djiPocketFirstPictureKick({ resolution: 0x10, frameRate: 0x03 }),
  { resolution: 0x0a, frameRate: 0x03 },
)
assert.equal(parseDjiPocketSubscribePush(Buffer.from([0x02, 0x06])), null)

console.log('DJI Pocket protocol tests passed')
