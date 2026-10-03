/* global Buffer, setImmediate */

import assert from 'node:assert/strict'

import { buildStartLiveStreamBody } from '../electron/devices/insta360/lunaControlMessages.ts'
import { LunaPreviewControl, supportsPreviewAccessState } from '../electron/devices/insta360/lunaPreviewControl.ts'
import { encodeBytesField, encodeStringField, encodeVarintField } from '../electron/devices/insta360/lunaBleCodec.ts'
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

function firmware(version, module = 1) {
  return encodeBytesField(1, Buffer.concat([encodeVarintField(1, module), encodeStringField(2, version)]))
}

for (const [version, expected] of [['1.1.7', false], ['1.1.8', true], ['1.1.10', true], ['1.2.0', true], ['2.0.0', true]]) {
  assert.equal(supportsPreviewAccessState(firmware(version)), expected)
}
assert.equal(supportsPreviewAccessState(firmware('1.1.8', 2)), false)
assert.equal(supportsPreviewAccessState(Buffer.alloc(0)), false)

function previewSession(version, failureCode) {
  const calls = []
  return {
    calls,
    async sendCommand(code, body) {
      calls.push([code, body.toString('hex')])
      return { code: code === failureCode ? 500 : 200, body: code === 242 ? firmware(version) : Buffer.alloc(0) }
    },
  }
}

const preview = new LunaPreviewControl()
const currentSession = previewSession('1.1.8')
await preview.start(currentSession)
await preview.stop(currentSession)
assert.deepEqual(currentSession.calls, [[242, ''], [118, '0805'], [1, '100130283809400148285012'], [2, ''], [118, '0801']])

const legacySession = previewSession('1.1.7')
await preview.start(legacySession)
await preview.stop(legacySession)
assert.deepEqual(legacySession.calls.map(([code]) => code), [242, 1, 2], 'old firmware must not receive access-state commands')

const failedStart = previewSession('1.1.8', 1)
await assert.rejects(preview.start(failedStart))
assert.deepEqual(failedStart.calls.slice(-2), [[2, ''], [118, '0801']], 'failed start must stop streaming and restore idle')

const failedStop = previewSession('1.1.8', 2)
await preview.start(failedStop)
await assert.rejects(preview.stop(failedStop))
assert.deepEqual(failedStop.calls.at(-1), [118, '0801'], 'stop failure must still close preview access')


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

const secondResponse = await fetch(info.url)
assert.equal(secondResponse.status, 200)
const secondReader = secondResponse.body?.getReader()
assert.ok(secondReader)
await new Promise((resolve) => setImmediate(resolve))
const sharedPayload = Buffer.from('frame-for-both-previews')
server.publish(sharedPayload)
const [firstPreviewChunk, secondPreviewChunk] = await Promise.all([reader.read(), secondReader.read()])
assert.deepEqual(Buffer.from(firstPreviewChunk.value), sharedPayload)
assert.deepEqual(Buffer.from(secondPreviewChunk.value), sharedPayload)

await server.stop()
reader.releaseLock()
secondReader.releaseLock()

console.log('Camera video stream protocol, preview transport, and multi-client fan-out checks passed')
