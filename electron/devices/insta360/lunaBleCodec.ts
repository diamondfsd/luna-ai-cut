import { createCipheriv, createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto'

export const LUNA_BLE_SERVICE_UUID = '0000be80-0000-1000-8000-00805f9b34fb'
export const LUNA_BLE_WRITE_UUID = '0000be81-0000-1000-8000-00805f9b34fb'
export const LUNA_BLE_NOTIFY_UUID = '0000be82-0000-1000-8000-00805f9b34fb'
export const LUNA_BLE_WRITE_MAX_LENGTH = 206

export const LUNA_COMMAND = {
  GET_OPTIONS: 8,
  CHECK_AUTHORIZATION: 39,
  REQUEST_AUTHORIZATION: 86,
  ENCRYPT_CAPABILITY_QUERY: 240,
  ENCRYPT_KEY_EXCHANGE: 241,
  AUTHORIZATION_RESULT: 8209,
  AUTHORIZATION_CHECK_RESULT: 8228,
} as const

export const LUNA_OPTION = {
  WIFI_INFO: 36,
  WIFI_CHANNEL_LIST: 37,
  WIFI_STATUS: 43,
} as const

export const LUNA_AUTHORIZATION = {
  ANDROID_INITIATOR: 2,
  WIFI_PASSWORD: 1,
  SUCCESS: 0,
  REJECTED: 1,
  TIMEOUT: 2,
  BUSY: 3,
} as const

export interface LunaMessage {
  wireMessageCode: number
  messageCode: number
  messageId: number
  content: Buffer
  encrypted: boolean
}

export interface LunaWifiCredentials {
  ssid: string
  password: string
}

interface WireValue {
  wireType: number
  value: number | Buffer
}

function asBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

export function encodeVarint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Luna BLE varint 必须是非负整数')
  const result: number[] = []
  let current = value
  while (current > 0x7f) {
    result.push((current & 0x7f) | 0x80)
    current = Math.floor(current / 128)
  }
  result.push(current)
  return Buffer.from(result)
}

function decodeVarint(data: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let cursor = offset
  while (cursor < data.length && shift <= 63) {
    const byte = data[cursor++]
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { value, next: cursor }
    shift += 7
  }
  throw new Error('Luna BLE protobuf varint 无效')
}

function encodeTag(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType)
}

export function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value)])
}

export function encodeBytesField(fieldNumber: number, value: Uint8Array): Buffer {
  const bytes = asBuffer(value)
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(bytes.length), bytes])
}

export function encodeStringField(fieldNumber: number, value: string): Buffer {
  return encodeBytesField(fieldNumber, Buffer.from(value, 'utf8'))
}

export function parseWireFields(data: Uint8Array): Map<number, WireValue[]> {
  const fields = new Map<number, WireValue[]>()
  let offset = 0
  while (offset < data.length) {
    const tag = decodeVarint(data, offset)
    offset = tag.next
    const fieldNumber = Math.floor(tag.value / 8)
    const wireType = tag.value & 7
    if (fieldNumber <= 0) throw new Error('Luna BLE protobuf 字段编号无效')

    let value: number | Buffer
    if (wireType === 0) {
      const decoded = decodeVarint(data, offset)
      value = decoded.value
      offset = decoded.next
    } else if (wireType === 1) {
      if (offset + 8 > data.length) throw new Error('Luna BLE protobuf fixed64 字段不完整')
      value = Buffer.from(data.subarray(offset, offset + 8))
      offset += 8
    } else if (wireType === 2) {
      const length = decodeVarint(data, offset)
      offset = length.next
      if (offset + length.value > data.length) throw new Error('Luna BLE protobuf 字段长度无效')
      value = Buffer.from(data.subarray(offset, offset + length.value))
      offset += length.value
    } else if (wireType === 5) {
      if (offset + 4 > data.length) throw new Error('Luna BLE protobuf fixed32 字段不完整')
      value = Buffer.from(data.subarray(offset, offset + 4))
      offset += 4
    } else {
      throw new Error(`Luna BLE protobuf 暂不支持 wire type ${wireType}`)
    }
    const values = fields.get(fieldNumber) ?? []
    values.push({ wireType, value })
    fields.set(fieldNumber, values)
  }
  return fields
}

function firstField(fields: Map<number, WireValue[]>, fieldNumber: number): WireValue | undefined {
  return fields.get(fieldNumber)?.[0]
}

function numberField(fields: Map<number, WireValue[]>, fieldNumber: number, fallback = 0): number {
  const value = firstField(fields, fieldNumber)?.value
  return typeof value === 'number' ? value : fallback
}

function bytesField(fields: Map<number, WireValue[]>, fieldNumber: number): Buffer | null {
  const value = firstField(fields, fieldNumber)?.value
  return Buffer.isBuffer(value) ? value : null
}

export function buildGetOptionsRequest(optionTypes: number[]): Buffer {
  return Buffer.concat(optionTypes.map((optionType) => encodeVarintField(1, optionType)))
}

export function buildCheckAuthorizationRequest(id: string): Buffer {
  return Buffer.concat([
    encodeStringField(1, id),
    encodeVarintField(2, LUNA_AUTHORIZATION.ANDROID_INITIATOR),
  ])
}

export function buildRequestAuthorizationRequest(): Buffer {
  return encodeVarintField(1, LUNA_AUTHORIZATION.WIFI_PASSWORD)
}

export function parseEncryptCapabilityResponse(data: Uint8Array): number[] {
  const fields = parseWireFields(data)
  const schemes: number[] = []
  for (const field of fields.get(1) ?? []) {
    if (typeof field.value === 'number') {
      schemes.push(field.value)
      continue
    }
    let offset = 0
    while (offset < field.value.length) {
      const decoded = decodeVarint(field.value, offset)
      schemes.push(decoded.value)
      offset = decoded.next
    }
  }
  return schemes
}

export function parseEncryptKeyExchangeResponse(data: Uint8Array): { errorCode: number; publicKey: Buffer | null } {
  const fields = parseWireFields(data)
  return {
    errorCode: numberField(fields, 1),
    publicKey: bytesField(fields, 2),
  }
}

export function parseCheckAuthorizationResponse(data: Uint8Array): { status: number } {
  return { status: numberField(parseWireFields(data), 1, -1) }
}

export function parseAuthorizationNotification(data: Uint8Array): { result: number; operation: number } {
  const fields = parseWireFields(data)
  return {
    result: numberField(fields, 1, -1),
    operation: numberField(fields, 2, -1),
  }
}

export function parseGetOptionsResponse(data: Uint8Array): { wifiInfo: LunaWifiCredentials | null } {
  const responseFields = parseWireFields(data)
  const optionsData = bytesField(responseFields, 2)
  if (!optionsData) return { wifiInfo: null }
  const wifiData = bytesField(parseWireFields(optionsData), LUNA_OPTION.WIFI_INFO)
  if (!wifiData) return { wifiInfo: null }
  const wifiFields = parseWireFields(wifiData)
  const ssid = bytesField(wifiFields, 1)?.toString('utf8') ?? ''
  const password = bytesField(wifiFields, 2)?.toString('utf8') ?? ''
  return { wifiInfo: ssid ? { ssid, password } : null }
}

export function packetChecksum(data: Uint8Array): number {
  const table: number[] = []
  for (let index = 0; index < 256; index += 1) {
    let value = (index << 24) >>> 0
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x80000000) !== 0
        ? (((value << 1) ^ 0x04c11db7) >>> 0)
        : ((value << 1) >>> 0)
    }
    table.push(value >>> 0)
  }

  let checksum = 0xffffffff
  for (const byte of data) {
    checksum = (checksum ^ byte) >>> 0
    for (let round = 0; round < 4; round += 1) {
      checksum = (((checksum << 8) >>> 0) ^ table[(checksum >>> 24) & 0xff]) >>> 0
    }
  }
  return checksum >>> 0
}

function checksumTrailer(data: Uint8Array): Buffer {
  const trailer = Buffer.alloc(4)
  trailer.writeUInt32LE(packetChecksum(data), 0)
  return trailer
}

function validateMessageValues(messageCode: number, messageId: number): void {
  if (!Number.isInteger(messageCode) || messageCode < 0 || messageCode > 0xffff) throw new Error('Luna BLE 消息编号无效')
  if (!Number.isInteger(messageId) || messageId < 0 || messageId > 0x3fffffff) throw new Error('Luna BLE 消息 ID 无效')
}

export function buildMessageContent(messageCode: number, content: Uint8Array, messageId: number): Buffer {
  validateMessageValues(messageCode, messageId)
  const header = Buffer.alloc(9)
  header.writeUInt16LE(messageCode, 0)
  header[2] = 2
  header.writeUInt32LE((messageId | 0x80000000) >>> 0, 3)
  header.writeUInt16LE(0, 7)
  return Buffer.concat([header, asBuffer(content)])
}

export function buildDirectMessagePacket(messageCode: number, content: Uint8Array, messageId: number, sequence: number): Buffer {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xff) throw new Error('Luna BLE 序列号无效')
  const message = buildMessageContent(messageCode, content, messageId)
  const frame = Buffer.alloc(12)
  Buffer.from('UCD2', 'ascii').copy(frame, 0)
  frame[4] = 1
  frame[5] = 0x0c
  frame[6] = 4
  frame[7] = sequence
  frame.writeUInt32LE(message.length, 8)
  const body = Buffer.concat([frame, message])
  return Buffer.concat([body, checksumTrailer(body)])
}

export function encryptedMessageAad(sequence: number, ciphertextLength: number): Buffer {
  const header = Buffer.alloc(12)
  Buffer.from('UCD2', 'ascii').copy(header, 0)
  header[4] = 1
  header[5] = 0x2b
  header[6] = 4
  header[7] = sequence & 0xff
  header.writeUInt32LE(ciphertextLength, 8)
  return header
}

export function buildEncryptedMessagePacket(ciphertext: Uint8Array, nonce: Uint8Array, authTag: Uint8Array, sequence: number): Buffer {
  const encrypted = asBuffer(ciphertext)
  const iv = asBuffer(nonce)
  const tag = asBuffer(authTag)
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Luna BLE AES-GCM 参数长度无效')
  const aad = encryptedMessageAad(sequence, encrypted.length)
  const option = Buffer.concat([Buffer.from([0x40, 29, 3]), iv, tag])
  const body = Buffer.concat([aad, option, encrypted])
  return Buffer.concat([body, checksumTrailer(body)])
}

export interface ParsedEncryptedMessage {
  sequence: number
  scheme: number
  nonce: Buffer
  authTag: Buffer
  ciphertext: Buffer
  aad: Buffer
}

export function parseEncryptedMessagePacket(data: Uint8Array): ParsedEncryptedMessage | null {
  const frame = asBuffer(data)
  if (frame.length < 47 || frame.toString('ascii', 0, 4) !== 'UCD2' || frame[4] !== 1 || frame[6] !== 4) return null
  const headerLength = frame[5]
  const ciphertextLength = frame.readUInt32LE(8)
  if (headerLength <= 12 || headerLength + ciphertextLength + 4 !== frame.length) throw new Error('Luna BLE 加密帧长度无效')
  const expectedChecksum = frame.readUInt32LE(frame.length - 4)
  if (packetChecksum(frame.subarray(0, frame.length - 4)) !== expectedChecksum) throw new Error('Luna BLE 加密帧校验失败')

  let offset = 12
  let encryptionOption: Buffer | null = null
  while (offset < headerLength) {
    if (offset + 2 > headerLength) throw new Error('Luna BLE 选项头不完整')
    const type = frame[offset]
    const length = frame[offset + 1]
    offset += 2
    if (offset + length > headerLength) throw new Error('Luna BLE 选项长度无效')
    if (type === 0x40 && !encryptionOption) encryptionOption = frame.subarray(offset, offset + length)
    offset += length
  }
  if (!encryptionOption || encryptionOption.length < 29 || encryptionOption[0] !== 3) return null
  return {
    sequence: frame[7],
    scheme: encryptionOption[0],
    nonce: Buffer.from(encryptionOption.subarray(1, 13)),
    authTag: Buffer.from(encryptionOption.subarray(13, 29)),
    ciphertext: Buffer.from(frame.subarray(headerLength, headerLength + ciphertextLength)),
    aad: Buffer.from(frame.subarray(0, 12)),
  }
}

function parseMessageContent(data: Uint8Array, encrypted: boolean): LunaMessage {
  if (data.length < 9) throw new Error('Luna BLE Message 内容不完整')
  const message = asBuffer(data)
  const wireMessageCode = message.readUInt16LE(0)
  const flags = message.readUInt32LE(3)
  return {
    wireMessageCode,
    messageCode: wireMessageCode,
    messageId: flags & 0x3fffffff,
    content: Buffer.from(message.subarray(9)),
    encrypted,
  }
}

export function parseDirectMessagePacket(data: Uint8Array): LunaMessage | null {
  const frame = asBuffer(data)
  if (frame.length < 25 || frame.toString('ascii', 0, 4) !== 'UCD2' || frame[4] !== 1 || frame[5] !== 0x0c || frame[6] !== 4) return null
  const messageLength = frame.readUInt32LE(8)
  if (messageLength < 9 || 12 + messageLength + 4 !== frame.length) throw new Error('Luna BLE Message 长度无效')
  const expectedChecksum = frame.readUInt32LE(frame.length - 4)
  if (packetChecksum(frame.subarray(0, frame.length - 4)) !== expectedChecksum) throw new Error('Luna BLE Message 校验失败')
  return parseMessageContent(frame.subarray(12, 12 + messageLength), false)
}

export function parseDecryptedMessage(data: Uint8Array): LunaMessage {
  return parseMessageContent(data, true)
}

export class LunaCryptoSession {
  readonly publicKey: Buffer
  private readonly privateKey: Buffer
  private sessionKey: Buffer | null = null

  constructor() {
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    this.publicKey = ecdh.getPublicKey(null, 'uncompressed')
    this.privateKey = ecdh.getPrivateKey()
  }

  complete(peerPublicKey: Uint8Array): void {
    const peer = asBuffer(peerPublicKey)
    if (peer.length !== 65 || peer[0] !== 4) throw new Error('Luna BLE 相机公钥无效')
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(this.privateKey)
    const sharedSecret = ecdh.computeSecret(peer)
    const prk = createHmac('sha256', Buffer.from('UCD2-ENCRYPT', 'utf8')).update(sharedSecret).digest()
    this.sessionKey = createHmac('sha256', prk)
      .update(Buffer.concat([Buffer.from('AES-SESSION-KEY', 'utf8'), Buffer.from([1])]))
      .digest()
      .subarray(0, 16)
  }

  encrypt(plaintext: Uint8Array, aad: Uint8Array): { nonce: Buffer; ciphertext: Buffer; authTag: Buffer } {
    if (!this.sessionKey) throw new Error('Luna BLE 加密会话尚未建立')
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-128-gcm', this.sessionKey, nonce)
    cipher.setAAD(asBuffer(aad))
    const ciphertext = Buffer.concat([cipher.update(asBuffer(plaintext)), cipher.final()])
    return { nonce, ciphertext, authTag: cipher.getAuthTag() }
  }

  decrypt(packet: ParsedEncryptedMessage): Buffer {
    if (!this.sessionKey) throw new Error('Luna BLE 加密会话尚未建立')
    const decipher = createDecipheriv('aes-128-gcm', this.sessionKey, packet.nonce)
    decipher.setAAD(packet.aad)
    decipher.setAuthTag(packet.authTag)
    return Buffer.concat([decipher.update(packet.ciphertext), decipher.final()])
  }
}
