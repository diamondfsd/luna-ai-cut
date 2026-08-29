/* global Buffer, setImmediate */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { connect } from 'node:net'

import { buildStartLiveStreamBody } from '../electron/devices/insta360/lunaControlMessages.ts'
import { MEDIA_VIDEO, UCD2_MEDIA, parseMediaFrame } from '../electron/devices/insta360/insta360TcpCodec.ts'
import { LocalObsVideoStreamServer } from '../electron/devices/common/localObsVideoStreamServer.ts'
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

async function readRtspResponse(socket) {
  let buffered = Buffer.alloc(0)
  while (true) {
    const headerEnd = buffered.indexOf('\r\n\r\n')
    if (headerEnd >= 0) {
      const header = buffered.subarray(0, headerEnd + 4).toString('utf8')
      const contentLength = Number.parseInt(/^Content-Length:\s*(\d+)/im.exec(header)?.[1] ?? '0', 10)
      if (buffered.length >= headerEnd + 4 + contentLength) return buffered
    }
    const [chunk] = await once(socket, 'data')
    buffered = Buffer.concat([buffered, chunk])
  }
}

async function rtspRequest(socket, method, url, cseq, headers = {}) {
  const requestHeaders = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')
  const response = readRtspResponse(socket)
  socket.write(`${method} ${url} RTSP/1.0\r\nCSeq: ${cseq}\r\n${requestHeaders}${requestHeaders ? '\r\n' : ''}\r\n`)
  return response
}

const rtspServer = new LocalObsVideoStreamServer()
const rtspInfo = await rtspServer.start('h264', 0)
const rtspSocket = connect({ host: '127.0.0.1', port: rtspInfo.port })
await once(rtspSocket, 'connect')
const rtspUrl = rtspInfo.url
assert.match((await rtspRequest(rtspSocket, 'OPTIONS', rtspUrl, 1)).toString('utf8'), /RTSP\/1\.0 200 OK/)
const describe = (await rtspRequest(rtspSocket, 'DESCRIBE', rtspUrl, 2, { Accept: 'application/sdp' })).toString('utf8')
assert.match(describe, /Content-Type: application\/sdp/i)
assert.match(describe, /a=rtpmap:96 H264\/90000/)
const setup = (await rtspRequest(rtspSocket, 'SETUP', `${rtspUrl}/trackID=0`, 3, {
  Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1',
})).toString('utf8')
assert.match(setup, /Transport: RTP\/AVP\/TCP;unicast;interleaved=0-1/i)
const session = /Session:\s*([^\r\n]+)/i.exec(setup)?.[1]
assert.ok(session)
assert.match((await rtspRequest(rtspSocket, 'PLAY', rtspUrl, 4, { Session: session })).toString('utf8'), /RTSP\/1\.0 200 OK/)

const h264AccessUnit = Buffer.from('000000016742e01f0102030000000168ce060e000000016501020304', 'hex')
rtspServer.publishVideoFrame(h264AccessUnit, 0)
const [rtpFrame] = await once(rtspSocket, 'data')
assert.equal(rtpFrame[0], 0x24)
assert.equal(rtpFrame[1], 0)
assert.equal(rtpFrame.readUInt16BE(2), rtpFrame.length - 4)
assert.equal(rtpFrame[4] & 0xc0, 0x80)
assert.equal(rtpFrame[5] & 0x7f, 96)
assert.equal(rtpFrame[16], 0x67)
rtspSocket.destroy()
await rtspServer.stop()

console.log('Camera video stream protocol and local server checks passed')
