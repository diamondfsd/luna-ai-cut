import * as net from 'node:net'

const UCD2_MAGIC = Buffer.from('UCD2')
const UCD2_FILE = 0x04
const UCD2_STREAM = 0x05
const UCD2_MSG = 0x03
const CODE_GET_OPTIONS = 8
const CODE_GET_FILE_LIST = 13
const CODE_CHECK_AUTHORIZATION = 39
const CODE_REQUEST_AUTHORIZATION = 86
const CODE_PHONE_INFO = 220
const STATUS_OK = 200
const PACKET_CHECKSUM_POLY = 0x04c11db7

type DiagnosticLevel = 'INFO' | 'WARN' | 'ERROR'
type DiagnosticLogger = (level: DiagnosticLevel, message: string, data?: unknown) => void

interface RawResponse {
  code: number
  kind: number
  requestId: number
  flags: number
  body: Buffer
  trailer: Buffer
}

interface MessageResponse {
  requestId: number
  messageCode: number
  body: Buffer
}

export interface Insta360HttpProbeResult {
  path: string
  ok: boolean
  status?: number
  server?: string | null
  contentType?: string | null
  directoryLinks?: number
  mediaLinks?: number
  preview?: string
  error?: string
}

export interface Insta360TcpCommandResult {
  label: string
  ok: boolean
  code?: number
  requestId?: number
  bodyBytes?: number
  trailer?: string
  ascii?: string
  error?: string
}

export interface Insta360DiagnosticFile {
  name: string
  path: string
  url: string
  size: number | null
}

export interface Insta360AuthProbe {
  authorized: boolean | null
  needsConfirm: boolean
  message: string
  requestId?: number
  messageCode?: number
  bodyHex?: string
  bodyAscii?: string
}

export interface Insta360DiagnosticsOptions {
  authOnly?: boolean
  fileListOnly?: boolean
  requestAuthorization?: boolean
}

export interface Insta360DiagnosticsResult {
  success: boolean
  host: string
  port: number
  http: Insta360HttpProbeResult[]
  tcp: Insta360TcpCommandResult[]
  auth: Insta360AuthProbe | null
  files: Insta360DiagnosticFile[]
  deviceInfo: {
    deviceName?: string
    serial?: string
    firmware?: string
    ssid?: string
    wifiPassword?: string
    rawStrings: string[]
  } | null
  summary: string
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

function hex(buffer: Buffer, maxBytes = 96): string {
  const body = buffer.subarray(0, maxBytes).toString('hex').replace(/(..)/g, '$1 ').trim()
  return buffer.length > maxBytes ? `${body} ... (+${buffer.length - maxBytes} bytes)` : body
}

function ascii(buffer: Buffer): string {
  return buffer
    .toString('latin1')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

function wireFieldBytes(field: number, value: Buffer): Buffer {
  return Buffer.concat([wireVarint((field << 3) | 2), wireVarint(value.length), value])
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

function buildMessageEnvelope(messageCode: number, body: Buffer, requestId: number): Buffer {
  return Buffer.concat([
    wireFieldVarint(1, requestId),
    wireFieldVarint(2, messageCode),
    wireFieldBytes(3, body),
  ])
}

function parseMessageEnvelope(buffer: Buffer): MessageResponse {
  let offset = 0
  const message: MessageResponse = { requestId: 0, messageCode: 0, body: Buffer.alloc(0) }
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

function buildChecksumTable(): number[] {
  const table: number[] = []
  for (let i = 0; i < 256; i += 1) {
    let value = (i << 24) | 0
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x80000000) !== 0 ? ((value << 1) ^ PACKET_CHECKSUM_POLY) | 0 : (value << 1) | 0
    }
    table.push(value >>> 0)
  }
  return table
}

const CHECKSUM_TABLE = buildChecksumTable()

function packetChecksum(frameWithoutTrailer: Buffer): number {
  let checksum = 0xffffffff | 0
  for (const byte of frameWithoutTrailer) {
    checksum = (checksum ^ byte) | 0
    for (let i = 0; i < 4; i += 1) {
      checksum = ((checksum << 8) ^ CHECKSUM_TABLE[(checksum >>> 24) & 0xff]) | 0
    }
  }
  return checksum >>> 0
}

function checksumTrailer(frameWithoutTrailer: Buffer): Buffer {
  const trailer = Buffer.alloc(4)
  trailer.writeUInt32LE(packetChecksum(frameWithoutTrailer), 0)
  return trailer
}

function buildUcd2(type: number, seq: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  UCD2_MAGIC.copy(header, 0)
  header[4] = 0x01
  header[5] = 0x0c
  header[6] = type
  header[7] = seq & 0xff
  return Buffer.concat([header, payload])
}

function buildStreamHello(seq: number): Buffer {
  return buildUcd2(UCD2_STREAM, seq, Buffer.concat([Buffer.alloc(4), Buffer.from('f6cc4f09', 'hex')]))
}

function buildFileCommand(seq: number, code: number, requestId: number, body: Buffer): Buffer {
  const raw = Buffer.alloc(9 + body.length)
  raw.writeUInt16LE(code, 0)
  raw[2] = 0x02
  raw.writeUInt16LE(requestId, 3)
  raw.writeUInt32LE(0x8000, 5)
  body.copy(raw, 9)
  const length = Buffer.alloc(4)
  length.writeUInt32LE(raw.length, 0)
  const frameWithoutTrailer = buildUcd2(UCD2_FILE, seq, Buffer.concat([length, raw]))
  return Buffer.concat([frameWithoutTrailer, checksumTrailer(frameWithoutTrailer)])
}

function buildMsgCommand(seq: number, code: number, requestId: number, body = Buffer.alloc(0)): Buffer {
  return buildUcd2(UCD2_MSG, seq, buildMessageEnvelope(code, body, requestId))
}

function buildMsgNotify(seq: number, code: number, body = Buffer.alloc(0)): Buffer {
  return buildUcd2(UCD2_MSG, seq, buildMessageEnvelope(code, body, 0))
}

function fileListBody(storageSelector: number, offset: number, limit = 100): Buffer {
  const parts = [wireFieldVarint(1, storageSelector)]
  if (offset > 0) parts.push(wireFieldVarint(2, offset))
  parts.push(wireFieldVarint(3, limit), wireFieldVarint(4, 2))
  return Buffer.concat(parts)
}

function getOptionsSmallBody(): Buffer {
  return Buffer.concat([wireFieldVarint(1, 48), wireFieldVarint(1, 15), wireFieldVarint(1, 11)])
}

function getOptionsLargeBody(): Buffer {
  return Buffer.from(`
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
  `.replace(/\s+/g, ''), 'hex')
}

function parseRawResponse(payload: Buffer): RawResponse | null {
  if (payload.length < 17) return null
  const rawLen = payload.readUInt32LE(0)
  if (payload.length < 4 + rawLen + 4 || rawLen < 9) return null
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
  const out: string[] = []
  let current = ''
  for (const byte of data) {
    if (byte >= 0x20 && byte <= 0x7e) current += String.fromCharCode(byte)
    else {
      if (current.length >= 4) out.push(current)
      current = ''
    }
  }
  if (current.length >= 4) out.push(current)
  return out
}

function parseDeviceInfo(responses: RawResponse[]): Insta360DiagnosticsResult['deviceInfo'] {
  const rawStrings = [...new Set(responses.flatMap((response) => extractAsciiStrings(response.body)))]
  if (rawStrings.length === 0) return null
  const deviceName = rawStrings.find((text) => /Insta360|Luna|Ultra|GO/i.test(text))
  const serial = rawStrings.find((text) => /^[A-Z0-9]{8,}$/.test(text) && !text.includes(' '))
  const firmware = rawStrings.find((text) => /^v?\d+\.\d+\.\d+/.test(text))
  const ssid = rawStrings.find((text) => /(?:Luna|Ultra|GO|\.OSC)/i.test(text) && text !== deviceName)
  const wifiPassword = rawStrings.find((text) => /^[A-Z0-9]{8}$/.test(text) && text !== serial)
  return { deviceName, serial, firmware, ssid, wifiPassword, rawStrings }
}

function commandResult(label: string, response: RawResponse): Insta360TcpCommandResult {
  return {
    label,
    ok: response.code === STATUS_OK,
    code: response.code,
    requestId: response.requestId,
    bodyBytes: response.body.length,
    trailer: hex(response.trailer),
    ascii: extractAsciiStrings(response.body).join(' | ').slice(0, 800),
  }
}

function parsePathList(body: Buffer): string[] {
  const text = body.toString('latin1')
  const paths = new Set<string>()
  for (const match of text.matchAll(/\/(?:storage_internal|sdcard|DCIM)[^\x00\n\r"'<>\s]+?\.(?:mp4|mov|lrv|jpg|jpeg|dng|insp|png|webp)/gi)) {
    paths.add(match[0])
  }
  return [...paths]
}

function pathToFile(host: string, path: string): Insta360DiagnosticFile {
  const name = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? path)
  return { name, path, url: `http://${host}${path}`, size: null }
}

function inferAuth(message: MessageResponse | null): Insta360AuthProbe | null {
  if (!message) return null
  const bodyHex = hex(message.body)
  const bodyAscii = ascii(message.body)
  const bodyHasZero = message.body.includes(0x00)
  const bodyHasOne = message.body.includes(0x01)
  const authorized = message.body.length === 0 ? null : bodyHasOne && !bodyHasZero ? true : bodyHasZero ? false : null
  return {
    authorized,
    needsConfirm: authorized === false,
    message: authorized === true ? '已授权' : authorized === false ? '需要相机确认或尚未授权' : '授权响应未明确',
    requestId: message.requestId,
    messageCode: message.messageCode,
    bodyHex,
    bodyAscii,
  }
}

function connectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        socket.destroy()
        reject(error)
      } else {
        resolve(socket)
      }
    }
    const timer = setTimeout(() => finish(new Error(`连接 ${host}:${port} 超时`)), timeoutMs)
    socket.once('connect', () => finish())
    socket.once('error', (error) => finish(error))
  })
}

class DiagnosticTcpConnection {
  private buffer = Buffer.alloc(0)
  private seq = 0x24
  private requestId = 1
  private pendingFile = new Map<number, { resolve: (response: RawResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private pendingMsg = new Map<number, { resolve: (response: MessageResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private readonly socket: net.Socket,
    private readonly log: DiagnosticLogger,
  ) {
    socket.on('data', (data) => this.onData(Buffer.isBuffer(data) ? data : Buffer.from(data)))
    socket.on('close', (hadError) => {
      this.log('WARN', '[TCP] socket close', { hadError })
      this.rejectAll(new Error('socket closed'))
    })
    socket.on('error', (error) => {
      this.log('WARN', '[TCP] socket error', { error: error.message })
      this.rejectAll(error)
    })
  }

  close(): void {
    this.socket.destroy()
    this.rejectAll(new Error('socket closed'))
  }

  write(label: string, packet: Buffer): void {
    this.log('INFO', `[TCP] TX ${label}`, { bytes: packet.length, hex: hex(packet) })
    this.socket.write(packet)
  }

  sendHello(): void {
    this.write('STREAM hello pcap-tail', buildStreamHello(this.nextSeq()))
  }

  sendFile(label: string, code: number, body: Buffer, timeoutMs = 5000): Promise<RawResponse> {
    const requestId = this.requestId++
    const packet = buildFileCommand(this.nextSeq(), code, requestId, body)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingFile.delete(requestId)
        reject(new Error(`${label} timeout`))
      }, timeoutMs)
      this.pendingFile.set(requestId, { resolve, reject, timer })
      this.write(`${label} req=${requestId}`, packet)
    })
  }

  sendMsg(label: string, code: number, body = Buffer.alloc(0), timeoutMs = 3000): Promise<MessageResponse> {
    const requestId = this.requestId++
    const packet = buildMsgCommand(this.nextSeq(), code, requestId, body)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMsg.delete(requestId)
        reject(new Error(`${label} timeout`))
      }, timeoutMs)
      this.pendingMsg.set(requestId, { resolve, reject, timer })
      this.write(`${label} req=${requestId}`, packet)
    })
  }

  notifyMsg(label: string, code: number, body = Buffer.alloc(0)): void {
    this.write(label, buildMsgNotify(this.nextSeq(), code, body))
  }

  private onData(data: Buffer): void {
    this.log('INFO', '[TCP] RX bytes', { bytes: data.length, hex: hex(data) })
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
      const frameLen = this.frameLength(type)
      if (frameLen === 0) {
        this.log('WARN', '[TCP] unknown UCD2 frame type', { type, seq: this.buffer[7] })
        this.buffer = this.buffer.subarray(8)
        continue
      }
      if (this.buffer.length < frameLen) return
      const frame = this.buffer.subarray(0, frameLen)
      this.buffer = this.buffer.subarray(frameLen)
      this.handleFrame(frame)
    }
  }

  private frameLength(type: number): number {
    if (type === UCD2_STREAM) return 16
    if (type === UCD2_FILE && this.buffer.length >= 12) return 12 + this.buffer.readUInt32LE(8) + 4
    if (type === UCD2_MSG) {
      const next = this.buffer.indexOf(UCD2_MAGIC, 8)
      return next > 0 ? next : this.buffer.length
    }
    return 0
  }

  private handleFrame(frame: Buffer): void {
    const type = frame[6]
    const seq = frame[7]
    if (type === UCD2_STREAM) {
      this.log('INFO', '[TCP] RX STREAM', { seq, bytes: frame.length, payload: hex(frame.subarray(8)) })
      return
    }
    if (type === UCD2_MSG) {
      const message = parseMessageEnvelope(frame.subarray(8))
      this.log('INFO', '[TCP] RX MSG', {
        seq,
        requestId: message.requestId,
        messageCode: message.messageCode,
        bodyBytes: message.body.length,
        bodyHex: hex(message.body),
        bodyAscii: ascii(message.body),
      })
      const pending = this.pendingMsg.get(message.requestId)
      if (pending) {
        this.pendingMsg.delete(message.requestId)
        clearTimeout(pending.timer)
        pending.resolve(message)
      }
      return
    }
    const response = parseRawResponse(frame.subarray(8))
    if (!response) {
      this.log('WARN', '[TCP] RX FILE parse failed', { seq, bytes: frame.length, hex: hex(frame) })
      return
    }
    this.log('INFO', '[TCP] RX FILE', {
      seq,
      code: response.code,
      requestId: response.requestId,
      bodyBytes: response.body.length,
      trailer: hex(response.trailer),
      ascii: extractAsciiStrings(response.body).join(' | ').slice(0, 300),
    })
    const pending = this.pendingFile.get(response.requestId)
    if (pending) {
      this.pendingFile.delete(response.requestId)
      clearTimeout(pending.timer)
      pending.resolve(response)
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingFile.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    for (const pending of this.pendingMsg.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingFile.clear()
    this.pendingMsg.clear()
  }

  private nextSeq(): number {
    const value = this.seq & 0xff
    this.seq = (this.seq + 1) & 0xff
    return value
  }
}

async function probeHttpFiles(host: string, files: Insta360DiagnosticFile[], log: DiagnosticLogger): Promise<Insta360HttpProbeResult[]> {
  const targets = files.slice(0, 5)
  const results: Insta360HttpProbeResult[] = []
  for (const file of targets) {
    try {
      const response = await fetch(file.url, { method: 'HEAD', signal: AbortSignal.timeout(2500) })
      const result = {
        path: file.path,
        ok: response.ok,
        status: response.status,
        server: response.headers.get('server'),
        contentType: response.headers.get('content-type'),
      }
      results.push(result)
      log(response.ok ? 'INFO' : 'WARN', `[HTTP] HEAD ${file.path}`, result)
    } catch (error) {
      const result = { path: file.path, ok: false, error: error instanceof Error ? error.message : String(error) }
      results.push(result)
      log('WARN', `[HTTP] HEAD ${file.path} failed`, result)
    }
  }
  if (results.length === 0) {
    try {
      const response = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(2000) })
      results.push({
        path: '/',
        ok: response.ok,
        status: response.status,
        server: response.headers.get('server'),
        contentType: response.headers.get('content-type'),
        preview: (await response.text()).slice(0, 300),
      })
    } catch (error) {
      results.push({ path: '/', ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

async function runTcp(
  host: string,
  port: number,
  log: DiagnosticLogger,
  options: Insta360DiagnosticsOptions,
): Promise<{ tcp: Insta360TcpCommandResult[]; info: RawResponse[]; auth: Insta360AuthProbe | null; files: Insta360DiagnosticFile[] }> {
  const socket = await connectSocket(tcpHost(host), port, 2000)
  const conn = new DiagnosticTcpConnection(socket, log)
  const tcp: Insta360TcpCommandResult[] = []
  const info: RawResponse[] = []
  const files = new Map<string, Insta360DiagnosticFile>()
  let auth: Insta360AuthProbe | null = null
  try {
    conn.sendHello()
    await delay(500)

    if (!options.fileListOnly) {
      try {
        const msg = await conn.sendMsg('MSG CHECK_AUTHORIZATION', CODE_CHECK_AUTHORIZATION, Buffer.alloc(0), 2500)
        auth = inferAuth(msg)
        tcp.push({ label: 'MSG CHECK_AUTHORIZATION', ok: true, requestId: msg.requestId, bodyBytes: msg.body.length, ascii: auth?.message })
      } catch (error) {
        tcp.push({ label: 'MSG CHECK_AUTHORIZATION', ok: false, error: error instanceof Error ? error.message : String(error) })
      }

      if (options.requestAuthorization) {
        conn.notifyMsg('MSG PHONE_INFO notify before authorization', CODE_PHONE_INFO)
        try {
          const msg = await conn.sendMsg('MSG REQUEST_AUTHORIZATION', CODE_REQUEST_AUTHORIZATION, Buffer.alloc(0), 30000)
          auth = inferAuth(msg) ?? auth
          tcp.push({ label: 'MSG REQUEST_AUTHORIZATION', ok: true, requestId: msg.requestId, bodyBytes: msg.body.length, ascii: auth?.message })
        } catch (error) {
          tcp.push({ label: 'MSG REQUEST_AUTHORIZATION', ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    if (!options.authOnly && !options.fileListOnly) {
      for (const command of [
        { label: 'GET_OPTIONS small', body: getOptionsSmallBody() },
        { label: 'GET_OPTIONS large', body: getOptionsLargeBody() },
      ]) {
        try {
          const response = await conn.sendFile(command.label, CODE_GET_OPTIONS, command.body, 5000)
          tcp.push(commandResult(command.label, response))
          info.push(response)
        } catch (error) {
          tcp.push({ label: command.label, ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    if (!options.authOnly) {
      for (const selector of [2, 3]) {
        for (let offset = 0; offset <= 2000; offset += 100) {
          const label = `GET_FILE_LIST selector=${selector} offset=${offset}`
          try {
            const response = await conn.sendFile(label, CODE_GET_FILE_LIST, fileListBody(selector, offset), 8000)
            tcp.push(commandResult(label, response))
            const paths = parsePathList(response.body)
            for (const path of paths) files.set(path, pathToFile(host, path))
            if (paths.length < 100) break
          } catch (error) {
            tcp.push({ label, ok: false, error: error instanceof Error ? error.message : String(error) })
            break
          }
          await delay(30)
        }
      }
    }
  } finally {
    conn.close()
  }
  return { tcp, info, auth, files: [...files.values()] }
}

export async function runInsta360TcpDiagnostics(
  host: string,
  port: number,
  log: DiagnosticLogger,
  options: Insta360DiagnosticsOptions = {},
): Promise<Insta360DiagnosticsResult> {
  log('INFO', '========== Insta360 协议诊断开始 ==========', { host, port, options })
  const tcpResults: Insta360TcpCommandResult[] = []
  let infoResponses: RawResponse[] = []
  let auth: Insta360AuthProbe | null = null
  let files: Insta360DiagnosticFile[] = []

  try {
    const result = await runTcp(host, port, log, options)
    tcpResults.push(...result.tcp)
    infoResponses = result.info
    auth = result.auth
    files = result.files
  } catch (error) {
    tcpResults.push({ label: 'TCP connect/session', ok: false, error: error instanceof Error ? error.message : String(error) })
    log('ERROR', '[TCP] diagnostic failed', { error: error instanceof Error ? error.message : String(error) })
  }

  const http = options.authOnly ? [] : await probeHttpFiles(host, files, log)
  const deviceInfo = parseDeviceInfo(infoResponses)
  const httpOk = http.some((item) => item.ok)
  const tcpOk = tcpResults.some((item) => item.ok)
  const summary = `TCP ${tcpOk ? '有有效响应' : '无有效响应'}；授权 ${auth?.message ?? '未确认'}；文件 ${files.length} 个；HTTP ${http.length === 0 ? '未探测' : httpOk ? '可访问' : '不可访问'}；设备 ${deviceInfo?.deviceName ?? '未解析'}`
  log('INFO', `========== Insta360 协议诊断结束：${summary} ==========`)
  return { success: tcpOk || httpOk, host, port, http, tcp: tcpResults, auth, files, deviceInfo, summary }
}
