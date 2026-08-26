import * as net from 'node:net'
import * as os from 'node:os'

import { logMainDebug, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { deleteCameraPaths } from './insta360CameraDelete'
import {
  buildFileCommand,
  buildStreamHello,
  inspectFrameChecksum,
  MEDIA_VIDEO,
  parseMediaFrame,
  parseRawResponse,
  UCD2_FILE,
  UCD2_MEDIA,
  UCD2_MAGIC,
  UCD2_STREAM,
} from './insta360TcpCodec'
import type { Insta360RawResponse } from './insta360TcpCodec'
import {
  FILE_LIST_MAX_OFFSET,
  FILE_LIST_PAGE_SIZE,
  fileListBody,
  parseInsta360FilePaths,
} from './insta360TcpFileList'

export { insta360PacketChecksum } from './insta360TcpCodec'
export type { Insta360RawResponse } from './insta360TcpCodec'

export type Insta360VideoFrameListener = (data: Buffer) => void

const CODE_GET_FILE_LIST = 13
const STATUS_OK = 200
const MEDIA_TYPE_ALL = 2
const CARD_LOCATION_INTERNAL = 2
const CARD_LOCATION_SD = 3

interface ExactCommand {
  label: string
  code: number
  requestId: number
  packet: Buffer
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

/**
 * 查找与目标主机在同一子网的本地 IPv4 地址。
 * 用于多网卡场景（如同时连了普通 WiFi 和 Luna 相机网络），
 * 强制 socket 绑定到正确接口，绕过 macOS 服务顺序导致的路由问题。
 * 返回 null 表示无需绑定（目标非 IPv4 地址或未找到匹配接口）。
 */
function resolveLocalAddress(targetHost: string): string | null {
  const parts = targetHost.split('.')
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null

  const ip4toInt = (ip: string): number =>
    ip.split('.').reduce((acc, oct) => ((acc << 8) | parseInt(oct, 10)) >>> 0, 0)

  const target = ip4toInt(targetHost)
  for (const addrs of Object.values(os.networkInterfaces())) {
    if (!addrs) continue
    for (const a of addrs) {
      if (a.internal || a.family !== 'IPv4' || !a.netmask) continue
      if ((target & ip4toInt(a.netmask)) === (ip4toInt(a.address) & ip4toInt(a.netmask))) {
        return a.address
      }
    }
  }
  return null
}

export function connectSocket(host: string, port: number, timeoutMs: number, localAddress?: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const addr = localAddress ?? resolveLocalAddress(host)
    logMainDebug('[Insta360TCP] 开始建立 socket', { host, port, timeoutMs, requestedLocalAddress: localAddress, resolvedLocalAddress: addr })
    const socket = net.createConnection(addr ? { host, port, localAddress: addr } : { host, port })
    let settled = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(connTimer)
      clearTimeout(fallbackTimer)
      if (err) {
        logMainWarn('[Insta360TCP] socket 建立失败', { host, port, elapsedMs: Date.now() - startedAt, error: err.message })
        socket.destroy()
        reject(err)
      } else {
        logMainInfo('[Insta360TCP] socket 已连接', {
          host,
          port,
          elapsedMs: Date.now() - startedAt,
          localAddress: socket.localAddress,
          localPort: socket.localPort,
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort,
        })
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

function builtCommand(label: string, seq: number, code: number, requestId: number, body: Buffer): ExactCommand {
  return {
    label,
    code,
    requestId,
    packet: buildFileCommand(seq, code, requestId, body),
  }
}

const EXACT_FILE_LIST_INTERNAL: ExactCommand[] = [
  builtCommand(
    'GET_FILE_LIST internal offset=0',
    0x2c,
    CODE_GET_FILE_LIST,
    8,
    fileListBody(MEDIA_TYPE_ALL, 0, FILE_LIST_PAGE_SIZE, CARD_LOCATION_INTERNAL),
  ),
  builtCommand(
    'GET_FILE_LIST internal offset=50',
    0x2d,
    CODE_GET_FILE_LIST,
    9,
    fileListBody(MEDIA_TYPE_ALL, 50, FILE_LIST_PAGE_SIZE, CARD_LOCATION_INTERNAL),
  ),
  builtCommand(
    'GET_FILE_LIST internal offset=100',
    0x2e,
    CODE_GET_FILE_LIST,
    10,
    fileListBody(MEDIA_TYPE_ALL, 100, FILE_LIST_PAGE_SIZE, CARD_LOCATION_INTERNAL),
  ),
]

const EXACT_FILE_LIST_SDCARD: ExactCommand[] = [
  builtCommand(
    'GET_FILE_LIST sdcard offset=0',
    0x2f,
    CODE_GET_FILE_LIST,
    11,
    fileListBody(MEDIA_TYPE_ALL, 0, FILE_LIST_PAGE_SIZE, CARD_LOCATION_SD),
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
    code: number
    label?: string
    startedAt: number
  }>()
  private readonly videoListeners = new Set<Insta360VideoFrameListener>()
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  get isOpen(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  async open(): Promise<void> {
    if (this.isOpen) return
    const startedAt = Date.now()
    logMainInfo('[Insta360TCP] 开始建立控制会话', { host: this.host, port: this.port })
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

    const helloSeq = this.nextSeq()
    socket.write(buildStreamHello(helloSeq))
    logMainInfo('[Insta360TCP] STREAM 握手已发送', { host: this.host, port: this.port, seq: helloSeq })
    // 连接只需要完成 STREAM 握手。设备信息/字符串查询不是建立媒体连接的必要条件，
    // 也避免在密码未知时额外请求相机配置。
    this.requestId = Math.max(this.requestId, 12)
    logMainInfo('[Insta360TCP] 控制会话已建立', {
      host: this.host,
      port: this.port,
      elapsedMs: Date.now() - startedAt,
    })
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
    this.rejectAll()
  }

  subscribeVideo(listener: Insta360VideoFrameListener): () => void {
    this.videoListeners.add(listener)
    return () => this.videoListeners.delete(listener)
  }

  async refresh(): Promise<void> {
    if (!this.isOpen) {
      await this.open()
      return
    }
    const seq = this.nextSeq()
    this.socket?.write(buildStreamHello(seq))
    logMainDebug('[Insta360TCP] STREAM 保活已发送', { seq })
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
      const startedAt = Date.now()
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        logMainWarn('[Insta360TCP] 命令响应超时', { code, requestId, label, bodyBytes, packetBytes: packet.length, timeoutMs })
        reject(new Error(`TCP 命令 ${code} 请求 ${requestId} 超时`))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer, code, label, startedAt })
      this.socket?.write(packet)
      logMainDebug('[Insta360TCP] 发送命令', { code, requestId, bodyBytes, packetBytes: packet.length, timeoutMs, label, startedAt })
    })
  }

  async listFilePaths(storagePath: string): Promise<string[]> {
    const cardLocation = storagePath.includes('sdcard') || storagePath === '/DCIM/'
      ? CARD_LOCATION_SD
      : CARD_LOCATION_INTERNAL
    const paths = new Set<string>()
    const exactCommands = cardLocation === CARD_LOCATION_SD ? EXACT_FILE_LIST_SDCARD : EXACT_FILE_LIST_INTERNAL
    let nextOffset = 0
    logMainInfo('[Insta360TCP] 开始读取文件列表', {
      storagePath,
      mediaType: MEDIA_TYPE_ALL,
      cardLocation,
      pageSize: FILE_LIST_PAGE_SIZE,
      maxOffset: FILE_LIST_MAX_OFFSET,
      initialCommandCount: exactCommands.length,
    })
    try {
      for (const [index, command] of exactCommands.entries()) {
        const response = await this.sendExactCommand(command, 8000)
        if (response.code !== STATUS_OK) throw new Error(`TCP 文件列表命令返回 ${response.code}`)
        const pagePaths = parseInsta360FilePaths(response.body)
        for (const path of pagePaths) paths.add(path)
        nextOffset = (index + 1) * FILE_LIST_PAGE_SIZE
        logMainDebug('[Insta360TCP] exact 文件列表分页', { cardLocation, requestId: command.requestId, count: pagePaths.length })
        if (pagePaths.length < FILE_LIST_PAGE_SIZE) {
          logMainInfo('[Insta360TCP] 文件列表读取结束', { cardLocation, reason: 'short-exact-page', offset: index * FILE_LIST_PAGE_SIZE, pageCount: pagePaths.length, totalCount: paths.size })
          return [...paths]
        }
        await delay(20)
      }
    } catch (error) {
      logMainWarn('[Insta360TCP] 固定文件列表命令失败，改用动态分页', {
        cardLocation,
        nextOffset,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    let lastOffset = nextOffset
    let endedWithFullPage = false
    for (let offset = nextOffset; offset <= FILE_LIST_MAX_OFFSET; offset += FILE_LIST_PAGE_SIZE) {
      lastOffset = offset
      const response = await this.sendCommand(
        CODE_GET_FILE_LIST,
        fileListBody(MEDIA_TYPE_ALL, offset, FILE_LIST_PAGE_SIZE, cardLocation),
        6000,
      )
      if (response.code !== STATUS_OK) throw new Error(`TCP 文件列表命令返回 ${response.code}`)
      const pagePaths = parseInsta360FilePaths(response.body)
      for (const path of pagePaths) paths.add(path)
      logMainDebug('[Insta360TCP] 文件列表分页', { cardLocation, offset, count: pagePaths.length })
      endedWithFullPage = pagePaths.length >= FILE_LIST_PAGE_SIZE
      if (!endedWithFullPage) break
      await delay(20)
    }
    const reason = endedWithFullPage && lastOffset === FILE_LIST_MAX_OFFSET ? 'max-offset' : 'short-dynamic-page'
    const log = reason === 'max-offset' ? logMainWarn : logMainInfo
    log('[Insta360TCP] 文件列表读取结束', { cardLocation, reason, offset: lastOffset, totalCount: paths.size })
    return [...paths]
  }

  async deleteFilePaths(cameraPaths: string[]) {
    return deleteCameraPaths({
      host: this.host,
      cameraPaths,
      sendCommand: (code, body, timeoutMs) => this.sendCommand(code, body, timeoutMs),
    })
  }

  private onData(data: Buffer): void {
    logMainDebug('[Insta360TCP] 收到 socket 数据', { chunkBytes: data.length, bufferedBefore: this.buffer.length })
    this.buffer = Buffer.concat([this.buffer, data])
    while (this.buffer.length >= 8) {
      const start = this.buffer.indexOf(UCD2_MAGIC)
      if (start < 0) {
        logMainWarn('[Insta360TCP] 未找到 UCD2 帧头，丢弃数据', { discardedBytes: this.buffer.length })
        this.buffer = Buffer.alloc(0)
        return
      }
      if (start > 0) {
        logMainWarn('[Insta360TCP] 丢弃 UCD2 帧前数据', { discardedBytes: start })
        this.buffer = this.buffer.subarray(start)
      }
      if (this.buffer.length < 8) return
      if (this.buffer.length < 12) return

      const type = this.buffer[6]
      const frameLen = type === UCD2_STREAM || type === UCD2_FILE || type === UCD2_MEDIA
        ? 12 + this.buffer.readUInt32LE(8) + 4
        : 0
      if (frameLen > 8 * 1024 * 1024) {
        logMainWarn('[Insta360TCP] 收到异常大的媒体帧长度', { type, frameLen })
        this.buffer = this.buffer.subarray(8)
        continue
      }
      if (frameLen === 0) {
        logMainWarn('[Insta360TCP] 收到未知帧类型', {
          version: this.buffer[4],
          flags: this.buffer[5],
          type,
          seq: this.buffer[7],
          bufferedBytes: this.buffer.length,
        })
        this.buffer = this.buffer.subarray(8)
        continue
      }
      if (this.buffer.length < frameLen) {
        logMainDebug('[Insta360TCP] 等待完整帧', { type, expectedBytes: frameLen, bufferedBytes: this.buffer.length })
        return
      }

      const frame = this.buffer.subarray(0, frameLen)
      this.buffer = this.buffer.subarray(frameLen)
      if (type === UCD2_MEDIA) {
        const media = parseMediaFrame(frame)
        if (media?.substream === MEDIA_VIDEO && media.data.length > 0) {
          logMainDebug('[Insta360TCP] 收到视频媒体帧', { frameBytes: media.data.length })
          for (const listener of this.videoListeners) listener(media.data)
        }
        continue
      }
      if (type !== UCD2_FILE) {
        logMainDebug('[Insta360TCP] 收到 STREAM 帧', { seq: frame[7], frameBytes: frame.length })
        continue
      }

      const checksum = inspectFrameChecksum(frame)
      if (checksum && !checksum.ok) {
        logMainWarn('[Insta360TCP] 响应帧校验不一致', { seq: frame[7], frameBytes: frame.length, received: checksum.received, calculated: checksum.calculated })
      }

      const response = parseRawResponse(frame.subarray(8))
      if (!response) {
        logMainWarn('[Insta360TCP] 响应帧结构无法解析', { seq: frame[7], frameBytes: frame.length })
        continue
      }
      const pending = this.pending.get(response.requestId)
      if (pending) {
        this.pending.delete(response.requestId)
        clearTimeout(pending.timer)
        logMainDebug('[Insta360TCP] 收到命令响应', {
          code: pending.code,
          responseCode: response.code,
          requestId: response.requestId,
          label: pending.label,
          kind: response.kind,
          flags: response.flags,
          bodyBytes: response.body.length,
          frameBytes: frame.length,
          checksumOk: checksum?.ok ?? null,
          elapsedMs: Date.now() - pending.startedAt,
        })
        pending.resolve(response)
      } else {
        logMainDebug('[Insta360TCP] 未匹配响应/通知', { code: response.code, requestId: response.requestId, kind: response.kind, flags: response.flags, bodyBytes: response.body.length, frameBytes: frame.length, checksumOk: checksum?.ok ?? null })
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
