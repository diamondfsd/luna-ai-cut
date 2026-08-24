import dgram from 'node:dgram'
import { randomInt } from 'node:crypto'
import { decodeDjiMessage, encodeDjiMessage, type DjiMessage } from './djiBytes'

export interface DjiUdpPacket {
  packetType: number
  sessionId: number
  sequence: number
  payload: Buffer
}

const HANDSHAKE = Buffer.from('000064006400c005140000640000019001c005140000640014006400c00514000064000101040102', 'hex')

export function udpHeader(packetType: number, payloadLength: number, sessionId: number, sequence: number): Buffer {
  const total = 8 + payloadLength
  const header = Buffer.alloc(8)
  header.writeUInt16LE(0x8000 | (total & 0x3fff), 0)
  header.writeUInt16LE(sessionId & 0xffff, 2)
  header.writeUInt16LE(sequence & 0xffff, 4)
  header[6] = packetType & 0xff
  header[7] = header.subarray(0, 7).reduce((sum, byte) => sum ^ byte, 0)
  return header
}

export function parseUdpPacket(data: Uint8Array): DjiUdpPacket | null {
  if (data.length < 8) return null
  const total = data[0] | ((data[1] & 0x3f) << 8)
  if (total < 8 || total > data.length) return null
  return {
    packetType: data[6],
    sessionId: data[2] | (data[3] << 8),
    sequence: data[4] | (data[5] << 8),
    payload: Buffer.from(data.subarray(8, total)),
  }
}

export function buildRoutingHeader(sequence: number, counter: number): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt16LE((sequence - 8) & 0xffff, 0)
  header.writeUInt16LE(sequence & 0xffff, 2)
  header[8] = counter & 0xff
  header[9] = 0x01
  return header
}

export function buildHandshakePayload(baseSequence: number): Buffer {
  const payload = Buffer.from(HANDSHAKE)
  payload.writeUInt16LE(baseSequence & 0xffff, 0)
  return payload
}

export function decodeDumlFromUdp(packet: DjiUdpPacket): DjiMessage | null {
  if (packet.packetType !== 0x05 || packet.payload.length <= 12) return null
  return decodeDjiMessage(packet.payload, 12)?.message ?? null
}

export function encodeDumlUdpPacket(
  message: Omit<DjiMessage, 'flags' | 'cmdSet' | 'cmdId'> & { flags: number; cmdSet: number; cmdId: number },
  sessionId: number,
  sequence: number,
  counter: number,
): Buffer {
  const routing = buildRoutingHeader(sequence, counter)
  const frame = encodeDjiMessage(message)
  return Buffer.concat([udpHeader(0x05, routing.length + frame.length, sessionId, sequence), routing, frame])
}

export class DjiUdpTransport {
  private socket: dgram.Socket | null = null
  private sessionId = randomInt(0x1000, 0xfffe)
  private sequence = randomInt(0x1000, 0xf000) & 0xfff8
  private counter = 0

  constructor(private readonly host: string, private readonly port: number) {}

  async open(): Promise<void> {
    if (this.socket) return
    const socket = dgram.createSocket('udp4')
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { socket.off('listening', onListening); reject(error) }
      const onListening = (): void => { socket.off('error', onError); resolve() }
      socket.once('error', onError)
      socket.once('listening', onListening)
      socket.bind(0, '0.0.0.0')
    })
  }

  async handshake(): Promise<void> {
    await this.open()
    const payload = buildHandshakePayload(this.sequence)
    const reply = await this.request(Buffer.concat([udpHeader(0x00, payload.length, this.sessionId, this.sequence), payload]), 1500)
    if (!reply.some((packet) => packet.packetType === 0x00)) throw new Error(`DJI UDP ${this.port} 握手超时`)
    this.sequence = (this.sequence + 8) & 0xffff
  }

  async sendCommand(message: Omit<DjiMessage, 'flags' | 'cmdSet' | 'cmdId'> & { flags?: number; cmdSet: number; cmdId: number }): Promise<void> {
    await this.open()
    this.counter += 1
    const packet = encodeDumlUdpPacket({ ...message, flags: message.flags ?? 0x40 }, this.sessionId, this.sequence, this.counter)
    await this.send(packet)
    this.sequence = (this.sequence + 8) & 0xffff
  }

  async commandAndCollect(
    message: Omit<DjiMessage, 'flags' | 'cmdSet' | 'cmdId'> & { flags?: number; cmdSet: number; cmdId: number },
    durationMs: number,
  ): Promise<DjiUdpPacket[]> {
    await this.open()
    this.counter += 1
    const packet = encodeDumlUdpPacket({ ...message, flags: message.flags ?? 0x40 }, this.sessionId, this.sequence, this.counter)
    this.sequence = (this.sequence + 8) & 0xffff
    return this.request(packet, durationMs)
  }

  async collect(durationMs = 700): Promise<DjiUdpPacket[]> {
    const socket = this.socket
    if (!socket) return []
    return new Promise((resolve) => {
      const packets: DjiUdpPacket[] = []
      const timer = setTimeout(() => {
        socket.off('message', onMessage)
        resolve(packets)
      }, durationMs)
      const onMessage = (data: Buffer): void => {
        const packet = parseUdpPacket(data)
        if (packet) packets.push(packet)
      }
      socket.on('message', onMessage)
      void timer
    })
  }

  async request(packet: Buffer, timeoutMs: number): Promise<DjiUdpPacket[]> {
    const socket = this.socket
    if (!socket) throw new Error('DJI UDP 尚未打开')
    return new Promise((resolve, reject) => {
      const packets: DjiUdpPacket[] = []
      const timer = setTimeout(() => {
        socket.off('message', onMessage)
        resolve(packets)
      }, timeoutMs)
      const onMessage = (data: Buffer): void => {
        const parsed = parseUdpPacket(data)
        if (parsed) packets.push(parsed)
      }
      socket.on('message', onMessage)
      void this.send(packet).catch((error: unknown) => {
        clearTimeout(timer)
        socket.off('message', onMessage)
        reject(error)
      })
    })
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }

  private async send(packet: Buffer): Promise<void> {
    const socket = this.socket
    if (!socket) throw new Error('DJI UDP 尚未打开')
    await new Promise<void>((resolve, reject) => {
      socket.send(packet, this.port, this.host, (error) => error ? reject(error) : resolve())
    })
  }
}

export const DJI_HANDSHAKE_PAYLOAD = HANDSHAKE
