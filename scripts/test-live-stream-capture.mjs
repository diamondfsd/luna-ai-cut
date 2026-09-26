/* global Buffer */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { consumeFrames, USB_STREAM_AUDIO, USB_STREAM_VIDEO } from '../electron/media/live-stream/usbAoaProtocol.ts'
import { normalizeLiveStreamPcm } from '../electron/media/live-stream/liveStreamAudio.ts'
import { buildLiveStreamFfmpegArgs } from '../electron/media/live-stream/liveStreamFfmpegArgs.ts'
import { canQueueLiveStreamInput } from '../electron/media/live-stream/liveStreamInputBuffer.ts'
import { groupAccessUnits, splitNalUnits } from '../src/lib/annexB.ts'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')

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

const normalized = normalizeLiveStreamPcm({
  sampleRate: 24_000,
  channels: 2,
  sampleCount: 2,
  pcm16Le: Buffer.from([0xe8, 0x03, 0x18, 0xfc, 0xd0, 0x07, 0x30, 0xf8]),
})
assert.equal(normalized?.length, 8, 'audio replay must use the same mono 48 kHz normalization')

const args = buildLiveStreamFfmpegArgs({ enhanceQuality: false })
assert.equal(args.includes('-re'), false, 'live/replayed pipe inputs must not be paced a second time')
assert.equal(args[args.indexOf('-analyzeduration') + 1], '2250000', 'video probing should cover the first keyframe without the default five-second wait')
assert.equal(canQueueLiveStreamInput(32_768, 80_000, 512 * 1024), true, 'a pending drain should not drop a frame while the bounded queue has room')
assert.equal(canQueueLiveStreamInput(500_000, 80_000, 512 * 1024), false, 'input should be dropped when it would exceed the queue limit')
const audioInputIndex = args.indexOf('pipe:3')
const audioAnalysisIndex = args.indexOf('-analyzeduration', args.indexOf('-analyzeduration') + 1)
assert.ok(audioInputIndex > 0 && audioAnalysisIndex < audioInputIndex, 'audio input should have its own analysis limit')
assert.equal(args[audioAnalysisIndex + 1], '100000')
assert.ok(args.includes('-muxdelay') && args[args.indexOf('-muxdelay') + 1] === '0')
assert.ok(args.includes('-flush_packets') && args[args.indexOf('-flush_packets') + 1] === '1')

const encoded = spawnSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
  '-frames:v', '6', '-an', '-c:v', 'libx265', '-preset', 'ultrafast',
  '-x265-params', 'pools=1:frame-threads=1:log-level=error',
  '-f', 'hevc', 'pipe:1',
], { maxBuffer: 4 * 1024 * 1024 })
assert.equal(encoded.status, 0, encoded.stderr.toString())
const accessUnits = groupAccessUnits(splitNalUnits(encoded.stdout), 'h265')
assert.ok(accessUnits.length >= 5, 'test HEVC source should contain multiple frames')

const tempDirectory = mkdtempSync(join(tmpdir(), 'luna-live-capture-'))
const capturePath = join(tempDirectory, 'sample.ucd2')
const capturedVideo = accessUnits.map((unit, index) => mediaFrame(
  USB_STREAM_VIDEO,
  1_000_000 + index * 100_000,
  Buffer.from(unit.data),
))
writeFileSync(capturePath, Buffer.concat(capturedVideo))

const replayScript = join(dirname(fileURLToPath(import.meta.url)), 'replay-live-stream-capture.mjs')
const replay = spawn(process.execPath, [
  '--experimental-strip-types', replayScript, capturePath, '--once',
], { stdio: ['ignore', 'pipe', 'pipe'] })
const replayClosed = once(replay, 'close')
let stdout = ''
let stderr = ''
replay.stdout.setEncoding('utf8')
replay.stderr.setEncoding('utf8')
replay.stdout.on('data', (chunk) => { stdout += chunk })
replay.stderr.on('data', (chunk) => { stderr += chunk })
const streamUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out waiting for replay URL')), 10_000)
  const checkOutput = () => {
    const match = stdout.match(/OBS stream: (http:\/\/127\.0\.0\.1:\d+\/stream)/)
    if (match) {
      clearTimeout(timer)
      resolve(match[1])
    }
  }
  replay.stdout.on('data', checkOutput)
  replay.once('error', (error) => { clearTimeout(timer); reject(error) })
  replay.once('close', (code) => {
    if (!stdout.includes('OBS stream:')) {
      clearTimeout(timer)
      reject(new Error(`Replay exited before publishing: ${stderr || code}`))
    }
  })
  checkOutput()
})

try {
  const response = await fetch(streamUrl)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'video/mp2t')
  const reader = response.body?.getReader()
  assert.ok(reader)
  const firstChunk = await reader.read()
  assert.equal(firstChunk.done, false)
  assert.ok(Buffer.from(firstChunk.value).includes(0x47), 'replay should publish MPEG-TS packets')
  await reader.cancel()
  const [exitCode, signal] = await replayClosed
  assert.equal(exitCode, 0, stderr || `unexpected signal ${signal}`)
} finally {
  if (replay.exitCode == null && replay.signalCode == null) replay.kill('SIGTERM')
  rmSync(tempDirectory, { recursive: true, force: true })
}

console.log('Live stream capture parsing, audio normalization, and low-latency args checks passed')
