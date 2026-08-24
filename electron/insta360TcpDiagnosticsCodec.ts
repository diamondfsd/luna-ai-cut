import { UCD2_FLAGS, UCD2_MAGIC, UCD2_MSG } from './insta360TcpCodec'

export interface Insta360MessageResponse {
  requestId: number
  messageCode: number
  body: Buffer
}

function wireVarint(value: number): Buffer {
  const out: number[] = []
  let current = value >>> 0
  while (current > 0x7f) {
    out.push((current & 0x7f) | 0x80)
    current >>>= 7
  }
  out.push(current & 0x7f)
  return Buffer.from(out)
}

function parseVarint(buffer: Buffer, offset: number): { value: number; offset: number } {
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

function wireFieldVarint(field: number, value: number): Buffer {
  return Buffer.concat([wireVarint(field << 3), wireVarint(value)])
}

function wireFieldBytes(field: number, value: Buffer): Buffer {
  return Buffer.concat([wireVarint((field << 3) | 2), wireVarint(value.length), value])
}

export function buildMessageEnvelope(messageCode: number, body: Buffer, requestId: number): Buffer {
  return Buffer.concat([
    wireFieldVarint(1, requestId),
    wireFieldVarint(2, messageCode),
    wireFieldBytes(3, body),
  ])
}

export function parseMessageEnvelope(buffer: Buffer): Insta360MessageResponse {
  let offset = 0
  const message: Insta360MessageResponse = { requestId: 0, messageCode: 0, body: Buffer.alloc(0) }
  while (offset < buffer.length) {
    const tag = parseVarint(buffer, offset)
    offset = tag.offset
    const field = tag.value >> 3
    const wireType = tag.value & 0x07
    if (wireType === 0) {
      const value = parseVarint(buffer, offset)
      offset = value.offset
      if (field === 1) message.requestId = value.value
      if (field === 2) message.messageCode = value.value
    } else if (wireType === 2) {
      const length = parseVarint(buffer, offset)
      offset = length.offset
      const bytes = buffer.subarray(offset, offset + length.value)
      offset += length.value
      if (field === 3) message.body = Buffer.from(bytes)
    } else {
      break
    }
  }
  return message
}

export function buildMessageCommand(seq: number, code: number, requestId: number, body = Buffer.alloc(0)): Buffer {
  const header = Buffer.from([...UCD2_MAGIC, 0x01, UCD2_FLAGS, UCD2_MSG, seq & 0xff])
  return Buffer.concat([header, buildMessageEnvelope(code, body, requestId)])
}

export function buildMessageNotification(seq: number, code: number, body = Buffer.alloc(0)): Buffer {
  return buildMessageCommand(seq, code, 0, body)
}

export function diagnosticHex(buffer: Buffer, maxBytes = 96): string {
  const body = buffer.subarray(0, maxBytes).toString('hex').replace(/(..)/g, '$1 ').trim()
  return buffer.length > maxBytes ? `${body} ... (+${buffer.length - maxBytes} bytes)` : body
}

export function diagnosticAscii(buffer: Buffer): string {
  return buffer.toString('latin1').replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim()
}

