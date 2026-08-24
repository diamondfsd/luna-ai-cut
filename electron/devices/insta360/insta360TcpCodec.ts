const UCD2_VERSION = 0x01
export const UCD2_FLAGS = 0x0c
const PACKET_CHECKSUM_POLY = 0x04c11db7

export const UCD2_MAGIC = Buffer.from('UCD2')
export const UCD2_FILE = 0x04
export const UCD2_STREAM = 0x05
export const UCD2_MSG = 0x03

export interface Insta360RawResponse {
  code: number
  kind: number
  requestId: number
  flags: number
  body: Buffer
  trailer: Buffer
}

function wireVarint(value: number): Buffer {
  const out: number[] = []
  let v = value >>> 0
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v & 0x7f)
  return Buffer.from(out)
}

export function wireFieldVarint(field: number, value: number): Buffer {
  return Buffer.concat([wireVarint(field << 3), wireVarint(value)])
}

function buildPacketChecksumTable(): number[] {
  const table: number[] = []
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

export function insta360PacketChecksum(frameWithoutTrailer: Buffer): number {
  let checksum = 0xffffffff | 0
  for (const byte of frameWithoutTrailer) {
    checksum = (checksum ^ byte) | 0
    for (let i = 0; i < 4; i += 1) {
      checksum = ((checksum << 8) ^ PACKET_CHECKSUM_TABLE[(checksum >>> 24) & 0xff]) | 0
    }
  }
  return checksum >>> 0
}

function checksumTrailer(frameWithoutTrailer: Buffer): Buffer {
  const trailer = Buffer.alloc(4)
  trailer.writeUInt32LE(insta360PacketChecksum(frameWithoutTrailer), 0)
  return trailer
}

function buildUcd2(type: number, seq: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  UCD2_MAGIC.copy(header, 0)
  header[4] = UCD2_VERSION
  header[5] = UCD2_FLAGS
  header[6] = type
  header[7] = seq & 0xff
  return Buffer.concat([header, payload])
}

function buildRawCommand(code: number, requestId: number, body: Buffer): Buffer {
  const raw = Buffer.alloc(9 + body.length)
  raw.writeUInt16LE(code, 0)
  raw[2] = 0x02
  raw.writeUInt16LE(requestId, 3)
  raw.writeUInt32LE(0x8000, 5)
  body.copy(raw, 9)
  return raw
}

export function buildFileCommand(seq: number, code: number, requestId: number, body: Buffer): Buffer {
  const raw = buildRawCommand(code, requestId, body)
  const length = Buffer.alloc(4)
  length.writeUInt32LE(raw.length, 0)
  const frameWithoutTrailer = buildUcd2(UCD2_FILE, seq, Buffer.concat([length, raw]))
  return Buffer.concat([frameWithoutTrailer, checksumTrailer(frameWithoutTrailer)])
}

export function buildStreamHello(seq: number): Buffer {
  return buildUcd2(UCD2_STREAM, seq, Buffer.concat([Buffer.alloc(4), Buffer.from('f6cc4f09', 'hex')]))
}

export function parseRawResponse(payload: Buffer): Insta360RawResponse | null {
  if (payload.length < 17) return null
  const rawLen = payload.readUInt32LE(0)
  if (payload.length < 4 + rawLen + 4) return null
  const raw = payload.subarray(4, 4 + rawLen)
  return {
    code: raw.readUInt16LE(0),
    kind: raw[2],
    requestId: raw.readUInt16LE(3),
    flags: raw.readUInt32LE(5),
    body: raw.subarray(9),
    trailer: payload.subarray(4 + rawLen, 4 + rawLen + 4),
  }
}

export function inspectFrameChecksum(frame: Buffer): { received: number; calculated: number; ok: boolean } | null {
  if (frame.length < 4) return null
  const received = frame.readUInt32LE(frame.length - 4)
  const calculated = insta360PacketChecksum(frame.subarray(0, frame.length - 4))
  return { received, calculated, ok: received === calculated }
}
