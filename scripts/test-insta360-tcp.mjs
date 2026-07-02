#!/usr/bin/env node
import net from 'node:net'
import { Buffer } from 'node:buffer'
import { createWriteStream } from 'node:fs'
import { resolve } from 'node:path'

const rawArgs = process.argv.slice(2)
const requestAuth = rawArgs.includes('--request-auth')
const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('--'))
const host = positionalArgs[0] ?? '192.168.42.1'
const port = Number(positionalArgs[1] ?? 6666)
const logFileArg = positionalArgs[2]
const logFile = resolve(logFileArg ?? `insta360-tcp-test-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
const logStream = createWriteStream(logFile, { flags: 'a' })
const UCD2_MAGIC = Buffer.from('UCD2')
const UCD2_VERSION = 0x01
const UCD2_FLAGS = 0x0c
const UCD2_MSG = 0x03
const UCD2_FILE = 0x04
const UCD2_STREAM = 0x05
const CODE_GET_OPTIONS = 8
const CODE_CHECK_AUTHORIZATION = 39
const CODE_REQUEST_AUTHORIZATION = 86
const CODE_PHONE_INFO = 220
const PACKET_CHECKSUM_POLY = 0x04c11db7

let seq = 0x24
let requestId = 1
let rxBuffer = Buffer.alloc(0)

function now() {
  return new Date().toISOString()
}

function log(message, detail) {
  let line
  if (detail === undefined) {
    line = `[${now()}] ${message}`
  } else {
    line = `[${now()}] ${message} ${JSON.stringify(detail)}`
  }
  console.log(line)
  logStream.write(`${line}\n`)
}

function hex(buffer, max = 256) {
  const sliced = buffer.subarray(0, max)
  const text = sliced.toString('hex').replace(/(..)/g, '$1 ').trim()
  return buffer.length > max ? `${text} ... (+${buffer.length - max} bytes)` : text
}

function ascii(buffer) {
  return buffer
    .toString('latin1')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nextSeq() {
  const value = seq & 0xff
  seq = (seq + 1) & 0xff
  return value
}

function wireVarint(value) {
  const out = []
  let v = value >>> 0
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v & 0x7f)
  return Buffer.from(out)
}

function wireFieldVarint(field, value) {
  return Buffer.concat([wireVarint(field << 3), wireVarint(value)])
}

function wireFieldBytes(field, value) {
  return Buffer.concat([wireVarint((field << 3) | 2), wireVarint(value.length), value])
}

function buildMessageEnvelope(messageCode, body, req) {
  return Buffer.concat([
    wireFieldVarint(1, req),
    wireFieldVarint(2, messageCode),
    wireFieldBytes(3, body),
  ])
}

function parseVarint(buffer, offset) {
  let value = 0
  let shift = 0
  while (offset < buffer.length) {
    const byte = buffer[offset++]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7
  }
  return { value, offset }
}

function parseMessageEnvelope(buffer) {
  let offset = 0
  const message = { requestId: 0, messageCode: 0, body: Buffer.alloc(0) }
  while (offset < buffer.length) {
    const tag = parseVarint(buffer, offset)
    offset = tag.offset
    const field = tag.value >> 3
    const wireType = tag.value & 0x07
    if (wireType === 0) {
      const parsed = parseVarint(buffer, offset)
      offset = parsed.offset
      if (field === 1) message.requestId = parsed.value
      else if (field === 2) message.messageCode = parsed.value
    } else if (wireType === 2) {
      const parsed = parseVarint(buffer, offset)
      offset = parsed.offset
      const bytes = buffer.subarray(offset, offset + parsed.value)
      offset += parsed.value
      if (field === 3) message.body = Buffer.from(bytes)
    } else {
      break
    }
  }
  return message
}

function buildPacketChecksumTable() {
  const table = []
  for (let i = 0; i < 256; i += 1) {
    let value = (i << 24) | 0
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x80000000) !== 0
        ? ((value << 1) ^ PACKET_CHECKSUM_POLY) | 0
        : (value << 1) | 0
    }
    table.push(value >>> 0)
  }
  return table
}

const PACKET_CHECKSUM_TABLE = buildPacketChecksumTable()

function insta360PacketChecksum(frameWithoutTrailer) {
  let checksum = 0xffffffff | 0
  for (const byte of frameWithoutTrailer) {
    checksum = (checksum ^ byte) | 0
    for (let i = 0; i < 4; i += 1) {
      checksum = ((checksum << 8) ^ PACKET_CHECKSUM_TABLE[(checksum >>> 24) & 0xff]) | 0
    }
  }
  return checksum >>> 0
}

function checksumTrailer(frameWithoutTrailer) {
  const trailer = Buffer.alloc(4)
  trailer.writeUInt32LE(insta360PacketChecksum(frameWithoutTrailer), 0)
  return trailer
}

function buildUcd2(type, payload, forcedSeq) {
  const header = Buffer.alloc(8)
  UCD2_MAGIC.copy(header, 0)
  header[4] = UCD2_VERSION
  header[5] = UCD2_FLAGS
  header[6] = type
  header[7] = forcedSeq ?? nextSeq()
  return Buffer.concat([header, payload])
}

function buildStreamHello(mode) {
  const tail =
    mode === 'pcap'
      ? Buffer.from('f6cc4f09', 'hex')
      : mode === 'zero'
        ? Buffer.alloc(4)
        : Buffer.from('f6cc4f09', 'hex')
  return buildUcd2(UCD2_STREAM, Buffer.concat([Buffer.alloc(4), tail]))
}

function buildRawFileCommand(code, body) {
  const req = requestId++
  const raw = Buffer.alloc(9 + body.length)
  raw.writeUInt16LE(code, 0)
  raw[2] = 0x02
  raw.writeUInt16LE(req, 3)
  raw.writeUInt32LE(0x8000, 5)
  body.copy(raw, 9)

  const length = Buffer.alloc(4)
  length.writeUInt32LE(raw.length, 0)
  const frameWithoutTrailer = buildUcd2(UCD2_FILE, Buffer.concat([length, raw]))
  const trailer = checksumTrailer(frameWithoutTrailer)
  const packet = Buffer.concat([frameWithoutTrailer, trailer])
  return { packet, req, trailer }
}

function buildMsgCommand(code, body = Buffer.alloc(0)) {
  const req = requestId++
  const envelope = buildMessageEnvelope(code, body, req)
  const packet = buildUcd2(UCD2_MSG, envelope)
  return { packet, req, body }
}

function buildMsgNotify(code, body = Buffer.alloc(0)) {
  const envelope = buildMessageEnvelope(code, body, 0)
  const packet = buildUcd2(UCD2_MSG, envelope)
  return { packet, body }
}

function parseRaw(payload) {
  if (payload.length < 17) return null
  const rawLen = payload.readUInt32LE(0)
  if (payload.length < 4 + rawLen + 4) return null
  const raw = payload.subarray(4, 4 + rawLen)
  return {
    rawLen,
    code: raw.readUInt16LE(0),
    kind: raw[2],
    requestId: raw.readUInt16LE(3),
    flags: raw.readUInt32LE(5),
    body: raw.subarray(9),
    trailer: payload.subarray(4 + rawLen, 4 + rawLen + 4),
  }
}

function describeFrame(frame) {
  const type = frame[6]
  const seqNo = frame[7]
  if (type === UCD2_STREAM) {
    log('RX STREAM', { seq: seqNo, bytes: frame.length, payload: hex(frame.subarray(8)) })
    return
  }
  if (type === UCD2_MSG) {
    const msg = parseMessageEnvelope(frame.subarray(8))
    log('RX MSG', {
      seq: seqNo,
      bytes: frame.length,
      requestId: msg.requestId,
      messageCode: msg.messageCode,
      bodyBytes: msg.body.length,
      bodyHex: hex(msg.body),
      bodyAscii: ascii(msg.body),
    })
    return
  }
  if (type !== UCD2_FILE) {
    log('RX UCD2 other', { type, seq: seqNo, bytes: frame.length, payload: hex(frame.subarray(8)) })
    return
  }

  const raw = parseRaw(frame.subarray(8))
  if (!raw) {
    log('RX FILE unparsable', { seq: seqNo, bytes: frame.length, payload: hex(frame.subarray(8)) })
    return
  }
  log('RX FILE raw', {
    seq: seqNo,
    rawLen: raw.rawLen,
    code: raw.code,
    kind: raw.kind,
    requestId: raw.requestId,
    flags: `0x${raw.flags.toString(16)}`,
    bodyBytes: raw.body.length,
    trailer: hex(raw.trailer),
    bodyHex: hex(raw.body),
    bodyAscii: ascii(raw.body),
  })
}

function onData(data) {
  log('RX bytes', { bytes: data.length, hex: hex(data) })
  rxBuffer = Buffer.concat([rxBuffer, data])
  while (rxBuffer.length >= 8) {
    const start = rxBuffer.indexOf(UCD2_MAGIC)
    if (start < 0) {
      log('RX drop non-UCD2 bytes', { bytes: rxBuffer.length, hex: hex(rxBuffer) })
      rxBuffer = Buffer.alloc(0)
      return
    }
    if (start > 0) {
      log('RX skip prefix', { bytes: start, hex: hex(rxBuffer.subarray(0, start)) })
      rxBuffer = rxBuffer.subarray(start)
    }
    if (rxBuffer.length < 8) return
    const type = rxBuffer[6]
    const frameLen =
      type === UCD2_STREAM
        ? 16
        : type === UCD2_MSG
          ? (() => {
              const nextMagic = rxBuffer.indexOf(UCD2_MAGIC, 8)
              return nextMagic > 0 ? nextMagic : rxBuffer.length
            })()
        : type === UCD2_FILE && rxBuffer.length >= 12
          ? 12 + rxBuffer.readUInt32LE(8) + 4
          : 0
    if (frameLen === 0) {
      log('RX unknown UCD2 type', { type, header: hex(rxBuffer.subarray(0, 8)) })
      rxBuffer = rxBuffer.subarray(8)
      continue
    }
    if (rxBuffer.length < frameLen) return
    const frame = rxBuffer.subarray(0, frameLen)
    rxBuffer = rxBuffer.subarray(frameLen)
    describeFrame(frame)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function send(socket, label, packet) {
  log(`TX ${label}`, { bytes: packet.length, hex: hex(packet) })
  socket.write(packet)
  await sleep(1200)
}

async function sendExact(socket, label, hexText) {
  await send(socket, label, Buffer.from(hexText.replace(/\s+/g, ''), 'hex'))
}

async function sendMsg(socket, label, code, body = Buffer.alloc(0), waitMs = 1200) {
  const command = buildMsgCommand(code, body)
  log(`TX ${label}`, {
    code,
    requestId: command.req,
    bodyBytes: body.length,
    bytes: command.packet.length,
    hex: hex(command.packet),
  })
  socket.write(command.packet)
  await sleep(waitMs)
}

async function sendNotify(socket, label, code, body = Buffer.alloc(0), waitMs = 300) {
  const command = buildMsgNotify(code, body)
  log(`TX ${label}`, {
    code,
    requestId: 0,
    bodyBytes: body.length,
    bytes: command.packet.length,
    hex: hex(command.packet),
  })
  socket.write(command.packet)
  await sleep(waitMs)
}

async function main() {
  log('Log file', { path: logFile })
  log('Options', { requestAuth })
  log('Connecting', { host, port })
  const socket = net.createConnection({ host, port })
  socket.setTimeout(requestAuth ? 70000 : 15000)
  socket.on('data', onData)
  socket.on('close', (hadError) => log('Socket close', { hadError }))
  socket.on('end', () => log('Socket end'))
  socket.on('timeout', () => {
    log('Socket timeout')
    socket.destroy()
  })
  socket.on('error', (error) => log('Socket error', { message: error.message }))

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  log('Connected')

  const smallOptions = Buffer.concat([wireFieldVarint(1, 48), wireFieldVarint(1, 15), wireFieldVarint(1, 11)])

  await send(socket, 'STREAM hello pcap-tail', buildStreamHello('pcap'))
  await sendMsg(socket, 'MSG CHECK_AUTHORIZATION', CODE_CHECK_AUTHORIZATION)

  if (requestAuth) {
    await sendNotify(socket, 'MSG PHONE_INFO notify before authorization', CODE_PHONE_INFO)
    await sendMsg(socket, 'MSG REQUEST_AUTHORIZATION -- confirm on camera', CODE_REQUEST_AUTHORIZATION, Buffer.alloc(0), 30000)
  }

  await sendExact(
    socket,
    'PCAP exact GET_OPTIONS small seq=0x25 req=1 trailer=dfb85492',
    `
      55 43 44 32 01 0c 04 25
      0f 00 00 00
      08 00 02 01 00 00 80 00 00
      08 30 08 0f 08 0b
      df b8 54 92
    `,
  )

  await sendExact(
    socket,
    'PCAP exact GET_CURRENT_CAPTURE_STATUS seq=0x26 req=2 trailer=dfda2159',
    `
      55 43 44 32 01 0c 04 26
      09 00 00 00
      0f 00 02 02 00 00 80 00 00
      df da 21 59
    `,
  )

  await sendExact(
    socket,
    'PCAP exact GET_OPTIONS large seq=0x27 req=3 trailer=299bd40b',
    `
      55 43 44 32 01 0c 04 27
      c0 00 00 00
      08 00 02 03 00 00 80 00 00
      08 01 08 03 08 02 08 4c 08 06 08 4e 08 4f 08 0b 08 55
      08 0c 08 0d 08 af 01 08 0e 08 0f 08 13 08 37 08 11
      08 14 08 1e 08 24 08 6e 08 72 08 75 08 59 08 74
      08 73 08 25 08 26 08 2a 08 28 08 29 08 30 08 31
      08 32 08 42 08 84 01 08 3a 08 3b 08 3c 08 43 08
      44 08 5d 08 53 08 52 08 46 08 58 08 67 08 10 08
      61 08 85 01 08 86 01 08 77 08 7a 08 7b 08 7c 08
      80 01 08 81 01 08 87 01 08 96 01 08 95 01 08 93
      01 08 9b 01 08 9d 01 08 9e 01 08 a0 01 08 b3 01
      08 a1 01 08 16 08 50 08 51 08 a7 01 08 a9 01 08
      ad 01 08 b4 01 08 b0 01 08 b1 01 08 78 08 6f 08
      79 08 ac 01
      29 9b d4 0b
    `,
  )

  await sendExact(
    socket,
    'PCAP exact GET_FILE_LIST internal offset=0 req=8 trailer=17f7506e',
    `
      55 43 44 32 01 0c 04 2c
      0f 00 00 00
      0d 00 02 08 00 00 80 00 00
      08 02 18 64 20 02
      17 f7 50 6e
    `,
  )

  await sendExact(
    socket,
    'PCAP exact GET_FILE_LIST internal offset=100 req=9 trailer=ef05694b',
    `
      55 43 44 32 01 0c 04 2d
      11 00 00 00
      0d 00 02 09 00 00 80 00 00
      08 02 10 64 18 64 20 02
      ef 05 69 4b
    `,
  )

  await sendExact(
    socket,
    'PCAP exact GET_FILE_LIST sdcard offset=0 req=11 trailer=9432e4e6',
    `
      55 43 44 32 01 0c 04 2f
      0f 00 00 00
      0d 00 02 0b 00 00 80 00 00
      08 03 18 64 20 02
      94 32 e4 e6
    `,
  )

  const generated = buildRawFileCommand(CODE_GET_OPTIONS, smallOptions)
  await send(socket, `GET_OPTIONS generated-checksum req=${generated.req} trailer=${hex(generated.trailer)}`, generated.packet)

  log('Waiting for late frames')
  await sleep(5000)
  socket.end()
  await new Promise((resolveDone) => logStream.end(resolveDone))
}

main().catch((error) => {
  log('Fatal', { message: error instanceof Error ? error.message : String(error) })
  logStream.end()
  process.exitCode = 1
})
