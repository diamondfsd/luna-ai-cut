/* global Buffer */

import assert from 'node:assert/strict'

import { consumeFrames, USB_STREAM_VIDEO } from '../electron/media/live-stream/usbAoaProtocol.ts'

function mediaFrame(streamType, timestampUs, body) {
  const payloadLength = 9 + body.length
  const frame = Buffer.alloc(12 + payloadLength + 4)
  Buffer.from('UCD2').copy(frame, 0)
  frame[4] = 1
  frame[5] = 12
  frame[6] = 1
  frame.writeUInt32LE(payloadLength, 8)
  frame[12] = streamType
  frame.writeBigUInt64LE(BigInt(timestampUs), 13)
  body.copy(frame, 21)
  return frame
}

const videoFrame = mediaFrame(USB_STREAM_VIDEO, 1_000_000, Buffer.from([0, 0, 0, 1, 0x26, 1]))
const audioFrame = mediaFrame(0x21, 1_020_000, Buffer.from([0, 0, 0, 0]))

const capturedFrames = []
let pending = Buffer.alloc(0)
const captureBytes = Buffer.concat([videoFrame, audioFrame])
for (let offset = 0; offset < captureBytes.length; offset += 7) {
  pending = consumeFrames(
    Buffer.concat([pending, captureBytes.subarray(offset, offset + 7)]),
    (frame) => capturedFrames.push(frame),
    (reason) => assert.fail(`unexpected invalid frame: ${reason}`),
  )
}
assert.equal(pending.length, 0)
assert.equal(capturedFrames.length, 1)
assert.equal(capturedFrames[0].streamType, USB_STREAM_VIDEO)
assert.deepEqual(capturedFrames[0].body, Buffer.from([0, 0, 0, 1, 0x26, 1]))

console.log('Live USB video-only capture frame parsing checks passed')
