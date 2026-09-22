#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const MAGIC = Buffer.from([0x55, 0x43, 0x44, 0x32])
const MEDIA_TYPE = 0x01
const VIDEO_STREAM_TYPE = 0x20
const MAX_FRAME_BYTES = 32 * 1024 * 1024

export function encodeMediaFrame(sequence, timestampMicros, hevc) {
  const rawLength = 9 + hevc.length
  const frame = Buffer.allocUnsafe(12 + rawLength + 4)
  MAGIC.copy(frame, 0)
  frame[4] = 0x01
  frame[5] = 0x0c
  frame[6] = MEDIA_TYPE
  frame[7] = sequence & 0xff
  frame.writeUInt32LE(rawLength, 8)
  frame[12] = VIDEO_STREAM_TYPE
  frame.writeBigUInt64LE(BigInt(timestampMicros), 13)
  hevc.copy(frame, 21)
  frame.fill(0, frame.length - 4)
  return frame
}

export function parseMediaFrame(frame) {
  if (frame.length < 12) return { status: 'incomplete' }
  if (!frame.subarray(0, 4).equals(MAGIC)) return { status: 'invalid', reason: 'magic' }

  const rawLength = frame.readUInt32LE(8)
  const totalLength = 12 + rawLength + 4
  if (rawLength < 9 || totalLength > MAX_FRAME_BYTES) {
    return { status: 'invalid', reason: 'length' }
  }
  if (frame.length < totalLength) return { status: 'incomplete' }
  if (frame[6] !== MEDIA_TYPE) return { status: 'unsupported', totalLength, reason: 'media-type' }

  const payload = frame.subarray(12, 12 + rawLength)
  if (payload[0] !== VIDEO_STREAM_TYPE) {
    return { status: 'unsupported', totalLength, reason: 'stream-type' }
  }

  const hevc = payload.subarray(9)
  if (hevc.length === 0) return { status: 'invalid', reason: 'empty-payload' }
  return {
    status: 'ok',
    totalLength,
    sequence: frame[7],
    timestampMicros: payload.readBigUInt64LE(1),
    hevc,
  }
}

export function consumeFrames(pending, onFrame, onInvalid = () => undefined) {
  let buffer = pending
  while (buffer.length > 0) {
    const magicAt = buffer.indexOf(MAGIC)
    if (magicAt < 0) return buffer.subarray(Math.max(0, buffer.length - MAGIC.length + 1))
    if (magicAt > 0) buffer = buffer.subarray(magicAt)

    const parsed = parseMediaFrame(buffer)
    if (parsed.status === 'incomplete') return buffer
    if (parsed.status !== 'ok') {
      if (parsed.status === 'invalid') onInvalid(parsed.reason)
      buffer = buffer.subarray(parsed.totalLength ?? MAGIC.length)
      continue
    }

    onFrame(parsed)
    buffer = buffer.subarray(parsed.totalLength)
  }
  return buffer
}

function runSelfTest() {
  const hevc = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0xaa])
  const frame = encodeMediaFrame(7, 123456, hevc)
  const parsed = parseMediaFrame(frame)
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.sequence, 7)
  assert.equal(parsed.timestampMicros, 123456n)
  assert.deepEqual(parsed.hevc, hevc)

  const split = Buffer.concat([Buffer.from([0x00, 0x11]), frame, frame])
  const frames = []
  const pending = consumeFrames(split, (value) => frames.push(value))
  assert.equal(pending.length, 0)
  assert.equal(frames.length, 2)
  console.log('[self-test] UCD2 encode/parse/split/coalesced checks passed')
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function printHelp() {
  console.log(`Usage: node desktop_virtual_camera/tools/receive-luna-stream.mjs [options]

Options:
  --host <address>       Listen address, default 127.0.0.1
  --port <port>          Listen port, default 4184
  --output <file>        Write received HEVC Annex-B access units
  --timeout <seconds>    Fail when no frame arrives within this time
  --max-frames <count>   Exit successfully after this many frames
  --self-test            Validate the UCD2 parser without opening a socket
  --help                 Show this help
`)
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

async function runReceiver() {
  const host = argumentValue('--host', '127.0.0.1')
  const port = positiveInteger(argumentValue('--port', '4184'), 'port')
  const timeoutSeconds = Number.parseInt(argumentValue('--timeout', '0'), 10)
  const maxFramesRaw = argumentValue('--max-frames', '0')
  const maxFrames = Number.parseInt(maxFramesRaw, 10)
  const outputPath = argumentValue('--output', null)

  let socket = null
  let pending = Buffer.alloc(0)
  let frames = 0
  let bytes = 0
  let lastSequence = null
  let finishing = false
  const output = outputPath ? createWriteStream(outputPath) : null
  const startedAt = Date.now()

  const server = createServer((connection) => {
    socket?.destroy()
    socket = connection
    const peer = `${connection.remoteAddress ?? 'unknown'}:${connection.remotePort ?? 0}`
    console.log(`[receiver] connected: ${peer}`)

    connection.on('data', (chunk) => {
      pending = consumeFrames(
        Buffer.concat([pending, chunk]),
        (frame) => {
          frames += 1
          bytes += frame.totalLength
          lastSequence = frame.sequence
          output?.write(frame.hevc)
          if (frames === 1) {
            console.log(`[receiver] first HEVC access unit: ${frame.hevc.length} bytes, timestamp=${frame.timestampMicros}`)
          } else if (frames % 30 === 0) {
            const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001)
            console.log(`[receiver] frames=${frames} bytes=${bytes} rate=${(frames / seconds).toFixed(1)} fps`)
          }
          if (maxFrames > 0 && frames >= maxFrames) void finish(0)
        },
        (reason) => console.warn(`[receiver] discarded invalid UCD2 frame: ${reason}`),
      )
    })
    connection.on('error', (error) => console.error(`[receiver] socket error: ${error.message}`))
    connection.on('close', () => {
      if (socket === connection) socket = null
      console.log(`[receiver] disconnected: ${peer}`)
    })
  })

  const timer = timeoutSeconds > 0
    ? setTimeout(() => {
        if (frames === 0) {
          console.error(`[receiver] no UCD2 frame received within ${timeoutSeconds}s`)
          void finish(1)
        }
      }, timeoutSeconds * 1000)
    : null

  async function finish(code) {
    if (finishing) return
    finishing = true
    if (timer) clearTimeout(timer)
    socket?.destroy()
    await new Promise((resolve) => server.close(() => resolve()))
    if (output) await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()))
    console.log(JSON.stringify({ frames, bytes, lastSequence, output: outputPath }, null, 2))
    process.exitCode = code
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  console.log(`[receiver] listening on ${host}:${port}`)

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => void finish(0))
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  try {
    if (hasFlag('--help')) printHelp()
    else if (hasFlag('--self-test')) runSelfTest()
    else await runReceiver()
  } catch (error) {
    console.error(`[receiver] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
