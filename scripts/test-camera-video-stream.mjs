/* global Buffer, setImmediate */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'

import { buildStartLiveStreamBody } from '../electron/devices/insta360/lunaControlMessages.ts'
import { MEDIA_VIDEO, UCD2_MEDIA, parseMediaFrame } from '../electron/devices/insta360/insta360TcpCodec.ts'
import { LocalObsVideoStreamServer } from '../electron/devices/common/localObsVideoStreamServer.ts'
import { LocalVideoStreamServer } from '../electron/devices/common/localVideoStreamServer.ts'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')

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
const bufferedPayload = Buffer.from('buffered-before-client')
server.publish(bufferedPayload)
const response = await fetch(info.url)
assert.equal(response.status, 200)
const reader = response.body?.getReader()
assert.ok(reader)
const bufferedChunk = await reader.read()
assert.deepEqual(Buffer.from(bufferedChunk.value), bufferedPayload)
await new Promise((resolve) => setImmediate(resolve))
server.publish(payload)
const chunk = await reader.read()
assert.deepEqual(Buffer.from(chunk.value), payload)
await server.stop()
reader.releaseLock()

const rawServer = new LocalVideoStreamServer()
const rawInfo = await rawServer.start()
const obsServer = new LocalObsVideoStreamServer(undefined, ffmpegPath)
const obsInfo = await obsServer.start(rawInfo.url, 'h264')
const obsResponse = await fetch(obsInfo.url)
assert.equal(obsResponse.status, 200)
assert.equal(obsResponse.headers.get('content-type'), 'video/mp2t')
const obsReader = obsResponse.body?.getReader()
assert.ok(obsReader)

const encoder = spawn(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30',
  '-t', '1', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
  '-pix_fmt', 'yuv420p', '-g', '30', '-f', 'h264', 'pipe:1',
], { stdio: ['ignore', 'pipe', 'ignore'] })
encoder.stdout.on('data', (chunk) => rawServer.publish(chunk))
const firstObsChunk = await obsReader.read()
assert.equal(firstObsChunk.done, false)
assert.ok(Buffer.from(firstObsChunk.value).includes(0x47), 'OBS output should contain MPEG-TS packets')
encoder.kill('SIGTERM')
await once(encoder, 'close')
await obsServer.stop()
await rawServer.stop()
obsReader.releaseLock()

console.log('Camera video stream protocol and OBS output checks passed')
