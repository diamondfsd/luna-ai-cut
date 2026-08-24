import * as net from 'node:net'

import { extractAsciiStrings } from './insta360DeviceInfo'
import {
  buildFileCommand,
  buildStreamHello,
  parseRawResponse,
  UCD2_FILE,
  UCD2_MAGIC,
  UCD2_STREAM,
} from './insta360TcpCodec'
import type { Insta360RawResponse } from './insta360TcpCodec'
import {
  buildMessageCommand,
  buildMessageNotification,
  diagnosticAscii,
  diagnosticHex,
  parseMessageEnvelope,
  type Insta360MessageResponse,
} from './insta360TcpDiagnosticsCodec'
import type { DiagnosticLogger } from './insta360TcpDiagnosticsTypes'

export function connectDiagnosticSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
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

export class Insta360DiagnosticTcpSession {
  private buffer = Buffer.alloc(0)
  private seq = 0x24
  private requestId = 1
  private pendingFile = new Map<number, {
    resolve: (response: Insta360RawResponse) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private pendingMessage = new Map<number, {
    resolve: (response: Insta360MessageResponse) => void
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
    this.log('INFO', `[TCP] TX ${label}`, { bytes: packet.length, hex: diagnosticHex(packet) })
    this.socket.write(packet)
  }

  sendHello(): void {
    this.write('STREAM hello pcap-tail', buildStreamHello(this.nextSeq()))
  }

  sendFile(label: string, code: number, body: Buffer, timeoutMs = 5000): Promise<Insta360RawResponse> {
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

  sendMessage(label: string, code: number, body = Buffer.alloc(0), timeoutMs = 3000): Promise<Insta360MessageResponse> {
    const requestId = this.requestId++
    const packet = buildMessageCommand(this.nextSeq(), code, requestId, body)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMessage.delete(requestId)
        reject(new Error(`${label} timeout`))
      }, timeoutMs)
      this.pendingMessage.set(requestId, { resolve, reject, timer })
      this.write(`${label} req=${requestId}`, packet)
    })
  }

  notifyMessage(label: string, code: number, body = Buffer.alloc(0)): void {
    this.write(label, buildMessageNotification(this.nextSeq(), code, body))
  }

  private onData(data: Buffer): void {
    this.log('INFO', '[TCP] RX bytes', { bytes: data.length, hex: diagnosticHex(data) })
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
      const frameLength = this.frameLength(type)
      if (frameLength === 0) {
        this.log('WARN', '[TCP] unknown UCD2 frame type', { type, seq: this.buffer[7] })
        this.buffer = this.buffer.subarray(8)
        continue
      }
      if (this.buffer.length < frameLength) return
      const frame = this.buffer.subarray(0, frameLength)
      this.buffer = this.buffer.subarray(frameLength)
      this.handleFrame(frame)
    }
  }

  private frameLength(type: number): number {
    if (type === UCD2_STREAM) return 16
    if (type === UCD2_FILE && this.buffer.length >= 12) return 12 + this.buffer.readUInt32LE(8) + 4
    if (type === 0x03) {
      const next = this.buffer.indexOf(UCD2_MAGIC, 8)
      return next > 0 ? next : this.buffer.length
    }
    return 0
  }

  private handleFrame(frame: Buffer): void {
    const type = frame[6]
    const seq = frame[7]
    if (type === UCD2_STREAM) {
      this.log('INFO', '[TCP] RX STREAM', { seq, bytes: frame.length, payload: diagnosticHex(frame.subarray(8)) })
      return
    }
    if (type === 0x03) {
      const message = parseMessageEnvelope(frame.subarray(8))
      this.log('INFO', '[TCP] RX MSG', {
        seq,
        requestId: message.requestId,
        messageCode: message.messageCode,
        bodyBytes: message.body.length,
        bodyHex: diagnosticHex(message.body),
        bodyAscii: diagnosticAscii(message.body),
      })
      const pending = this.pendingMessage.get(message.requestId)
      if (pending) {
        this.pendingMessage.delete(message.requestId)
        clearTimeout(pending.timer)
        pending.resolve(message)
      }
      return
    }
    const response = parseRawResponse(frame.subarray(8))
    if (!response) {
      this.log('WARN', '[TCP] RX FILE parse failed', { seq, bytes: frame.length, hex: diagnosticHex(frame) })
      return
    }
    this.log('INFO', '[TCP] RX FILE', {
      seq,
      code: response.code,
      requestId: response.requestId,
      bodyBytes: response.body.length,
      trailer: diagnosticHex(response.trailer),
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
    for (const pending of this.pendingMessage.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingFile.clear()
    this.pendingMessage.clear()
  }

  private nextSeq(): number {
    const value = this.seq & 0xff
    this.seq = (this.seq + 1) & 0xff
    return value
  }
}

