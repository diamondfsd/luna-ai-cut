import * as net from 'node:net'
import { randomBytes } from 'node:crypto'

const UCD2_MAGIC = Buffer.from('UCD2')
const UCD2_FILE = 0x04
const UCD2_STREAM = 0x05
const HTTP_PATHS = ['/', '/DCIM/', '/storage_internal/DCIM/', '/storage_internal/DCIM/Camera01/', '/sdcard/DCIM/', '/sdcard/DCIM/Camera01/']

type DiagnosticLevel = 'INFO' | 'WARN' | 'ERROR'
type DiagnosticLogger = (level: DiagnosticLevel, message: string, data?: unknown) => void

interface ExactCommand {
  label: string
  code: number
  requestId: number
  packet: Buffer
}

interface RawResponse {
  code: number
  kind: number
  requestId: number
  flags: number
  body: Buffer
  trailer: Buffer
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

export interface Insta360DiagnosticsResult {
  success: boolean
  host: string
  port: number
  http: Insta360HttpProbeResult[]
  tcp: Insta360TcpCommandResult[]
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

function exactCommand(label: string, code: number, requestId: number, hexText: string): ExactCommand {
  return { label, code, requestId, packet: Buffer.from(hexText.replace(/\s+/g, ''), 'hex') }
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

function buildStreamHello(seq = 0x24): Buffer {
  return buildUcd2(UCD2_STREAM, seq, Buffer.concat([Buffer.alloc(4), Buffer.from('f6cc4f09', 'hex')]))
}

function buildRandomTrailerGetOptions(seq = 0x41, requestId = 12): Buffer {
  const body = Buffer.from('0830080f080b', 'hex')
  const raw = Buffer.alloc(9 + body.length)
  raw.writeUInt16LE(8, 0)
  raw[2] = 0x02
  raw.writeUInt16LE(requestId, 3)
  raw.writeUInt32LE(0x8000, 5)
  body.copy(raw, 9)
  const len = Buffer.alloc(4)
  len.writeUInt32LE(raw.length, 0)
  return buildUcd2(UCD2_FILE, seq, Buffer.concat([len, raw, randomBytes(4)]))
}

const EXACT_INFO_COMMANDS: ExactCommand[] = [
  exactCommand('GET_OPTIONS small exact', 8, 1, '55 43 44 32 01 0c 04 25 0f 00 00 00 08 00 02 01 00 00 80 00 00 08 30 08 0f 08 0b df b8 54 92'),
  exactCommand('GET_CURRENT_CAPTURE_STATUS exact', 15, 2, '55 43 44 32 01 0c 04 26 09 00 00 00 0f 00 02 02 00 00 80 00 00 df da 21 59'),
  exactCommand(
    'GET_OPTIONS large exact',
    8,
    3,
    `
      55 43 44 32 01 0c 04 27 c0 00 00 00 08 00 02 03 00 00 80 00 00
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
      29 9b d4 0b
    `,
  ),
]

function connectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const timer = setTimeout(() => finish(new Error(`连接 ${host}:${port} 超时`)), timeoutMs)
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
    socket.once('connect', () => finish())
    socket.once('error', (error) => finish(error))
  })
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
    if (byte >= 0x20 && byte <= 0x7e) {
      current += String.fromCharCode(byte)
    } else {
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
    ok: response.code === 200,
    code: response.code,
    requestId: response.requestId,
    bodyBytes: response.body.length,
    trailer: hex(response.trailer),
    ascii: extractAsciiStrings(response.body).join(' | ').slice(0, 800),
  }
}

class DiagnosticTcpConnection {
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, {
    label: string
    resolve: (response: RawResponse) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

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

  send(label: string, packet: Buffer, requestId: number, timeoutMs: number): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`${label} timeout`))
      }, timeoutMs)
      this.pending.set(requestId, { label, resolve, reject, timer })
      this.write(label, packet)
    })
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
      const seq = this.buffer[7]
      const frameLen = type === UCD2_STREAM
        ? 16
        : type === UCD2_FILE && this.buffer.length >= 12
          ? 12 + this.buffer.readUInt32LE(8) + 4
          : 0
      if (frameLen === 0) {
        this.log('WARN', '[TCP] unknown UCD2 frame type', { type, seq })
        this.buffer = this.buffer.subarray(8)
        continue
      }
      if (this.buffer.length < frameLen) return

      const frame = this.buffer.subarray(0, frameLen)
      this.buffer = this.buffer.subarray(frameLen)
      if (type === UCD2_STREAM) {
        this.log('INFO', '[TCP] RX STREAM', { seq, bytes: frame.length, payload: hex(frame.subarray(8)) })
        continue
      }

      const response = parseRawResponse(frame.subarray(8))
      if (!response) {
        this.log('WARN', '[TCP] RX FILE parse failed', { seq, bytes: frame.length, hex: hex(frame) })
        continue
      }
      this.log('INFO', '[TCP] RX FILE', {
        seq,
        code: response.code,
        requestId: response.requestId,
        bodyBytes: response.body.length,
        trailer: hex(response.trailer),
        ascii: extractAsciiStrings(response.body).join(' | ').slice(0, 300),
      })
      const pending = this.pending.get(response.requestId)
      if (pending) {
        this.pending.delete(response.requestId)
        clearTimeout(pending.timer)
        pending.resolve(response)
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

async function probeHttp(host: string, log: DiagnosticLogger): Promise<Insta360HttpProbeResult[]> {
  const results: Insta360HttpProbeResult[] = []
  for (const path of HTTP_PATHS) {
    const url = `http://${host}${path}`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
      const text = await response.text()
      const directoryLinks = [...text.matchAll(/<a\s+href=/gi)].length
      const mediaLinks = [...text.matchAll(/\.(?:mp4|mov|lrv|jpg|jpeg|dng|insp|png|webp)(?:["?]|<|\s)/gi)].length
      const result = {
        path,
        ok: response.ok,
        status: response.status,
        server: response.headers.get('server'),
        contentType: response.headers.get('content-type'),
        directoryLinks,
        mediaLinks,
        preview: text.slice(0, 300),
      }
      results.push(result)
      log(response.ok ? 'INFO' : 'WARN', `[HTTP] ${path}`, result)
    } catch (error) {
      const result = { path, ok: false, error: error instanceof Error ? error.message : String(error) }
      results.push(result)
      log('WARN', `[HTTP] ${path} failed`, result)
    }
  }
  return results
}

async function runTcp(host: string, port: number, log: DiagnosticLogger): Promise<{ tcp: Insta360TcpCommandResult[]; info: RawResponse[] }> {
  const socket = await connectSocket(tcpHost(host), port, 2000)
  const conn = new DiagnosticTcpConnection(socket, log)
  const tcp: Insta360TcpCommandResult[] = []
  const info: RawResponse[] = []
  try {
    conn.write('STREAM hello pcap-tail', buildStreamHello())
    await delay(800)
    for (const command of EXACT_INFO_COMMANDS) {
      try {
        const response = await conn.send(command.label, command.packet, command.requestId, 4500)
        tcp.push(commandResult(command.label, response))
        info.push(response)
      } catch (error) {
        tcp.push({ label: command.label, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      await delay(250)
    }

    try {
      const response = await conn.send('GET_OPTIONS random trailer control', buildRandomTrailerGetOptions(), 12, 2000)
      tcp.push(commandResult('GET_OPTIONS random trailer control', response))
    } catch (error) {
      tcp.push({ label: 'GET_OPTIONS random trailer control', ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    conn.close()
  }
  return { tcp, info }
}

async function runSeqVariant(host: string, port: number, log: DiagnosticLogger): Promise<Insta360TcpCommandResult> {
  const socket = await connectSocket(tcpHost(host), port, 2000)
  const conn = new DiagnosticTcpConnection(socket, log)
  try {
    conn.write('STREAM hello pcap-tail', buildStreamHello())
    await delay(600)
    const packet = Buffer.from(EXACT_INFO_COMMANDS[0].packet)
    packet[7] = 0x40
    const response = await conn.send('GET_OPTIONS exact trailer changed UCD2 seq', packet, 1, 3500)
    return commandResult('GET_OPTIONS exact trailer changed UCD2 seq', response)
  } catch (error) {
    return { label: 'GET_OPTIONS exact trailer changed UCD2 seq', ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    conn.close()
  }
}

export async function runInsta360TcpDiagnostics(host: string, port: number, log: DiagnosticLogger): Promise<Insta360DiagnosticsResult> {
  log('INFO', '========== Insta360 协议诊断开始 ==========', { host, port })
  const http = await probeHttp(host, log)
  const tcpResults: Insta360TcpCommandResult[] = []
  let infoResponses: RawResponse[] = []

  try {
    const { tcp, info } = await runTcp(host, port, log)
    tcpResults.push(...tcp)
    infoResponses = info
  } catch (error) {
    tcpResults.push({ label: 'TCP connect/session', ok: false, error: error instanceof Error ? error.message : String(error) })
    log('ERROR', '[TCP] diagnostic failed', { error: error instanceof Error ? error.message : String(error) })
  }

  try {
    tcpResults.push(await runSeqVariant(host, port, log))
  } catch (error) {
    tcpResults.push({ label: 'GET_OPTIONS exact trailer changed UCD2 seq', ok: false, error: error instanceof Error ? error.message : String(error) })
  }

  const deviceInfo = parseDeviceInfo(infoResponses)
  const httpOk = http.some((item) => item.ok)
  const tcpOk = tcpResults.some((item) => item.ok)
  const summary = `HTTP ${httpOk ? '有响应' : '无响应'}；TCP ${tcpOk ? '有有效响应' : '无有效响应'}；设备信息 ${deviceInfo?.deviceName ?? '未解析'}`
  log('INFO', `========== Insta360 协议诊断结束：${summary} ==========`)
  return { success: httpOk || tcpOk, host, port, http, tcp: tcpResults, deviceInfo, summary }
}
