import * as net from 'node:net'

import { logMainDebug, logMainInfo, logMainWarn } from './loggerService'

const UCD2_MAGIC = Buffer.from('UCD2')
const UCD2_VERSION = 0x01
const UCD2_FLAGS = 0x0c
const UCD2_FILE = 0x04
const UCD2_STREAM = 0x05

const CODE_GET_OPTIONS = 8
const CODE_GET_FILE_LIST = 13
const CODE_GET_CURRENT_CAPTURE_STATUS = 15
const STATUS_OK = 200
const PACKET_CHECKSUM_POLY = 0x04c11db7

interface ExactCommand {
  label: string
  code: number
  requestId: number
  packet: Buffer
}

export interface Insta360TcpDeviceInfo {
  serial?: string
  deviceName?: string
  firmware?: string
  ssid?: string
  wifiPassword?: string
  rawStrings: string[]
}

export interface Insta360RawResponse {
  code: number
  kind: number
  requestId: number
  flags: number
  body: Buffer
  trailer: Buffer
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tcpHost(host: string): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return host.split(':')[0] || host
  }
}

export function connectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let settled = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(connTimer)
      clearTimeout(fallbackTimer)
      if (err) {
        socket.destroy()
        reject(err)
      } else {
        resolve(socket)
      }
    }

    const connTimer = setTimeout(() => {
      socket.destroy()
      finish(new Error(`连接 ${host}:${port} 超时`))
    }, timeoutMs)
    const fallbackTimer = setTimeout(() => finish(new Error(`连接 ${host}:${port} 超时`)), timeoutMs + 3000)

    socket.once('connect', () => finish())
    socket.once('error', (err) => finish(err))
  })
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

function wireFieldVarint(field: number, value: number): Buffer {
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

function buildFileCommand(seq: number, code: number, requestId: number, body: Buffer): Buffer {
  const raw = buildRawCommand(code, requestId, body)
  const length = Buffer.alloc(4)
  length.writeUInt32LE(raw.length, 0)
  const frameWithoutTrailer = buildUcd2(UCD2_FILE, seq, Buffer.concat([length, raw]))
  return Buffer.concat([frameWithoutTrailer, checksumTrailer(frameWithoutTrailer)])
}

function buildStreamHello(seq: number): Buffer {
  return buildUcd2(UCD2_STREAM, seq, Buffer.concat([Buffer.alloc(4), Buffer.from('f6cc4f09', 'hex')]))
}

function builtCommand(label: string, seq: number, code: number, requestId: number, body: Buffer): ExactCommand {
  return {
    label,
    code,
    requestId,
    packet: buildFileCommand(seq, code, requestId, body),
  }
}

function parseRawResponse(payload: Buffer): Insta360RawResponse | null {
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

function extractAsciiStrings(data: Buffer): string[] {
  const strings: string[] = []
  let current = ''
  for (const byte of data) {
    if (byte >= 0x20 && byte <= 0x7e) {
      current += String.fromCharCode(byte)
    } else {
      if (current.length >= 4) strings.push(current)
      current = ''
    }
  }
  if (current.length >= 4) strings.push(current)
  return strings
}

export function parseDeviceInfo(responses: Insta360RawResponse[]): Insta360TcpDeviceInfo | null {
  const rawStrings = [...new Set(responses.flatMap((response) => extractAsciiStrings(response.body)))]
  if (rawStrings.length === 0) return null

  const deviceName = rawStrings.find((text) => /Insta360|Luna|Ultra|GO Ultra/i.test(text))
  const serial = rawStrings.find((text) => /^[A-Z0-9]{8,}$/.test(text) && !text.includes(' '))
  const firmware = rawStrings.find((text) => /^v?\d+\.\d+\.\d+/.test(text))
  const ssid = rawStrings.find((text) => /Luna|Ultra|\.OSC|GO/i.test(text) && text !== deviceName)
  const wifiPassword = rawStrings.find((text) => /^[A-Z0-9]{8}$/.test(text) && text !== serial)

  return {
    serial,
    deviceName,
    firmware,
    ssid,
    wifiPassword,
    rawStrings,
  }
}

function parsePathList(body: Buffer): string[] {
  const text = body.toString('utf8')
  const paths = new Set<string>()
  for (const match of text.matchAll(/\/(?:storage_internal|sdcard|DCIM)[^\x00\n\r]+?\.(?:mp4|mov|lrv|jpg|jpeg|dng|insp|png|webp)/gi)) {
    paths.add(match[0])
  }
  return [...paths]
}

function fileListBody(storageSelector: number, offset: number, limit = 100): Buffer {
  const parts = [wireFieldVarint(1, storageSelector)]
  if (offset > 0) parts.push(wireFieldVarint(2, offset))
  parts.push(wireFieldVarint(3, limit), wireFieldVarint(4, 2))
  return Buffer.concat(parts)
}

const EXACT_INFO_COMMANDS: ExactCommand[] = [
  builtCommand(
    'GET_OPTIONS small',
    0x25,
    CODE_GET_OPTIONS,
    1,
    Buffer.concat([wireFieldVarint(1, 48), wireFieldVarint(1, 15), wireFieldVarint(1, 11)]),
  ),
  builtCommand(
    'GET_CURRENT_CAPTURE_STATUS',
    0x26,
    CODE_GET_CURRENT_CAPTURE_STATUS,
    2,
    Buffer.alloc(0),
  ),
  builtCommand(
    'GET_OPTIONS large',
    0x27,
    CODE_GET_OPTIONS,
    3,
    Buffer.from(`
      08 01 08 03 08 02 08 4c 08 06 08 4e 08 4f 08 0b 08 55 08 0c
      08 0d 08 af 01 08 0e 08 0f 08 13 08 37 08 11 08 14 08 1e
      08 24 08 6e 08 72 08 75 08 59 08 74 08 73 08 25 08 26
      08 2a 08 28 08 29 08 30 08 31 08 32 08 42 08 84 01 08
      3a 08 3b 08 3c 08 43 08 44 08 5d 08 53 08 52 08 46 08
      58 08 67 08 10 08 61 08 85 01 08 86 01 08 77 08 7a 08
      7b 08 7c 08 80 01 08 81 01 08 87 01 08 96 01 08 95 01
      08 93 01 08 9b 01 08 9d 01 08 9e 01 08 a0 01 08 b3 01
      08 a1 01 08 16 08 50 08 51 08 a7 01 08 a9 01 08 ad 01
      08 b4 01 08 b0 01 08 b1 01 08 78 08 6f 08 79 08 ac 01
    `.replace(/\s+/g, ''), 'hex'),
  ),
]

const EXACT_FILE_LIST_INTERNAL: ExactCommand[] = [
  builtCommand(
    'GET_FILE_LIST internal offset=0',
    0x2c,
    CODE_GET_FILE_LIST,
    8,
    fileListBody(2, 0),
  ),
  builtCommand(
    'GET_FILE_LIST internal offset=100',
    0x2d,
    CODE_GET_FILE_LIST,
    9,
    fileListBody(2, 100),
  ),
  builtCommand(
    'GET_FILE_LIST internal offset=200',
    0x2e,
    CODE_GET_FILE_LIST,
    10,
    fileListBody(2, 200),
  ),
]

const EXACT_FILE_LIST_SDCARD: ExactCommand[] = [
  builtCommand(
    'GET_FILE_LIST sdcard offset=0',
    0x2f,
    CODE_GET_FILE_LIST,
    11,
    fileListBody(3, 0),
  ),
]

export class Insta360TcpSession {
  private socket: net.Socket | null = null
  private buffer = Buffer.alloc(0)
  private seq = 0x24
  private requestId = 1
  private readonly pending = new Map<number, {
    resolve: (response: Insta360RawResponse) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private deviceInfo: Insta360TcpDeviceInfo | null = null

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  get isOpen(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  get info(): Insta360TcpDeviceInfo | null {
    return this.deviceInfo
  }

  async open(): Promise<void> {
    if (this.isOpen) return
    const socket = await connectSocket(tcpHost(this.host), this.port, 1500)
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    socket.on('data', (data) => this.onData(Buffer.isBuffer(data) ? data : Buffer.from(data)))
    socket.on('close', (hadError) => {
      logMainWarn('[Insta360TCP] 控制 socket 已关闭', { host: this.host, port: this.port, hadError })
      this.rejectAll()
    })
    socket.on('error', (error) => {
      logMainWarn('[Insta360TCP] 控制 socket 错误', { host: this.host, port: this.port, error: error.message })
      this.rejectAll()
    })

    socket.write(buildStreamHello(this.nextSeq()))
    const infoResponses = await Promise.allSettled(EXACT_INFO_COMMANDS.map((command) => this.sendExactCommand(command, 4000)))
    const fulfilled = infoResponses
      .filter((result): result is PromiseFulfilledResult<Insta360RawResponse> => result.status === 'fulfilled')
      .map((result) => result.value)
    this.deviceInfo = parseDeviceInfo(fulfilled)
    this.requestId = Math.max(this.requestId, 12)
    logMainInfo('[Insta360TCP] 控制会话已建立', { host: this.host, port: this.port, deviceInfo: this.deviceInfo })
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
    this.rejectAll()
  }

  async refresh(): Promise<void> {
    if (!this.isOpen) {
      await this.open()
      return
    }
    this.socket?.write(buildStreamHello(this.nextSeq()))
  }

  async sendCommand(code: number, body = Buffer.alloc(0), timeoutMs = 5000): Promise<Insta360RawResponse> {
    if (!this.socket || this.socket.destroyed) throw new Error('控制会话未打开')
    const requestId = this.requestId++
    const packet = buildFileCommand(this.nextSeq(), code, requestId, body)
    return this.sendPacket(packet, code, requestId, body.length, timeoutMs)
  }

  private async sendExactCommand(command: ExactCommand, timeoutMs = 5000): Promise<Insta360RawResponse> {
    return this.sendPacket(command.packet, command.code, command.requestId, command.packet.length, timeoutMs, command.label)
  }

  private async sendPacket(
    packet: Buffer,
    code: number,
    requestId: number,
    bodyBytes: number,
    timeoutMs: number,
    label?: string,
  ): Promise<Insta360RawResponse> {
    if (!this.socket || this.socket.destroyed) throw new Error('控制会话未打开')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`TCP 命令 ${code} 请求 ${requestId} 超时`))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      this.socket?.write(packet)
      logMainDebug('[Insta360TCP] 发送命令', { code, requestId, bodyBytes, label })
    })
  }

  async listFilePaths(storagePath: string): Promise<string[]> {
    const selector = storagePath.includes('sdcard') || storagePath === '/DCIM/' ? 3 : 2
    const paths = new Set<string>()
    const exactCommands = selector === 3 ? EXACT_FILE_LIST_SDCARD : EXACT_FILE_LIST_INTERNAL
    for (const command of exactCommands) {
      const response = await this.sendExactCommand(command, 8000)
      const pagePaths = parsePathList(response.body)
      for (const path of pagePaths) paths.add(path)
      logMainDebug('[Insta360TCP] exact 文件列表分页', { selector, requestId: command.requestId, count: pagePaths.length })
      if (pagePaths.length < 100) return [...paths]
      await delay(20)
    }
    if (paths.size > 0) return [...paths]

    for (let offset = 0; offset <= 2000; offset += 100) {
      const response = await this.sendCommand(CODE_GET_FILE_LIST, fileListBody(selector, offset), 6000)
      const pagePaths = parsePathList(response.body)
      for (const path of pagePaths) paths.add(path)
      logMainDebug('[Insta360TCP] 文件列表分页', { selector, offset, count: pagePaths.length })
      if (pagePaths.length < 100) break
      await delay(20)
    }
    return [...paths]
  }

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data])
    while (this.buffer.length >= 8) {
      const start = this.buffer.indexOf(UCD2_MAGIC)
      if (start < 0) {
        this.buffer = Buffer.alloc(0)
        return
      }
      if (start > 0) this.buffer = this.buffer.subarray(start)
      if (this.buffer.length < 8) return

      const type = this.buffer[6]
      const frameLen = type === UCD2_STREAM
        ? 16
        : type === UCD2_FILE && this.buffer.length >= 12
          ? 12 + this.buffer.readUInt32LE(8) + 4
          : 0
      if (frameLen === 0) {
        this.buffer = this.buffer.subarray(8)
        continue
      }
      if (this.buffer.length < frameLen) return

      const frame = this.buffer.subarray(0, frameLen)
      this.buffer = this.buffer.subarray(frameLen)
      if (type !== UCD2_FILE) continue

      const response = parseRawResponse(frame.subarray(8))
      if (!response) continue
      const pending = this.pending.get(response.requestId)
      if (pending) {
        this.pending.delete(response.requestId)
        clearTimeout(pending.timer)
        pending.resolve(response)
      } else if (response.code !== STATUS_OK) {
        logMainDebug('[Insta360TCP] 未匹配响应/通知', { code: response.code, requestId: response.requestId, bodyBytes: response.body.length })
      }
    }
  }

  private rejectAll(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('控制会话已关闭'))
    }
    this.pending.clear()
  }

  private nextSeq(): number {
    const value = this.seq & 0xff
    this.seq = (this.seq + 1) & 0xff
    return value
  }
}
