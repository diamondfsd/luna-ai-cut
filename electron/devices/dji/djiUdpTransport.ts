import dgram from 'node:dgram'
import { randomInt } from 'node:crypto'
import { decodeDjiMessage, encodeDjiMessage, type DjiMessage } from './djiBytes'
import { djiErrorDetails, djiMessageDetails } from './djiLog'
import { logMainDebug, logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

export interface DjiUdpPacket {
  packetType: number
  sessionId: number
  sequence: number
  payload: Buffer
  raw: Buffer
}

export type DjiUdpCommand = Omit<DjiMessage, 'flags' | 'cmdSet' | 'cmdId'> & {
  flags?: number
  cmdSet: number
  cmdId: number
  routingClass?: number
  routingTail?: number
}

const HANDSHAKE = Buffer.from('000064006400c005140000640000019001c005140000640014006400c00514000064000101040102', 'hex')
const DJI_PREVIEW_RECV_BUFFER_BYTES = 4 * 1024 * 1024

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
    raw: Buffer.from(data.subarray(0, total)),
  }
}

export function buildRoutingHeader(
  sequence: number,
  counter: number,
  peerAck = (sequence - 8) & 0xffff,
  routingClass = 0,
  routingTail = 0,
): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt16LE(peerAck & 0xffff, 0)
  header.writeUInt16LE(sequence & 0xffff, 2)
  header[8] = counter & 0xff
  header[9] = 0x01
  header[10] = routingClass & 0xff
  header[11] = routingTail & 0xff
  return header
}

export function buildHandshakePayload(baseSequence: number): Buffer {
  const payload = Buffer.from(HANDSHAKE)
  payload.writeUInt16LE(baseSequence & 0xffff, 0)
  return payload
}

/**
 * Find every CRC-valid DUML frame in a datalink datagram.
 *
 * The camera's outer UDP packet type is not stable across firmware/reply classes. Osmosis therefore
 * scans the complete datagram instead of assuming packet type 0x05 and a fixed routing offset. Keep
 * the same behavior here: normal camera replies have a 12-byte routing prefix, but scanning also
 * handles status/data variants and packets containing more than one DUML frame.
 */
export function decodeDumlMessagesFromUdp(packet: DjiUdpPacket): DjiMessage[] {
  const messages: DjiMessage[] = []
  const payload = packet.payload
  for (let offset = 0; offset + 13 <= payload.length; offset += 1) {
    const decoded = decodeDjiMessage(payload, offset)
    if (decoded) messages.push(decoded.message)
  }
  return messages
}

function decodeDumlMessagesFromStream(data: Uint8Array): DjiMessage[] {
  const messages: DjiMessage[] = []
  let offset = 0
  while (offset + 13 <= data.length) {
    const decoded = decodeDjiMessage(data, offset)
    if (decoded) {
      messages.push(decoded.message)
    }
    // Keep scanning one byte at a time, like osmosis. Some datalink replies wrap another DUML frame
    // inside the first frame; jumping to decoded.next would hide that nested media response.
    offset += 1
  }
  return messages
}

/**
 * Decode the reliable media stream the camera sends as pktType=0x03.
 *
 * A DUML frame may cross UDP datagram boundaries. The 20 bytes preceding the stream in each
 * datagram (8-byte transport header + 12-byte routing header) must be removed before concatenating;
 * otherwise those headers are injected into a frame and its CRC can never validate.
 */
export function decodeDumlMessagesFromUdpStream(packets: readonly DjiUdpPacket[]): DjiMessage[] {
  const parts = packets
    .filter((packet) => packet.packetType === 0x03 && packet.payload.length > 12)
    .map((packet) => packet.payload.subarray(12))
  return parts.length > 0 ? decodeDumlMessagesFromStream(Buffer.concat(parts)) : []
}

export function decodeDumlFromUdp(packet: DjiUdpPacket): DjiMessage | null {
  return decodeDumlMessagesFromUdp(packet)[0] ?? null
}

export function encodeDumlUdpPacket(
  message: Omit<DjiMessage, 'flags' | 'cmdSet' | 'cmdId'> & { flags: number; cmdSet: number; cmdId: number },
  sessionId: number,
  sequence: number,
  counter: number,
  peerAck = (sequence - 8) & 0xffff,
  routingClass = 0,
  routingTail = 0,
): Buffer {
  const routing = buildRoutingHeader(sequence, counter, peerAck, routingClass, routingTail)
  const frame = encodeDjiMessage(message)
  return Buffer.concat([udpHeader(0x05, routing.length + frame.length, sessionId, sequence), routing, frame])
}

function packetTypeCounts(packets: readonly DjiUdpPacket[]): Record<string, number> {
  return packets.reduce<Record<string, number>>((counts, packet) => {
    const key = `0x${packet.packetType.toString(16).padStart(2, '0')}`
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

export class DjiUdpTransport {
  private socket: dgram.Socket | null = null
  private sessionId = randomInt(0x1000, 0xfffe)
  private sequence = randomInt(0x1000, 0xf000) & 0xfff8
  private baseSequence = this.sequence
  private counter = 0
  private dumlSequence = 0xa000
  private rxType2Sequence = this.sequence
  private rxType3Sequence = this.sequence
  private peerAckedTxSequence = this.sequence
  private lastTxSequence = this.sequence
  private seenType2 = false
  private seenType3 = false
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null
  private reassertTimer: ReturnType<typeof setInterval> | null = null
  private ackTimer: ReturnType<typeof setInterval> | null = null
  private keepAliveMessageHandler: ((data: Buffer) => void) | null = null
  private readonly packetListeners = new Set<(packet: DjiUdpPacket) => void>()
  private lastAckAt = 0

  constructor(private readonly host: string, private readonly port: number) {}

  async open(): Promise<void> {
    if (this.socket) {
      logMainDebug('[DJI UDP] 复用已打开的 UDP socket', { host: this.host, port: this.port })
      return
    }
    const startedAt = Date.now()
    logMainInfo('[DJI UDP] 打开 UDP socket', { host: this.host, port: this.port })
    // DJI keeps sequence state per datalink session. Reusing the same values after a close can
    // complete the handshake while silently dropping every command that follows it.
    this.sessionId = randomInt(0x1000, 0xfffe)
    this.sequence = randomInt(0x1000, 0xf000) & 0xfff8
    this.baseSequence = this.sequence
    this.counter = 0
    this.dumlSequence = 0xa000
    this.rxType2Sequence = this.baseSequence
    this.rxType3Sequence = this.baseSequence
    this.peerAckedTxSequence = this.baseSequence
    this.lastTxSequence = this.baseSequence
    this.seenType2 = false
    this.seenType3 = false
    this.lastAckAt = 0
    const socket = dgram.createSocket('udp4')
    try {
      socket.setRecvBufferSize(DJI_PREVIEW_RECV_BUFFER_BYTES)
    } catch {
      // Some platforms reject enlarging the UDP receive buffer; the default remains usable.
    }
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.off('listening', onListening)
        logMainError('[DJI UDP] UDP socket 打开失败', {
          host: this.host,
          port: this.port,
          elapsedMs: Date.now() - startedAt,
          ...djiErrorDetails(error),
        })
        reject(error)
      }
      const onListening = (): void => {
        socket.off('error', onError)
        logMainInfo('[DJI UDP] UDP socket 已打开', {
          host: this.host,
          port: this.port,
          localAddress: socket.address(),
          elapsedMs: Date.now() - startedAt,
        })
        resolve()
      }
      socket.once('error', onError)
      socket.once('listening', onListening)
      socket.bind(0, '0.0.0.0')
    })
  }

  async handshake(): Promise<void> {
    const startedAt = Date.now()
    logMainInfo('[DJI UDP] 握手开始', { host: this.host, port: this.port, timeoutMs: 1500 })
    await this.open()
    const payload = buildHandshakePayload(this.sequence)
    try {
      const reply = await this.request(Buffer.concat([udpHeader(0x00, payload.length, this.sessionId, this.sequence), payload]), 1500)
      const packetTypes = reply.reduce<Record<string, number>>((counts, packet) => {
        const key = `0x${packet.packetType.toString(16).padStart(2, '0')}`
        counts[key] = (counts[key] ?? 0) + 1
        return counts
      }, {})
      logMainDebug('[DJI UDP] 握手响应收包完成', {
        host: this.host,
        port: this.port,
        packetCount: reply.length,
        packetTypes,
        elapsedMs: Date.now() - startedAt,
      })
      if (!reply.some((packet) => packet.packetType === 0x00)) {
        logMainWarn('[DJI UDP] 握手未收到有效 0x00 响应', {
          host: this.host,
          port: this.port,
          packetCount: reply.length,
          packetTypes,
          elapsedMs: Date.now() - startedAt,
        })
        throw new Error(`DJI UDP ${this.port} 握手超时`)
      }
    } catch (error) {
      logMainError('[DJI UDP] 握手失败', {
        host: this.host,
        port: this.port,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
    this.sequence = (this.sequence + 8) & 0xffff
    logMainInfo('[DJI UDP] 握手完成', { host: this.host, port: this.port, elapsedMs: Date.now() - startedAt })
  }

  async sendCommand(message: DjiUdpCommand): Promise<void> {
    await this.open()
    this.counter += 1
    const sequence = this.sequence
    const packet = encodeDumlUdpPacket(
      { ...message, id: this.nextDumlId(), flags: message.flags ?? 0x40 },
      this.sessionId,
      sequence,
      this.counter,
      this.peerAckedTxSequence,
      message.routingClass ?? 0,
      message.routingTail ?? 0,
    )
    this.sequence = (this.sequence + 8) & 0xffff
    await this.send(packet)
    this.lastTxSequence = sequence
  }

  async commandAndCollect(
    message: DjiUdpCommand,
    durationMs: number,
  ): Promise<DjiUdpPacket[]> {
    const startedAt = Date.now()
    await this.open()
    this.counter += 1
    const sequence = this.sequence
    const packet = encodeDumlUdpPacket(
      { ...message, id: this.nextDumlId(), flags: message.flags ?? 0x40 },
      this.sessionId,
      sequence,
      this.counter,
      this.peerAckedTxSequence,
      message.routingClass ?? 0,
      message.routingTail ?? 0,
    )
    this.sequence = (this.sequence + 8) & 0xffff
    this.lastTxSequence = sequence
    logMainDebug('[DJI UDP] 命令发送并收集响应开始', {
      host: this.host,
      port: this.port,
      durationMs,
      ...djiMessageDetails({ ...message, flags: message.flags ?? 0x40 }),
    })
    try {
      const packets = await this.request(packet, durationMs)
      logMainDebug('[DJI UDP] 命令发送并收集响应完成', {
        host: this.host,
        port: this.port,
        packetCount: packets.length,
        packetTypes: packetTypeCounts(packets),
        elapsedMs: Date.now() - startedAt,
      })
      return packets
    } catch (error) {
      logMainError('[DJI UDP] 命令发送并收集响应失败', {
        host: this.host,
        port: this.port,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  async commandSequenceAndCollect(
    messages: DjiUdpCommand[],
    durationMs: number,
    intervalMs = 0,
  ): Promise<DjiUdpPacket[]> {
    const startedAt = Date.now()
    await this.open()
    const socket = this.socket
    if (!socket) throw new Error('DJI UDP 尚未打开')
    logMainDebug('[DJI UDP] 命令序列发送并收集响应开始', {
      host: this.host,
      port: this.port,
      commandCount: messages.length,
      durationMs,
      intervalMs,
    })
    return new Promise((resolve, reject) => {
      const packets: DjiUdpPacket[] = []
      const onMessage = (data: Buffer): void => {
        const packet = parseUdpPacket(data)
        if (packet) {
          this.observe(packet)
          packets.push(packet)
        }
      }
      const timer = setTimeout(() => {
        socket.off('message', onMessage)
        logMainDebug('[DJI UDP] 命令序列收集完成', {
          host: this.host,
          port: this.port,
          commandCount: messages.length,
          packetCount: packets.length,
          packetTypes: packetTypeCounts(packets),
          elapsedMs: Date.now() - startedAt,
        })
        resolve(packets)
      }, durationMs)
      socket.on('message', onMessage)
      void (async () => {
        try {
          for (const [index, message] of messages.entries()) {
            this.counter += 1
            const sequence = this.sequence
            const packet = encodeDumlUdpPacket(
              { ...message, id: this.nextDumlId(), flags: message.flags ?? 0x40 },
              this.sessionId,
              sequence,
              this.counter,
              this.peerAckedTxSequence,
              message.routingClass ?? 0,
              message.routingTail ?? 0,
            )
            this.sequence = (this.sequence + 8) & 0xffff
            await this.send(packet)
            this.lastTxSequence = sequence
            if (intervalMs > 0 && index + 1 < messages.length) {
              await new Promise((wait) => setTimeout(wait, intervalMs))
            }
          }
        } catch (error) {
          clearTimeout(timer)
          socket.off('message', onMessage)
          logMainError('[DJI UDP] 命令序列发送失败', {
            host: this.host,
            port: this.port,
            commandCount: messages.length,
            elapsedMs: Date.now() - startedAt,
            ...djiErrorDetails(error),
          })
          reject(error)
        }
      })()
    })
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
        if (packet) {
          this.observe(packet)
          packets.push(packet)
        }
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
        if (parsed) {
          this.observe(parsed)
          packets.push(parsed)
        }
      }
      socket.on('message', onMessage)
      void this.send(packet).catch((error: unknown) => {
        clearTimeout(timer)
        socket.off('message', onMessage)
        reject(error)
      })
    })
  }

  /**
   * Keep the camera's browse session alive. The 0x00/0x88 presence beat is separate from the
   * playback command: playback is a camera-wide mode and DJI drops it roughly one second after
   * the last app presence frame.
   */
  async startKeepAlive(presence: DjiUdpCommand, reassert?: DjiUdpCommand): Promise<void> {
    const startedAt = Date.now()
    logMainDebug('[DJI UDP] 启动回放会话保活', {
      host: this.host,
      port: this.port,
      reassertEnabled: Boolean(reassert),
    })
    await this.open()
    this.stopKeepAlive()
    const socket = this.socket
    if (!socket) throw new Error('DJI UDP 尚未打开')

    const onMessage = (data: Buffer): void => {
      const packet = parseUdpPacket(data)
      if (packet) this.observe(packet)
    }
    this.keepAliveMessageHandler = onMessage
    socket.on('message', onMessage)

    try {
      await this.sendCommand(presence)
      await this.sendAck()
    } catch (error) {
      this.stopKeepAlive()
      logMainError('[DJI UDP] 启动回放会话保活失败', {
        host: this.host,
        port: this.port,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }

    this.keepAliveTimer = setInterval(() => {
      void this.sendCommand(presence).catch(() => undefined)
      void this.sendAck().catch(() => undefined)
    }, 1000)
    if (reassert) {
      this.reassertTimer = setInterval(() => {
        void this.sendCommand(reassert).catch(() => undefined)
      }, 10000)
    }
    logMainInfo('[DJI UDP] 回放会话保活已启动', {
      host: this.host,
      port: this.port,
      reassertEnabled: Boolean(reassert),
      elapsedMs: Date.now() - startedAt,
    })
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    if (this.reassertTimer) clearInterval(this.reassertTimer)
    this.keepAliveTimer = null
    this.reassertTimer = null
    if (this.keepAliveMessageHandler) this.socket?.off('message', this.keepAliveMessageHandler)
    this.keepAliveMessageHandler = null
  }

  subscribePackets(listener: (packet: DjiUdpPacket) => void): () => void {
    this.packetListeners.add(listener)
    const socket = this.socket
    if (!socket) {
      this.packetListeners.delete(listener)
      throw new Error('DJI UDP 尚未打开')
    }
    const onMessage = (data: Buffer): void => {
      const packet = parseUdpPacket(data)
      if (packet) {
        this.observe(packet)
        listener(packet)
      }
    }
    socket.on('message', onMessage)
    return () => {
      socket.off('message', onMessage)
      this.packetListeners.delete(listener)
    }
  }

  /** Send the 34-byte pktType=0x04 sliding-window acknowledgement used by Osmosis. */
  async sendAck(): Promise<void> {
    const socket = this.socket
    if (!socket) return
    const group = (value: number): Buffer => {
      const result = Buffer.alloc(8)
      result.writeUInt16LE(value & 0xffff, 0)
      result.writeUInt16LE(value & 0xffff, 2)
      return result
    }
    const payload = Buffer.concat([
      group(this.rxType2Sequence),
      group(this.rxType3Sequence),
      Buffer.from([
        this.peerAckedTxSequence & 0xff,
        (this.peerAckedTxSequence >>> 8) & 0xff,
        this.lastTxSequence & 0xff,
        (this.lastTxSequence >>> 8) & 0xff,
      ]),
      Buffer.alloc(6),
    ])
    await this.send(Buffer.concat([udpHeader(0x04, payload.length, this.sessionId, 0), payload]))
  }

  startAckTimer(intervalMs = 20): void {
    if (this.ackTimer) return
    void this.sendAck().catch(() => undefined)
    this.ackTimer = setInterval(() => {
      void this.sendAck().catch(() => undefined)
    }, intervalMs)
  }

  stopAckTimer(): void {
    if (this.ackTimer) clearInterval(this.ackTimer)
    this.ackTimer = null
  }

  close(): void {
    logMainDebug('[DJI UDP] 关闭 UDP socket', { host: this.host, port: this.port })
    this.stopKeepAlive()
    this.stopAckTimer()
    this.packetListeners.clear()
    this.socket?.close()
    this.socket = null
  }

  private observe(packet: DjiUdpPacket): void {
    // Keep the same three moving ACK windows as Osmosis. The manifest stream is normally delivered
    // as pktType 0x03, while pktType 0x01 carries the camera's ACK of our outgoing sequence.
    if (packet.sequence !== 0) {
      if (packet.packetType === 0x02) {
        this.rxType2Sequence = packet.sequence
        this.seenType2 = true
      } else if (packet.packetType === 0x03) {
        this.rxType3Sequence = packet.sequence
        this.seenType3 = true
      }
    }
    if (packet.packetType === 0x01 && packet.payload.length >= 26) {
      const statusType2 = packet.payload.readUInt16LE(2)
      const statusType3 = packet.payload.readUInt16LE(10)
      const statusAckTx = packet.payload.readUInt16LE(16)
      if (!this.seenType2 && statusType2 !== 0) this.rxType2Sequence = statusType2
      if (!this.seenType3 && statusType3 !== 0) this.rxType3Sequence = statusType3
      if (statusAckTx !== 0) this.peerAckedTxSequence = statusAckTx
    }
    if (packet.packetType === 0x05 && Date.now() - this.lastAckAt >= 100) {
      this.lastAckAt = Date.now()
      void this.sendAck().catch(() => undefined)
    }
  }

  private nextDumlId(): number {
    const id = this.dumlSequence
    this.dumlSequence = (this.dumlSequence + 1) & 0xffff
    return id
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
