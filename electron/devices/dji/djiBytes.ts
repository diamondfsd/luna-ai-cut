import { randomUUID } from 'node:crypto'

export interface DjiMessage {
  target: number
  id: number
  flags: number
  cmdSet: number
  cmdId: number
  payload: Buffer
}

export const DJI_APP_DEVICE_INFO = Buffer.from([
  0x00, 0x41, 0x50, 0x50,
  ...Array(37).fill(0),
  0x02,
  ...Array(8).fill(0),
  0x02, 0x08,
  ...Array(10).fill(0),
])

export function crc8(data: Uint8Array, initial = 0x77, polynomial = 0x8c): number {
  let crc = initial & 0xff
  for (const value of data) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ polynomial : crc >>> 1
    }
  }
  return crc & 0xff
}

export function crc16(data: Uint8Array, initial = 0x3692, polynomial = 0x8408): number {
  let crc = initial & 0xffff
  for (const value of data) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ polynomial : crc >>> 1
    }
  }
  return crc & 0xffff
}

export function packString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length > 255) throw new Error('DJI 字符串字段过长')
  return Buffer.concat([Buffer.from([bytes.length]), bytes])
}

export function readPackString(data: Uint8Array, offset: number): { value: string; next: number } | null {
  if (offset >= data.length) return null
  const length = data[offset]
  const end = offset + 1 + length
  if (end > data.length) return null
  return { value: Buffer.from(data.subarray(offset + 1, end)).toString('utf8'), next: end }
}

/** BLE DUML uses the compact three-byte version/length header used by Osmosis. */
export function encodeDjiMessage(message: Omit<DjiMessage, 'flags' | 'cmdSet' | 'cmdId'> & { type?: number; flags?: number; cmdSet?: number; cmdId?: number }): Buffer {
  const flags = message.flags ?? ((message.type ?? 0) & 0xff)
  const cmdSet = message.cmdSet ?? (((message.type ?? 0) >>> 8) & 0xff)
  const cmdId = message.cmdId ?? (((message.type ?? 0) >>> 16) & 0xff)
  const type = flags | (cmdSet << 8) | (cmdId << 16)
  const payload = Buffer.from(message.payload)
  const length = 13 + payload.length
  if (length > 0x3ff) throw new Error('DJI DUML 帧过长')
  const header = Buffer.from([
    0x55,
    length & 0xff,
    0x04 | ((length >>> 8) & 0x03),
    0,
  ])
  header[3] = crc8(header.subarray(0, 3))
  const body = Buffer.alloc(8)
  body.writeUInt16LE(message.target & 0xffff, 0)
  body.writeUInt16LE(message.id & 0xffff, 2)
  body[4] = type & 0xff
  body[5] = (type >>> 8) & 0xff
  body[6] = (type >>> 16) & 0xff
  body[7] = 0
  const withoutCrc = Buffer.concat([header, body.subarray(0, 7), payload])
  const checksum = Buffer.alloc(2)
  checksum.writeUInt16LE(crc16(withoutCrc), 0)
  return Buffer.concat([withoutCrc, checksum])
}

export function decodeDjiMessage(data: Uint8Array, offset = 0): { message: DjiMessage; next: number } | null {
  if (offset + 13 > data.length || data[offset] !== 0x55) return null
  const length = data[offset + 1] | ((data[offset + 2] & 0x03) << 8)
  const version = data[offset + 2] >>> 2
  if (version !== 1 || length < 13 || offset + length > data.length) return null
  if (crc8(data.subarray(offset, offset + 3)) !== data[offset + 3]) return null
  const frame = data.subarray(offset, offset + length)
  const expected = frame[length - 2] | (frame[length - 1] << 8)
  if (crc16(frame.subarray(0, length - 2)) !== expected) return null
  const type = frame[8] | (frame[9] << 8) | (frame[10] << 16)
  return {
    message: {
      target: Buffer.from(frame).readUInt16LE(4),
      id: Buffer.from(frame).readUInt16LE(6),
      flags: type & 0xff,
      cmdSet: (type >>> 8) & 0xff,
      cmdId: (type >>> 16) & 0xff,
      payload: Buffer.from(frame.subarray(11, length - 2)),
    },
    next: offset + length,
  }
}

export function responseToDjiRequest(message: DjiMessage): Buffer {
  const target = ((message.target & 0xff) << 8) | ((message.target >>> 8) & 0xff)
  const payload = message.cmdSet === 0x00 && message.cmdId === 0x81
    ? DJI_APP_DEVICE_INFO
    : message.cmdSet === 0x07 && message.cmdId === 0x46
      ? Buffer.from([0x00])
      : message.payload
  return encodeDjiMessage({
    target,
    id: message.id,
    flags: 0xc0,
    cmdSet: message.cmdSet,
    cmdId: message.cmdId,
    payload,
  })
}

export function findDjiMessages(data: Uint8Array): DjiMessage[] {
  const messages: DjiMessage[] = []
  for (let offset = 0; offset + 13 <= data.length; offset += 1) {
    const decoded = decodeDjiMessage(data, offset)
    if (decoded) messages.push(decoded.message)
  }
  return messages
}

export function le32(value: number): Buffer {
  const result = Buffer.alloc(4)
  result.writeUInt32LE(value >>> 0, 0)
  return result
}

export function hex(value: string): Buffer {
  return Buffer.from(value.replace(/\s+/g, ''), 'hex')
}

export function newInstallIdentity(): string {
  return randomUUID().replace(/-/g, '').slice(0, 32)
}
