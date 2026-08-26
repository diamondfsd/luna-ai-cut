import assert from 'node:assert/strict'

import { buildStartLiveStreamBody } from '../electron/devices/insta360/lunaControlMessages.ts'
import { MEDIA_VIDEO, UCD2_MEDIA, parseMediaFrame } from '../electron/devices/insta360/insta360TcpCodec.ts'
import { LocalVideoStreamServer } from '../electron/devices/common/localVideoStreamServer.ts'

function mediaFrame(data, substream = MEDIA_VIDEO) {
  const header = Buffer.from('55434432010c0107', 'hex')
  const media = Buffer.concat([Buffer.from([substream, 0x25, 0xde, 0xa9, 0, 0, 0, 0, 0]), data])
  const length = Buffer.alloc(4)
  length.writeUInt32LE(media.length, 0)
  return Buffer.concat([header, length, media, Buffer.alloc(4)])
}

assert.deepEqual(
  buildStartLiveStreamBody(),
  Buffer.from('100130283809400148285012', 'hex'),
  'START_LIVE_STREAM must match the mobile-app validated body',
)

const payload = Buffer.from('0000000167010203', 'hex')
const parsed = parseMediaFrame(mediaFrame(payload))
assert.deepEqual(parsed, { substream: MEDIA_VIDEO, data: payload })
assert.equal(parseMediaFrame(mediaFrame(payload, 0x40))?.substream, 0x40)
assert.equal(UCD2_MEDIA, 0x01)

const server = new LocalVideoStreamServer()
const info = await server.start()
const response = await fetch(info.url)
assert.equal(response.status, 200)
const reader = response.body?.getReader()
assert.ok(reader)
await new Promise((resolve) => setImmediate(resolve))
server.publish(payload)
const chunk = await reader.read()
assert.deepEqual(Buffer.from(chunk.value), payload)
await server.stop()
reader.releaseLock()

console.log('Camera video stream protocol and local server checks passed')
