import { createSocket, type Socket as DgramSocket } from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'

import type { LocalVideoStreamInfo } from './localVideoStreamServer'

export type ObsInputCodec = 'h264' | 'h265'

const RTSP_PATH = '/luna'
const RTP_PAYLOAD_TYPE = 96
const RTP_CLOCK_RATE = 90_000
const RTP_MTU_PAYLOAD = 1_200
const RTSP_PORT = 8_554
const CLIENT_QUEUE_CAPACITY = 4

interface EncodedAccessUnit {
  nals: Buffer[]
  timestampUs: number
}

interface RtspClient {
  socket: Socket
  session: string
  requestBuffer: Buffer
  requestChain: Promise<void>
  playing: boolean
  transport: 'tcp' | 'udp' | null
  interleavedChannel: number
  clientAddress: string
  clientRtpPort: number | null
  rtpSocket: DgramSocket | null
  rtcpSocket: DgramSocket | null
  queue: Buffer[][]
  flushing: boolean
}

interface RtspRequest {
  method: string
  url: string
  headers: Map<string, string>
}

type RtspLogger = (message: string, meta?: unknown) => void

/** 将相机的 Annex-B 视频数据封装为 OBS 可读取的本机 RTSP 流。 */
export class LocalObsVideoStreamServer {
  private server: Server | null = null
  private readonly clients = new Set<RtspClient>()
  private codec: ObsInputCodec | null = null
  private streamUrl: string | null = null
  private streamPort: number | null = null
  private sequence = randomBytes(2).readUInt16BE(0)
  private readonly ssrc = randomBytes(4).readUInt32BE(0)
  private parameterSets = new Map<number, Buffer>()
  private latestKeyframe: EncodedAccessUnit | null = null
  private stopPromise: Promise<void> | null = null
  private readonly logInfo?: RtspLogger
  private readonly logWarn?: RtspLogger

  constructor(logInfo?: RtspLogger, logWarn?: RtspLogger) {
    this.logInfo = logInfo
    this.logWarn = logWarn
  }

  setCodec(codec: ObsInputCodec): void {
    if (this.codec !== codec) {
      this.parameterSets.clear()
      this.latestKeyframe = null
    }
    this.codec = codec
  }

  async start(codec: ObsInputCodec, port = RTSP_PORT): Promise<LocalVideoStreamInfo> {
    if (this.server && this.codec === codec && this.streamUrl && this.streamPort) {
      return { url: this.streamUrl, port: this.streamPort }
    }

    await this.stopInternal(false)
    this.setCodec(codec)

    const server = createServer((socket) => this.acceptClient(socket))
    await new Promise<void>((resolve, reject) => {
      let listening = false
      const onError = (error: Error) => {
        if (listening) {
          this.logWarn?.('[OBS 推送] RTSP 服务异常', { error: error.message })
          return
        }
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        listening = true
        resolve()
      }
      server.on('error', onError)
      server.once('listening', onListening)
      server.listen({ host: '127.0.0.1', port })
    }).catch(async (error: unknown) => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      this.codec = null
      throw error
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      this.codec = null
      throw new Error('无法获取 RTSP 视频流端口')
    }
    this.server = server
    this.streamPort = address.port
    this.streamUrl = `rtsp://127.0.0.1:${address.port}${RTSP_PATH}`
    this.logInfo?.('[OBS 推送] RTSP 地址已启动', { url: this.streamUrl, codec })
    return { url: this.streamUrl, port: address.port }
  }

  publishVideoFrame(payload: Buffer, timestampUs = Date.now() * 1_000): void {
    if (!this.codec || payload.length === 0) return
    const nals = splitNalUnits(payload).filter((nal) => nal.length > 0)
    if (nals.length === 0) return

    const codec = this.codec
    const inBandParameterSets = nals.filter((nal) => isParameterSet(nal, codec))
    for (const nal of inBandParameterSets) this.parameterSets.set(nalType(nal, codec), Buffer.from(nal))
    const keyframe = nals.some((nal) => isKeyframe(nal, codec))
    const accessUnit: EncodedAccessUnit = {
      nals: keyframe && inBandParameterSets.length === 0
        ? [...this.parameterSets.values(), ...nals]
        : nals,
      timestampUs,
    }
    if (keyframe) this.latestKeyframe = accessUnit

    for (const client of this.clients) {
      if (!client.playing || client.socket.destroyed) continue
      this.enqueueAccessUnit(client, accessUnit)
    }
  }

  async stop(resetCodec = true): Promise<void> {
    await this.stopInternal(resetCodec)
  }

  private async stopInternal(resetCodec: boolean): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    const server = this.server
    this.server = null
    this.streamUrl = null
    this.streamPort = null
    if (resetCodec) {
      this.codec = null
      this.parameterSets.clear()
      this.latestKeyframe = null
    }
    this.stopPromise = (async () => {
      for (const client of [...this.clients]) this.disposeClient(client)
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    })().finally(() => {
      this.stopPromise = null
    })
    return this.stopPromise
  }

  private acceptClient(socket: Socket): void {
    socket.setNoDelay(true)
    socket.setKeepAlive(true)
    const client: RtspClient = {
      socket,
      session: randomBytes(6).toString('hex'),
      requestBuffer: Buffer.alloc(0),
      requestChain: Promise.resolve(),
      playing: false,
      transport: null,
      interleavedChannel: 0,
      clientAddress: normalizeAddress(socket.remoteAddress),
      clientRtpPort: null,
      rtpSocket: null,
      rtcpSocket: null,
      queue: [],
      flushing: false,
    }
    this.clients.add(client)
    socket.on('data', (chunk: Buffer) => this.readClientData(client, chunk))
    socket.once('error', (error) => {
      if (!client.socket.destroyed) this.logWarn?.('[OBS 推送] RTSP 客户端连接异常', { error: error.message })
      this.disposeClient(client)
    })
    socket.once('close', () => this.disposeClient(client))
  }

  private readClientData(client: RtspClient, chunk: Buffer): void {
    client.requestBuffer = Buffer.concat([client.requestBuffer, chunk])
    while (client.requestBuffer.length > 0) {
      if (client.requestBuffer[0] === 0x24) {
        if (client.requestBuffer.length < 4) return
        const length = client.requestBuffer.readUInt16BE(2)
        if (client.requestBuffer.length < 4 + length) return
        client.requestBuffer = client.requestBuffer.subarray(4 + length)
        continue
      }

      const headerEnd = client.requestBuffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const headerText = client.requestBuffer.subarray(0, headerEnd + 4).toString('utf8')
      const parsedHeaders = parseHeaders(headerText)
      const contentLength = Number.parseInt(parsedHeaders.headers.get('content-length') ?? '0', 10) || 0
      const totalLength = headerEnd + 4 + contentLength
      if (client.requestBuffer.length < totalLength) return
      const requestText = client.requestBuffer.subarray(0, totalLength).toString('utf8')
      client.requestBuffer = client.requestBuffer.subarray(totalLength)
      const request = parseHeaders(requestText)
      client.requestChain = client.requestChain
        .then(() => this.handleRequest(client, request))
        .catch((error: unknown) => {
          this.logWarn?.('[OBS 推送] RTSP 请求处理失败', { error: error instanceof Error ? error.message : String(error) })
          this.disposeClient(client)
        })
    }
  }

  private async handleRequest(client: RtspClient, request: RtspRequest): Promise<void> {
    if (client.socket.destroyed) return
    const cseq = request.headers.get('cseq') ?? '0'
    switch (request.method) {
      case 'OPTIONS':
      case 'GET_PARAMETER':
      case 'SET_PARAMETER':
        this.writeResponse(client, cseq, '200 OK', { Public: 'OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN, GET_PARAMETER' })
        return
      case 'DESCRIBE': {
        const body = this.sdp()
        this.writeResponse(client, cseq, '200 OK', {
          'Content-Base': `${request.url}/`,
          'Content-Type': 'application/sdp',
        }, body)
        return
      }
      case 'SETUP':
        await this.setupClient(client, cseq, request.headers.get('transport') ?? null)
        return
      case 'PLAY':
        if (!client.transport) {
          this.writeResponse(client, cseq, '455 Method Not Valid in This State')
          return
        }
        client.playing = true
        this.writeResponse(client, cseq, '200 OK', { Session: client.session, Range: 'npt=0.000-' })
        this.enqueueInitialFrame(client)
        return
      case 'PAUSE':
        client.playing = false
        client.queue.length = 0
        this.writeResponse(client, cseq, '200 OK', { Session: client.session })
        return
      case 'TEARDOWN':
        this.writeResponse(client, cseq, '200 OK', { Session: client.session })
        this.disposeClient(client)
        return
      default:
        this.writeResponse(client, cseq, '405 Method Not Allowed', { Allow: 'OPTIONS, DESCRIBE, SETUP, PLAY, PAUSE, TEARDOWN, GET_PARAMETER' })
    }
  }

  private async setupClient(client: RtspClient, cseq: string, transportHeader: string | null): Promise<void> {
    if (!transportHeader) {
      this.writeResponse(client, cseq, '461 Unsupported Transport')
      return
    }
    const lower = transportHeader.toLowerCase()
    const interleaved = /interleaved=(\d+)(?:-(\d+))?/.exec(lower)
    if (interleaved || lower.includes('/tcp')) {
      client.interleavedChannel = Number(interleaved?.[1] ?? 0)
      client.transport = 'tcp'
      client.clientRtpPort = null
      this.closeUdpTransport(client)
      this.writeResponse(client, cseq, '200 OK', {
        Transport: `RTP/AVP/TCP;unicast;interleaved=${client.interleavedChannel}-${client.interleavedChannel + 1};mode=play`,
        Session: client.session,
      })
      return
    }
    const clientPorts = /client_port=(\d+)(?:-(\d+))?/.exec(lower)
    const clientPort = Number(clientPorts?.[1])
    if (!Number.isInteger(clientPort) || clientPort <= 0) {
      this.writeResponse(client, cseq, '461 Unsupported Transport')
      return
    }
    await this.bindUdpTransport(client, clientPort)
    client.transport = 'udp'
    const rtpAddress = client.rtpSocket?.address()
    const rtcpAddress = client.rtcpSocket?.address()
    if (!rtpAddress || typeof rtpAddress === 'string' || !rtcpAddress || typeof rtcpAddress === 'string') {
      this.writeResponse(client, cseq, '500 Internal Server Error')
      return
    }
    this.writeResponse(client, cseq, '200 OK', {
      Transport: `RTP/AVP/UDP;unicast;client_port=${clientPort}-${Number(clientPorts?.[2] ?? clientPort + 1)};server_port=${rtpAddress.port}-${rtcpAddress.port};mode=play`,
      Session: client.session,
    })
  }

  private async bindUdpTransport(client: RtspClient, clientPort: number): Promise<void> {
    this.closeUdpTransport(client)
    const rtpSocket = createSocket('udp4')
    const rtcpSocket = createSocket('udp4')
    client.clientRtpPort = clientPort
    client.rtpSocket = rtpSocket
    client.rtcpSocket = rtcpSocket
    rtpSocket.on('error', (error) => this.logWarn?.('[OBS 推送] RTP UDP 服务异常', { error: error.message }))
    rtcpSocket.on('error', (error) => this.logWarn?.('[OBS 推送] RTCP UDP 服务异常', { error: error.message }))
    await Promise.all([bindUdpSocket(rtpSocket), bindUdpSocket(rtcpSocket)])
  }

  private writeResponse(client: RtspClient, cseq: string, status: string, headers: Record<string, string> = {}, body = ''): void {
    if (client.socket.destroyed) return
    const lines = [`RTSP/1.0 ${status}`, `CSeq: ${cseq}`, 'Server: Luna AI Cut RTSP']
    for (const [key, value] of Object.entries(headers)) lines.push(`${key}: ${value}`)
    lines.push(`Content-Length: ${Buffer.byteLength(body)}`, '', body)
    client.socket.write(lines.join('\r\n'))
  }

  private enqueueInitialFrame(client: RtspClient): void {
    const codec = this.codec
    if (!codec) return
    const frame = this.latestKeyframe ?? (this.parameterSets.size > 0
      ? { nals: [...this.parameterSets.values()], timestampUs: Date.now() * 1_000 }
      : null)
    if (frame) this.enqueueAccessUnit(client, frame)
  }

  private enqueueAccessUnit(client: RtspClient, accessUnit: EncodedAccessUnit): void {
    const codec = this.codec
    if (!codec || client.socket.destroyed) return
    const packets = packetize(accessUnit.nals, accessUnit.timestampUs, codec, this.nextRtpPacket)
    if (packets.length === 0) return
    if (client.queue.length >= CLIENT_QUEUE_CAPACITY) client.queue.shift()
    client.queue.push(packets)
    void this.flushClient(client)
  }

  private async flushClient(client: RtspClient): Promise<void> {
    if (client.flushing) return
    client.flushing = true
    try {
      while (client.playing && !client.socket.destroyed && client.queue.length > 0) {
        const packets = client.queue.shift()!
        for (const packet of packets) {
          const framed = client.rtpSocket
            ? packet
            : interleavedPacket(packet, client.interleavedChannel)
          if (!client.rtpSocket) {
            if (!client.socket.write(framed)) await waitForDrain(client.socket)
          } else if (client.clientRtpPort) {
            client.rtpSocket.send(packet, client.clientRtpPort, client.clientAddress, (error) => {
              if (error) this.logWarn?.('[OBS 推送] RTP UDP 发送失败', { error: error.message })
            })
          }
        }
      }
    } finally {
      client.flushing = false
      if (client.playing && client.queue.length > 0 && !client.socket.destroyed) void this.flushClient(client)
    }
  }

  private nextRtpPacket = (payload: Buffer, timestamp: number, marker: boolean): Buffer => {
    const packet = Buffer.alloc(12 + payload.length)
    packet[0] = 0x80
    packet[1] = RTP_PAYLOAD_TYPE | (marker ? 0x80 : 0)
    packet.writeUInt16BE(this.sequence, 2)
    packet.writeUInt32BE(timestamp >>> 0, 4)
    packet.writeUInt32BE(this.ssrc, 8)
    payload.copy(packet, 12)
    this.sequence = (this.sequence + 1) & 0xffff
    return packet
  }

  private sdp(): string {
    const codec = this.codec ?? 'h264'
    const parameterSets = codec === 'h265' ? [32, 33, 34] : [7, 8]
    const lines = [
      'v=0',
      'o=- 0 0 IN IP4 0.0.0.0',
      's=Luna Camera',
      't=0 0',
      'a=range:npt=0-',
      'a=control:*',
      `m=video 0 RTP/AVP ${RTP_PAYLOAD_TYPE}`,
      'c=IN IP4 0.0.0.0',
    ]
    if (codec === 'h265') {
      lines.push(`a=rtpmap:${RTP_PAYLOAD_TYPE} H265/${RTP_CLOCK_RATE}`)
      const [vps, sps, pps] = parameterSets.map((type) => this.parameterSets.get(type))
      lines.push(`a=fmtp:${RTP_PAYLOAD_TYPE}${vps ? ` sprop-vps=${vps.toString('base64')}` : ''}${sps ? `;sprop-sps=${sps.toString('base64')}` : ''}${pps ? `;sprop-pps=${pps.toString('base64')}` : ''}`)
    } else {
      lines.push(`a=rtpmap:${RTP_PAYLOAD_TYPE} H264/${RTP_CLOCK_RATE}`)
      const sps = this.parameterSets.get(7)
      const pps = this.parameterSets.get(8)
      const profile = sps && sps.length >= 4 ? sps.subarray(1, 4).toString('hex').toUpperCase() : '42E01F'
      const sprop = sps && pps ? `;sprop-parameter-sets=${sps.toString('base64')},${pps.toString('base64')}` : ''
      lines.push(`a=fmtp:${RTP_PAYLOAD_TYPE} packetization-mode=1;profile-level-id=${profile}${sprop}`)
    }
    lines.push('a=framerate:30', 'a=control:trackID=0', '')
    return lines.join('\r\n')
  }

  private closeUdpTransport(client: RtspClient): void {
    client.rtpSocket?.close()
    client.rtcpSocket?.close()
    client.rtpSocket = null
    client.rtcpSocket = null
    client.clientRtpPort = null
    if (client.transport === 'udp') client.transport = null
  }

  private disposeClient(client: RtspClient): void {
    if (!this.clients.delete(client)) return
    client.playing = false
    client.queue.length = 0
    this.closeUdpTransport(client)
    if (!client.socket.destroyed) client.socket.destroy()
  }
}

function parseHeaders(text: string): RtspRequest {
  const lines = text.split('\r\n')
  const [method = '', url = ''] = (lines[0] ?? '').split(' ')
  const headers = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
  }
  return { method: method.toUpperCase(), url, headers }
}

function normalizeAddress(address: string | undefined): string {
  if (!address || address === '::1') return '127.0.0.1'
  return address.replace(/^::ffff:/, '')
}

function bindUdpSocket(socket: DgramSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      socket.off('error', onError)
      resolve()
    }
    socket.once('error', onError)
    socket.once('listening', onListening)
    socket.bind(0, '127.0.0.1')
  })
}

function splitNalUnits(payload: Buffer): Buffer[] {
  const starts: Array<{ index: number; length: number }> = []
  for (let index = 0; index + 2 < payload.length; index += 1) {
    if (payload[index] !== 0 || payload[index + 1] !== 0) continue
    if (payload[index + 2] === 1) {
      starts.push({ index, length: 3 })
      index += 2
    } else if (index + 3 < payload.length && payload[index + 2] === 0 && payload[index + 3] === 1) {
      starts.push({ index, length: 4 })
      index += 3
    }
  }
  if (starts.length === 0) return [payload]
  return starts.map(({ index, length }, itemIndex) => {
    const end = starts[itemIndex + 1]?.index ?? payload.length
    return payload.subarray(index + length, end)
  })
}

function nalType(nal: Buffer, codec: ObsInputCodec): number {
  if (nal.length === 0) return -1
  return codec === 'h265' ? (nal[0]! >> 1) & 0x3f : nal[0]! & 0x1f
}

function isParameterSet(nal: Buffer, codec: ObsInputCodec): boolean {
  const type = nalType(nal, codec)
  return codec === 'h265' ? type >= 32 && type <= 34 : type === 7 || type === 8
}

function isKeyframe(nal: Buffer, codec: ObsInputCodec): boolean {
  const type = nalType(nal, codec)
  return codec === 'h265' ? type >= 19 && type <= 21 : type === 5
}

function packetize(
  nals: Buffer[],
  timestampUs: number,
  codec: ObsInputCodec,
  makePacket: (payload: Buffer, timestamp: number, marker: boolean) => Buffer,
): Buffer[] {
  const timestamp = Math.floor((timestampUs * RTP_CLOCK_RATE) / 1_000_000) >>> 0
  const packets: Buffer[] = []
  nals.forEach((nal, nalIndex) => {
    const lastNal = nalIndex === nals.length - 1
    if (nal.length <= RTP_MTU_PAYLOAD) {
      packets.push(makePacket(nal, timestamp, lastNal))
      return
    }
    if (codec === 'h265') {
      const fragmentSize = RTP_MTU_PAYLOAD - 3
      const fuIndicator = Buffer.from([(nal[0]! & 0x81) | (49 << 1), nal[1]!])
      const type = (nal[0]! >> 1) & 0x3f
      for (let offset = 2; offset < nal.length; offset += fragmentSize) {
        const end = Math.min(offset + fragmentSize, nal.length)
        const payload = Buffer.alloc(3 + end - offset)
        fuIndicator.copy(payload)
        payload[2] = type | (offset === 2 ? 0x80 : 0) | (end === nal.length ? 0x40 : 0)
        nal.copy(payload, 3, offset, end)
        packets.push(makePacket(payload, timestamp, end === nal.length && lastNal))
      }
      return
    }
    const fragmentSize = RTP_MTU_PAYLOAD - 2
    const fuIndicator = (nal[0]! & 0xe0) | 28
    const type = nal[0]! & 0x1f
    for (let offset = 1; offset < nal.length; offset += fragmentSize) {
      const end = Math.min(offset + fragmentSize, nal.length)
      const payload = Buffer.alloc(2 + end - offset)
      payload[0] = fuIndicator
      payload[1] = type | (offset === 1 ? 0x80 : 0) | (end === nal.length ? 0x40 : 0)
      nal.copy(payload, 2, offset, end)
      packets.push(makePacket(payload, timestamp, end === nal.length && lastNal))
    }
  })
  return packets
}

function interleavedPacket(packet: Buffer, channel: number): Buffer {
  const frame = Buffer.alloc(packet.length + 4)
  frame[0] = 0x24
  frame[1] = channel
  frame.writeUInt16BE(packet.length, 2)
  packet.copy(frame, 4)
  return frame
}

function waitForDrain(socket: Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve()
  return new Promise((resolve) => {
    socket.once('drain', resolve)
    socket.once('close', resolve)
  })
}
