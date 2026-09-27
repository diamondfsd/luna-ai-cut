/* global Buffer */

import assert from 'node:assert/strict'

import { consumeFrames, USB_STREAM_AUDIO, USB_STREAM_VIDEO } from '../electron/media/live-stream/usbAoaProtocol.ts'

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
const audioBody = Buffer.alloc(16)
audioBody[0] = 1
audioBody.writeUInt32LE(48_000, 2)
audioBody[6] = 1
audioBody.writeUInt32LE(2, 8)
audioBody.writeInt16LE(1200, 12)
audioBody.writeInt16LE(-1200, 14)
const audioFrame = mediaFrame(USB_STREAM_AUDIO, 1_020_000, audioBody)

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
assert.equal(capturedFrames.length, 2)
assert.equal(capturedFrames[0].streamType, USB_STREAM_VIDEO)
assert.deepEqual(capturedFrames[0].body, Buffer.from([0, 0, 0, 1, 0x26, 1]))
assert.equal(capturedFrames[1].audio?.sampleRate, 48_000)
assert.equal(capturedFrames[1].audio?.sampleCount, 2)

console.log('Live USB capture frame parsing checks passed')
