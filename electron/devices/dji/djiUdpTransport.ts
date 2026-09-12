import dgram from 'node:dgram'
import { randomInt } from 'node:crypto'
import { decodeDjiMessage, encodeDjiMessage, type DjiMessage } from './djiBytes'
import { buildAckPayload, buildRoutingHeader, cameraChannelFromPacket, nextSequenceForCameraChannel } from './djiUdpProtocol'
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

export type PacketActivityPredicate = (packet: DjiUdpPacket) => boolean

export interface DjiUdpCollectionOptions {
  quietDurationMs?: number
  isActivity?: PacketActivityPredicate
  quietFromStart?: boolean
  isComplete?: (packets: readonly DjiUdpPacket[]) => boolean
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

/** Incrementally decode DUML frames carried by the reliable UDP data stream. */
export class DjiDumlStreamAssembler {
  private pending = Buffer.alloc(0)

  reset(): void {
    this.pending = Buffer.alloc(0)
  }

  feed(packet: DjiUdpPacket): DjiMessage[] {
    if (packet.packetType !== 0x03) return decodeDumlMessagesFromUdp(packet)
    if (packet.payload.length <= 12) return []
    this.pending = Buffer.concat([this.pending, packet.payload.subarray(12)])
    if (this.pending.length > 8192) this.pending = this.pending.subarray(this.pending.length - 8192)

    const messages: DjiMessage[] = []
    while (this.pending.length >= 4) {
      const start = this.pending.indexOf(0x55)
      if (start < 0) {
        this.pending = Buffer.alloc(0)
        break
      }
      if (start > 0) this.pending = this.pending.subarray(start)
      if (this.pending.length < 4) break
      const length = this.pending[1]! | ((this.pending[2]! & 0x03) << 8)
      const version = this.pending[2]! >>> 2
      if (version !== 1 || length < 13) {
        this.pending = this.pending.subarray(1)
        continue
      }
      if (this.pending.length < length) break
      const decoded = decodeDjiMessage(this.pending, 0)
      if (!decoded) {
        this.pending = this.pending.subarray(1)
        continue
      }
      messages.push(decoded.message)
      this.pending = this.pending.subarray(decoded.next)
    }
    return messages
  }
}

export function encodeDumlUdpPacket(
  message: Omit<DjiMessage, 'flags' | 'cmdSet' | 'cmdId'> & { flags: number; cmdSet: number; cmdId: number },
  sessionId: number,
  sequence: number,
  counter: number,
  routingClass = 0,
  routingTail = 0,
): Buffer {
  const routing = buildRoutingHeader(sequence, counter, routingClass, routingTail)
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
  private readonly host: string
  private readonly port: number
  private socket: dgram.Socket | null = null
  private sessionId = randomInt(0x1000, 0xfffe)
  private baseSequence = randomInt(0x1000, 0xf000) & 0xfff8
  private sequence = 0
  private counter = 0
  private dumlSequence = 0xa000
  private rxType2Sequence = 0
  private rxType3Sequence = 0
  private seenType2 = false
  private seenType3 = false
  private extraSequence = 0
  private seenExtra = false
  private cameraChannel: number | null = null
  private sequenceSynchronized = false
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null
  private reassertTimer: ReturnType<typeof setInterval> | null = null
  private ackTimer: ReturnType<typeof setInterval> | null = null
  private socketMessageHandler: ((data: Buffer) => void) | null = null
  private readonly packetListeners = new Set<(packet: DjiUdpPacket) => void>()
  private lastAckAt = 0
  private socketGeneration = 0
  private sendQueue: Promise<void> = Promise.resolve()

  constructor(host: string, port: number) {
    this.host = host
    this.port = port
  }

  async open(): Promise<void> {
    if (this.socket) {
      logMainDebug('[DJI UDP] 复用已打开的 UDP socket', { host: this.host, port: this.port })
      return
    }
    // DJI keeps sequence state per datalink session. Reusing the same values after a close can
    // complete the handshake while silently dropping every command that follows it.
    this.sessionId = randomInt(0x1000, 0xfffe)
    this.baseSequence = randomInt(0x1000, 0xf000) & 0xfff8
    this.sequence = 0
    this.counter = 0
    this.dumlSequence = 0xa000
    this.rxType2Sequence = this.baseSequence
    this.rxType3Sequence = this.baseSequence
    this.seenType2 = false
    this.seenType3 = false
    this.extraSequence = this.baseSequence
    this.seenExtra = false
    this.cameraChannel = null
    this.sequenceSynchronized = false
    this.lastAckAt = 0
    await this.bindSocket('打开')
  }

  /** Bind a new local UDP port without changing the DJI session or sequence cursors. */
  async rebuildSocket(reason = '恢复预览'): Promise<void> {
    if (!this.socket) throw new Error('DJI UDP 没有可保留的会话 socket')
    const startedAt = Date.now()
    logMainWarn('[DJI UDP] 保留会话重建 UDP socket', {
      host: this.host,
      port: this.port,
      reason,
    })
    const oldSocket = this.socket
    this.detachSocket(oldSocket)
    this.socket = null
    this.socketGeneration += 1
    this.sendQueue = Promise.resolve()
    oldSocket.close()
    try {
      await this.bindSocket('重建')
      logMainInfo('[DJI UDP] 保留会话重建完成', {
        host: this.host,
        port: this.port,
        reason,
        elapsedMs: Date.now() - startedAt,
      })
    } catch (error) {
      logMainError('[DJI UDP] 保留会话重建失败', {
        host: this.host,
        port: this.port,
        reason,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  private async bindSocket(action: string): Promise<void> {
    const startedAt = Date.now()
    logMainInfo(`[DJI UDP] ${action} UDP socket`, { host: this.host, port: this.port })
    const socketGeneration = ++this.socketGeneration
    const socket = dgram.createSocket('udp4')
    try {
      socket.setRecvBufferSize(DJI_PREVIEW_RECV_BUFFER_BYTES)
    } catch {
      // Some platforms reject enlarging the UDP receive buffer; the default remains usable.
    }
    this.socket = socket
    const onMessage = (data: Buffer): void => {
      if (this.socket !== socket || this.socketGeneration !== socketGeneration) return
      const packet = parseUdpPacket(data)
      if (!packet) return
      this.observe(packet)
      for (const listener of this.packetListeners) listener(packet)
    }
    this.socketMessageHandler = onMessage
    socket.on('message', onMessage)
    await new Promise<void>((resolve, reject) => {
      let listening = false
      const onError = (error: Error): void => {
        socket.off('listening', onListening)
        socket.off('message', onMessage)
        socket.off('error', onError)
        if (this.socket === socket && this.socketGeneration === socketGeneration) {
          this.socket = null
          this.socketGeneration += 1
          this.sendQueue = Promise.resolve()
        }
        if (this.socketMessageHandler === onMessage) this.socketMessageHandler = null
        try {
          socket.close()
        } catch {
          // The socket may already have been closed by the OS after emitting the error.
        }
        logMainError('[DJI UDP] UDP socket 打开失败', {
          host: this.host,
          port: this.port,
          action,
          elapsedMs: Date.now() - startedAt,
          ...djiErrorDetails(error),
        })
        if (!listening) reject(error)
      }
      const onListening = (): void => {
        listening = true
        logMainInfo('[DJI UDP] UDP socket 已打开', {
          host: this.host,
          port: this.port,
          action,
          localAddress: socket.address(),
          elapsedMs: Date.now() - startedAt,
        })
        resolve()
      }
      socket.on('error', onError)
      socket.once('listening', onListening)
      socket.bind(0, '0.0.0.0')
    })
  }

  async handshake(): Promise<void> {
    const startedAt = Date.now()
    logMainInfo('[DJI UDP] 握手开始', { host: this.host, port: this.port, timeoutMs: 1500 })
    await this.open()
    const payload = buildHandshakePayload(this.baseSequence)
    try {
      // Handshake datagrams use transport sequence zero. The random base is carried in the
      // handshake payload and reliable command sequencing starts at cameraChannel + 8.
      const reply = await this.request(Buffer.concat([udpHeader(0x00, payload.length, this.sessionId, 0), payload]), 1500)
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
    // The handshake itself consumes transport sequence 0. Reliable command traffic starts at the
    // camera channel + 8; when no channel arrived during the handshake, the advertised base is the
    // compatible fallback used by OpenPocketCine.
    this.sequence = 8
    if (!this.synchronizeSequenceToCameraChannel()) {
      // Keep the legacy base-sequence fallback for mock/older devices that do not emit a reliable
      // packet during the handshake window. A real Pocket 4 will be aligned before preview starts.
      this.sequence = nextSequenceForCameraChannel(this.baseSequence)
    }
    logMainInfo('[DJI UDP] 握手完成', { host: this.host, port: this.port, elapsedMs: Date.now() - startedAt })
  }

  async sendCommand(message: DjiUdpCommand): Promise<void> {
    await this.sendCommandAtSequence(message, this.sequence, true)
  }

  private createCommandPacket(message: DjiUdpCommand, sequence: number, advanceSequence: boolean): Buffer {
    this.counter += 1
    const packet = encodeDumlUdpPacket(
      { ...message, id: this.nextDumlId(), flags: message.flags ?? 0x40 },
      this.sessionId,
      sequence,
      this.counter,
      message.routingClass ?? 0,
      message.routingTail ?? 0,
    )
    if (advanceSequence) this.sequence = (sequence + 8) & 0xffff
    return packet
  }

  private async sendCommandAtSequence(message: DjiUdpCommand, sequence: number, advanceSequence: boolean): Promise<void> {
    await this.open()
    await this.send(this.createCommandPacket(message, sequence, advanceSequence))
  }

  /**
   * Pocket 4 may not publish its reliable channel until the live-view trigger
   * is sent. Probe with the unsequenced trigger, learn the route prefix, then
   * continue the command stream at cameraChannel + 8 as in dji-mimo.
   */
  async synchronizePreviewChannel(trigger: DjiUdpCommand, timeoutMs = 500): Promise<{
    cameraChannel: number
    nextSequence: number
    probed: boolean
  }> {
    await this.open()
    if (this.cameraChannel !== null) {
      this.synchronizeSequenceToCameraChannel()
      return {
        cameraChannel: this.cameraChannel,
        nextSequence: this.sequence,
        probed: false,
      }
    }

    const startedAt = Date.now()
    const probePacket = this.createCommandPacket(trigger, 0, false)
    const packets = await this.collectPackets(timeoutMs, {
      isComplete: () => this.cameraChannel !== null,
    }, probePacket)
    if (this.cameraChannel === null) {
      throw new Error(`DJI 预览可靠通道同步超时（收到 ${packets.length} 个响应包）`)
    }

    const cameraChannel: number = this.cameraChannel
    this.synchronizeSequenceToCameraChannel()
    logMainInfo('[DJI UDP] 预览可靠通道已同步', {
      host: this.host,
      port: this.port,
      cameraChannel: `0x${cameraChannel.toString(16).padStart(4, '0')}`,
      nextSequence: `0x${this.sequence.toString(16).padStart(4, '0')}`,
      packetCount: packets.length,
      elapsedMs: Date.now() - startedAt,
    })
    return {
      cameraChannel,
      nextSequence: this.sequence,
      probed: true,
    }
  }

  private synchronizeSequenceToCameraChannel(): boolean {
    if (this.cameraChannel === null) return false
    if (this.sequenceSynchronized) return true
    this.sequence = nextSequenceForCameraChannel(this.cameraChannel)
    this.sequenceSynchronized = true
    return true
  }

  previewTransportState(): {
    baseSequence: number
    cameraChannel: number | null
    nextSequence: number
    sequenceSynchronized: boolean
  } {
    return {
      baseSequence: this.baseSequence,
      cameraChannel: this.cameraChannel,
      nextSequence: this.sequence,
      sequenceSynchronized: this.sequenceSynchronized,
    }
  }

  async commandAndCollect(
    message: DjiUdpCommand,
    durationMs: number,
    options: DjiUdpCollectionOptions = {},
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
      message.routingClass ?? 0,
      message.routingTail ?? 0,
    )
    this.sequence = (this.sequence + 8) & 0xffff
    logMainDebug('[DJI UDP] 命令发送并收集响应开始', {
      host: this.host,
      port: this.port,
      durationMs,
      ...djiMessageDetails({ ...message, flags: message.flags ?? 0x40 }),
    })
    try {
      const packets = await this.collectPackets(durationMs, options, packet)
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
    const socketGeneration = this.socketGeneration
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
        if (this.socket !== socket || this.socketGeneration !== socketGeneration) return
        const packet = parseUdpPacket(data)
        if (packet) {
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
              message.routingClass ?? 0,
              message.routingTail ?? 0,
            )
            this.sequence = (this.sequence + 8) & 0xffff
            await this.send(packet)
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
    return this.collectPackets(durationMs)
  }

  /**
   * Collect a burst without waiting through the whole maximum window after the stream goes quiet.
   * The maximum is retained because DJI may pause between reliable downlink fragments.
   */
  async collectUntilQuiet(
    maxDurationMs = 800,
    quietDurationMs = 400,
    isActivity: PacketActivityPredicate = () => true,
    quietFromStart = false,
    options: DjiUdpCollectionOptions = {},
  ): Promise<DjiUdpPacket[]> {
    return this.collectPackets(maxDurationMs, { ...options, quietDurationMs, isActivity, quietFromStart })
  }

  private async collectPackets(
    maxDurationMs: number,
    options: DjiUdpCollectionOptions = {},
    packetToSend?: Buffer,
  ): Promise<DjiUdpPacket[]> {
    const socket = this.socket
    if (!socket) return []
    const socketGeneration = this.socketGeneration
    const quietDurationMs = options.quietDurationMs ?? null
    const isActivity = options.isActivity ?? (() => true)
    return new Promise((resolve, reject) => {
      const packets: DjiUdpPacket[] = []
      let finished = false
      let quietTimer: ReturnType<typeof setTimeout> | null = null
      const finish = (): void => {
        if (finished) return
        finished = true
        clearTimeout(maxTimer)
        if (quietTimer) clearTimeout(quietTimer)
        socket.off('message', onMessage)
        resolve(packets)
      }
      const armQuietTimer = (): void => {
        if (quietDurationMs === null) return
        if (quietTimer) clearTimeout(quietTimer)
        quietTimer = setTimeout(finish, quietDurationMs)
      }
      const onMessage = (data: Buffer): void => {
        if (this.socket !== socket || this.socketGeneration !== socketGeneration) return
        const packet = parseUdpPacket(data)
        if (!packet) return
        packets.push(packet)
        if (isActivity(packet)) armQuietTimer()
        if (options.isComplete?.(packets)) finish()
      }
      const maxTimer = setTimeout(finish, maxDurationMs)
      socket.on('message', onMessage)
      if (quietDurationMs !== null && options.quietFromStart) armQuietTimer()
      if (packetToSend) {
        void this.send(packetToSend).catch((error: unknown) => {
          if (finished) return
          finished = true
          clearTimeout(maxTimer)
          if (quietTimer) clearTimeout(quietTimer)
          socket.off('message', onMessage)
          reject(error)
        })
      }
    })
  }

  async request(packet: Buffer, timeoutMs: number): Promise<DjiUdpPacket[]> {
    if (!this.socket) throw new Error('DJI UDP 尚未打开')
    return this.collectPackets(timeoutMs, {}, packet)
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
  }

  subscribePackets(listener: (packet: DjiUdpPacket) => void): () => void {
    this.packetListeners.add(listener)
    if (!this.socket) {
      this.packetListeners.delete(listener)
      throw new Error('DJI UDP 尚未打开')
    }
    return () => {
      this.packetListeners.delete(listener)
    }
  }

  /** Send the 34-byte pktType=0x04 sliding-window acknowledgement used by Osmosis. */
  async sendAck(): Promise<void> {
    const socket = this.socket
    if (!socket) return
    // Group 0 is the best-effort video cursor. Before the first video datagram OpenPocketCine sends
    // zero; using the random handshake base here makes the camera skip the beginning of its first GOP.
    const videoSequence = this.seenType2 ? this.rxType2Sequence : 0
    const ackedDataSequence = this.seenType3 ? this.rxType3Sequence : this.baseSequence
    const extraSequence = this.seenExtra ? this.extraSequence : this.baseSequence
    const payload = buildAckPayload(
      videoSequence,
      ackedDataSequence,
      extraSequence,
    )
    await this.send(Buffer.concat([udpHeader(0x04, payload.length, this.sessionId, 0), payload]))
  }

  startAckTimer(intervalMs = 25): void {
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
    this.socketGeneration += 1
    const socket = this.socket
    this.detachSocket(socket)
    this.socket = null
    this.sendQueue = Promise.resolve()
    socket?.close()
  }

  private detachSocket(socket: dgram.Socket | null): void {
    if (socket && this.socketMessageHandler) socket.off('message', this.socketMessageHandler)
    this.socketMessageHandler = null
  }

  private observe(packet: DjiUdpPacket): void {
    // Keep the same three moving ACK windows as Osmosis. The manifest stream is normally delivered
    // as pktType 0x03, while pktType 0x01 carries the camera's ACK of our outgoing sequence.
    if (packet.packetType === 0x02) {
      this.rxType2Sequence = packet.sequence
      this.seenType2 = true
    } else if (packet.packetType === 0x03) {
      this.rxType3Sequence = packet.sequence
      this.seenType3 = true
    }
    const cameraChannel = cameraChannelFromPacket(packet)
    if (cameraChannel !== null && cameraChannel !== this.cameraChannel) {
      this.cameraChannel = cameraChannel
      logMainDebug('[DJI UDP] 收到相机可靠通道', {
        host: this.host,
        port: this.port,
        packetType: `0x${packet.packetType.toString(16).padStart(2, '0')}`,
        cameraChannel: `0x${cameraChannel.toString(16).padStart(4, '0')}`,
      })
    }
    if (packet.packetType === 0x01 && packet.payload.length >= 26) {
      // Telemetry repeats the three ACK windows at payload offsets 2, 10 and 18
      // (raw datagram offsets 10, 18 and 26). It may seed a window, but must not
      // rewind one after real video or reliable data has already been observed.
      const telemetryVideo = packet.payload.readUInt16LE(2)
      const telemetryAckedData = packet.payload.readUInt16LE(10)
      this.extraSequence = packet.payload.readUInt16LE(18)
      this.seenExtra = true
      if (!this.seenType2) {
        this.rxType2Sequence = telemetryVideo
        this.seenType2 = true
      }
      if (!this.seenType3) {
        this.rxType3Sequence = telemetryAckedData
        this.seenType3 = true
      }
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
    const socketGeneration = this.socketGeneration
    const sendTask = this.sendQueue.then(() => {
      if (this.socket !== socket || this.socketGeneration !== socketGeneration) {
        throw new Error('DJI UDP socket 已重建，丢弃过期数据包')
      }
      return new Promise<void>((resolve, reject) => {
        socket.send(packet, this.port, this.host, (error) => error ? reject(error) : resolve())
      })
    })
    this.sendQueue = sendTask.catch(() => undefined)
    await sendTask
  }
}

export const DJI_HANDSHAKE_PAYLOAD = HANDSHAKE
