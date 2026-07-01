/**
 * Go Ultra 通信协议
 *
 * 与 Luna 协议的核心差异：
 *   1. TCP 连接建立后保持长连接（而非 send-and-drain）
 *   2. 通过 UCD2(MSG=3) 消息通道收发 Wire Protobuf 指令
 *   3. 需要完整的授权流程（CHECK_AUTHORIZATION → REQUEST_AUTHORIZATION）
 *   4. 授权需要用户在相机屏幕上确认（camera_inside_confirm）
 *
 * 协议栈：
 *   HTTP 文件服务 ──── port 80 (授权后才可用)
 *   TCP 控制通道 ──── port 6666 (UCD2 包)
 *     ├── STREAM/HEARTBEAT — 基础认证 / 保活
 *     ├── MSG             — 指令请求-响应（Wire Protobuf 信封）
 *     └── FILE            — 数据推送
 *
 * 参考:
 *   lunaProtocol.ts - Luna 协议基础（UCD2 认证包复用）
 *   mn1.java - OneDriverImpl 消息路由
 *   ws.java - 密钥交换 / 会话管理
 */
import * as net from 'node:net'

import goUltraConfig from './deviceConfigs/go-ultra.json'
import { logMainDebug, logMainInfo, logMainWarn, logMainError } from './loggerService'
import type { ConnectionStatus, DeviceDefinition, LunaFile } from '../src/shared/types'

// ============================================================
// 配置
// ============================================================

const DEVICE_CFG = goUltraConfig as DeviceDefinition
export const DEFAULT_HOST = DEVICE_CFG.defaultHost
export const DEFAULT_PORT = DEVICE_CFG.controlPort
export const STORAGE_PATH = DEVICE_CFG.storages.find((s) => s.default)?.path ?? '/DCIM/'

// ============================================================
// MessageCode 枚举（Go Ultra 相关命令）
// ============================================================

const enum MessageCode {
  // === 授权 ===
  CHECK_AUTHORIZATION = 39,
  CANCEL_AUTHORIZATION = 40,
  REQUEST_AUTHORIZATION = 86,
  CANCEL_REQUEST_AUTHORIZATION = 87,

  // === 文件 ===
  GET_FILE_LIST = 13,
  GET_DOWNLOAD_FILE_LIST = 172,

  // === 系统 ===
  GET_FIRMWARE_VERSIONS = 242,
  GET_STORAGE = 166,
  PHONE_INFO = 220,
  APP_PAGE = 186,
  REGISTER_MESSAGE = 20503,

  // === 加密 ===
  ENCRYPT_CAPABILITY_QUERY = 240,
  ENCRYPT_KEY_EXCHANGE = 241,
}

// ============================================================
// UCD2 协议层 — 包构建 & 解析
// ============================================================

const UCD2_MAGIC = Buffer.from([0x55, 0x43, 0x44, 0x32]) // "UCD2"
const UCD2_VERSION = 0x01
const UCD2_FLAGS = 0x0C

/** UCD2 包类型 */
const enum UcdType {
  DUMMY = 0,
  FIRST = 1,
  HEARTBEAT = 2,
  MSG = 3,
  FILE = 4,
  STREAM = 5,
  SYNC = 6,
  TUNNEL = 7,
  BTMSG = 8,
  LINUXCMD = 9,
  LOGFILE = 10,
  EVENTTRACK_FILE = 11,
}

/** 构建 UCD2 数据包 */
function buildUcd2(type: number, seq: number, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  UCD2_MAGIC.copy(header, 0)
  header[4] = UCD2_VERSION
  header[5] = UCD2_FLAGS
  header[6] = type
  header[7] = seq & 0xFF
  return Buffer.concat([header, data])
}

/** 解析 UCD2 包（从 buffer 开头提取一包） */
interface ParsedUcd2 {
  type: number
  seq: number
  data: Buffer
  packetLen: number // 完整包长度
}

function parseUcd2(buf: Buffer): ParsedUcd2 | null {
  if (buf.length < 8) return null
  if (buf[0] !== 0x55 || buf[1] !== 0x43 || buf[2] !== 0x44 || buf[3] !== 0x32) return null

  const type = buf[6]
  const seq = buf[7]
  const headerLen = 8

  // 根据类型确定数据长度
  let dataLen = buf.length - headerLen
  if (type === UcdType.FILE && buf.length >= headerLen + 4) {
    // FILE 类型: 4B length prefix + data + [trailer(data末尾)]
    const protoLen = buf.readUInt32LE(headerLen)
    dataLen = 4 + protoLen
    // 可能有 trailer，但不确定长度，先取完全部剩余
    const remaining = buf.length - headerLen
    if (remaining < dataLen) return null // 数据不足
    // 保留 trailer
    dataLen = remaining
  }

  const packetLen = headerLen + dataLen
  const data = Buffer.from(buf.subarray(headerLen, headerLen + dataLen))
  return { type, seq, data, packetLen }
}

// ============================================================
// Wire Protobuf 手动编解码
// ============================================================

function wireVarint(value: number): Buffer {
  const result: number[] = []
  let v = value >>> 0
  while (v > 0x7F) {
    result.push((v & 0x7F) | 0x80)
    v >>>= 7
  }
  result.push(v & 0x7F)
  return Buffer.from(result)
}

function wireTag(fieldNum: number, wireType: number): Buffer {
  return wireVarint((fieldNum << 3) | wireType)
}

function wireVarintField(field: number, value: number): Buffer {
  return Buffer.concat([wireTag(field, 0), wireVarint(value)])
}

function wireBytesField(field: number, data: Buffer): Buffer {
  return Buffer.concat([wireTag(field, 2), wireVarint(data.length), data])
}

/**
 * 构建 Message 信封
 * message Message {
 *   int64 requestId = 1;
 *   int32 messageCode = 2;
 *   bytes data = 3;
 * }
 */
function buildMessageEnvelope(messageCode: number, data: Buffer, requestId: number = 0): Buffer {
  return Buffer.concat([
    wireVarintField(1, requestId),
    wireVarintField(2, messageCode),
    wireBytesField(3, data),
  ])
}

/** 解析 Message 信封 → { requestId, messageCode, data } */
interface ParsedMessage {
  requestId: number
  messageCode: number
  data: Buffer
}

function parseVarint(buf: Buffer, offset: number): { value: number; newOffset: number } {
  let value = 0
  let shift = 0
  while (offset < buf.length) {
    const byte = buf[offset++]
    value |= (byte & 0x7F) << shift
    shift += 7
    if (!(byte & 0x80)) break
  }
  return { value, newOffset: offset }
}

function parseMessageEnvelope(data: Buffer): ParsedMessage | null {
  let offset = 0
  let requestId = 0
  let messageCode = 0
  let messageData = Buffer.alloc(0)

  while (offset < data.length) {
    const { value: tag, newOffset: o1 } = parseVarint(data, offset)
    offset = o1
    const fieldNum = tag >> 3
    const wireType = tag & 0x07

    if (wireType === 0) {
      const { value, newOffset } = parseVarint(data, offset)
      offset = newOffset
      if (fieldNum === 1) requestId = value
      else if (fieldNum === 2) messageCode = value
    } else if (wireType === 2) {
      const { value: len, newOffset } = parseVarint(data, offset)
      offset = newOffset
      const chunk = data.subarray(offset, offset + len)
      offset += len
      if (fieldNum === 3) messageData = Buffer.from(chunk)
    } else {
      break
    }
  }

  return { requestId, messageCode, data: messageData }
}

// ============================================================
// 基础认证包（与 Luna 协议相同）
// ============================================================

const AUTH_PACKETS: Buffer[] = [
  // 包1: STREAM, seq=15 — Hello 包
  Buffer.from([
    0x55, 0x43, 0x44, 0x32, 0x01, 0x0c, 0x05, 0x0f,
    0x00, 0x00, 0x00, 0x00, 0x37, 0x05, 0x47, 0x7c,
  ]),
  // 包2: FILE, seq=16 — 认证数据
  Buffer.from([
    0x55, 0x43, 0x44, 0x32, 0x01, 0x0c, 0x04, 0x10,
    0x0f, 0x00, 0x00, 0x00, 0x08, 0x00, 0x02, 0x01,
    0x00, 0x00, 0x80, 0x00, 0x00, 0x08, 0x30, 0x08,
    0x0f, 0x08, 0x0b, 0x7c, 0x00, 0x8e, 0x7c,
  ]),
]

// ============================================================
// GoUltraAuthSession — TCP 长连接 + 消息路由
// ============================================================

type MessageCallback = (msg: ParsedMessage) => void
type NotificationHandler = (msg: ParsedMessage) => void
type PacketHandler = (pkt: ParsedUcd2) => void

export class GoUltraAuthSession {
  private socket: net.Socket | null = null
  private seq = 0 // UCD2 序列号
  private requestIdCounter = 0
  private readonly pending = new Map<number, MessageCallback>()
  private readonly notificationHandlers = new Map<number, NotificationHandler>()
  private readonly packetHandlers = new Map<number, PacketHandler>()
  private receiveBuffer = Buffer.alloc(0)
  /** 是否已通过 Go Ultra 授权 */
  authorized = false
  /** 授权状态变更回调 */
  onAuthorizedChanged: ((authorized: boolean) => void) | null = null
  /** 连接断开回调 */
  onDisconnected: (() => void) | null = null
  /** 收到通知时的通用回调 */
  onNotification: ((msg: ParsedMessage) => void) | null = null

  private readonly host: string
  private readonly port: number

  constructor(host: string = DEFAULT_HOST, port: number = DEFAULT_PORT) {
    this.host = host
    this.port = port
  }

  get isOpen(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  get isAuthorized(): boolean {
    return this.authorized
  }

  /** 注册通知处理器（messageCode → handler） */
  onNotificationCode(code: number, handler: NotificationHandler): void {
    this.notificationHandlers.set(code, handler)
  }

  /** 注册 UCD2 包处理器（type → handler） */
  onPacketType(type: number, handler: PacketHandler): void {
    this.packetHandlers.set(type, handler)
  }

  /** 建立 TCP 连接 + 基础 UCD2 认证 */
  async open(): Promise<void> {
    if (this.isOpen) {
      logMainDebug('[GoUltraAuth] 会话已存在，跳过', { host: this.host, port: this.port })
      return
    }

    logMainInfo('[GoUltraAuth] 开始建立控制连接', { host: this.host, port: this.port })
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const socket = await this.connectSocket(this.host, this.port, 3000)
        this.socket = socket
        this.setupSocketListeners(socket)
        await this.sendAuthPackets()
        logMainInfo('[GoUltraAuth] 基础认证完成', { host: this.host, port: this.port, attempt: attempt + 1 })
        return
      } catch (error) {
        lastError = error
        this.close()
        logMainWarn('[GoUltraAuth] 连接尝试失败', { host: this.host, port: this.port, attempt: attempt + 1, error: String(error) })
        await this.delay(200)
      }
    }

    const errMsg = lastError instanceof Error ? lastError.message : '无法打开 Go Ultra 控制会话'
    logMainError('[GoUltraAuth] 连接最终失败', { host: this.host, port: this.port, error: errMsg })
    throw new Error(errMsg)
  }

  /** 关闭连接 */
  close(): void {
    this.socket?.destroy()
    this.socket = null
    this.authorized = false
    this.pending.clear()
    this.receiveBuffer = Buffer.alloc(0)
  }

  /** 发送 MSG 命令并等待响应 */
  sendCommand(messageCode: number, data: Buffer, timeoutMs: number = 8000): Promise<ParsedMessage> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Go Ultra 控制会话未打开'))
        return
      }

      const requestId = ++this.requestIdCounter
      const seq = ++this.seq
      const envelope = buildMessageEnvelope(messageCode, data, requestId)
      const packet = buildUcd2(UcdType.MSG, seq, envelope)

      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`命令超时: messageCode=${messageCode}, requestId=${requestId}`))
      }, timeoutMs)

      this.pending.set(requestId, (response) => {
        clearTimeout(timer)
        resolve(response)
      })

      logMainDebug('[GoUltraAuth] 发送命令', { messageCode, requestId, seq, dataLen: data.length })
      this.socket.write(packet)
    })
  }

  /** 发送通知类消息（不需要响应） */
  sendNotify(messageCode: number, data: Buffer): void {
    if (!this.socket) {
      logMainError('[GoUltraAuth] 发送通知失败：会话未打开', { messageCode })
      return
    }

    const requestId = 0 // 通知消息 requestId = 0
    const seq = ++this.seq
    const envelope = buildMessageEnvelope(messageCode, data, requestId)
    const packet = buildUcd2(UcdType.MSG, seq, envelope)

    logMainDebug('[GoUltraAuth] 发送通知', { messageCode, seq, dataLen: data.length })
    this.socket.write(packet)
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private connectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port })
      let settled = false

      const finish = (err?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(connTimer)
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

      socket.once('connect', () => finish())
      socket.once('error', (err) => finish(err))
    })
  }

  private setupSocketListeners(socket: net.Socket): void {
    socket.on('data', (chunk: Buffer) => {
      this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk])
      this.processBuffer()
    })

    socket.on('error', (err) => {
      logMainWarn('[GoUltraAuth] Socket 错误', { host: this.host, error: err.message })
    })

    socket.on('close', () => {
      logMainWarn('[GoUltraAuth] Socket 关闭', { host: this.host })
      this.authorized = false
      this.pending.clear()
      this.socket = null
      this.onDisconnected?.()
    })

    socket.on('end', () => {
      logMainDebug('[GoUltraAuth] Socket end', { host: this.host })
    })
  }

  /** 从接收缓冲区解析 UCD2 包 */
  private processBuffer(): void {
    while (this.receiveBuffer.length >= 8) {
      // 查找 UCD2 magic
      const magicIdx = this.receiveBuffer.indexOf(UCD2_MAGIC)
      if (magicIdx < 0) {
        // 没有 magic，丢弃所有数据
        this.receiveBuffer = Buffer.alloc(0)
        break
      }
      if (magicIdx > 0) {
        // 丢弃 magic 前的无效数据
        this.receiveBuffer = this.receiveBuffer.subarray(magicIdx)
      }

      const pkt = parseUcd2(this.receiveBuffer)
      if (!pkt) break // 数据不足，等更多数据

      // 移除已解析的包
      this.receiveBuffer = this.receiveBuffer.subarray(pkt.packetLen)
      this.handlePacket(pkt)
    }
  }

  private handlePacket(pkt: ParsedUcd2): void {
    if (pkt.type === UcdType.MSG) {
      const msg = parseMessageEnvelope(pkt.data)
      if (!msg) {
        logMainDebug('[GoUltraAuth] 无法解析 MSG 消息', { rawHex: pkt.data.subarray(0, 32).toString('hex') })
        return
      }

      if (msg.requestId === 0) {
        // requestId=0 → 相机推送的通知
        logMainDebug('[GoUltraAuth] 收到通知', { messageCode: msg.messageCode, dataLen: msg.data.length })
        const handler = this.notificationHandlers.get(msg.messageCode)
        if (handler) {
          handler(msg)
        }
        this.onNotification?.(msg)
      } else {
        // requestId>0 → 请求的响应
        const callback = this.pending.get(msg.requestId)
        if (callback) {
          this.pending.delete(msg.requestId)
          callback(msg)
        } else {
          logMainDebug('[GoUltraAuth] 收到未知 requestId 的响应', { requestId: msg.requestId, messageCode: msg.messageCode })
        }
      }
    } else {
      // 非 MSG 类型包
      const handler = this.packetHandlers.get(pkt.type)
      handler?.(pkt)
    }
  }

  private async sendAuthPackets(): Promise<void> {
    if (!this.socket) throw new Error('Socket 未打开')

    for (const pkt of AUTH_PACKETS) {
      this.socket.write(pkt)
      await this.delay(30)
    }
    // 等待相机处理认证包（接收可能返回的响应）
    await this.delay(300)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================
// 授权状态
// ============================================================

export const enum AuthState {
  /** 未开始 */
  NONE = 'none',
  /** TCP 基础认证完成，等待授权检查 */
  BASIC_AUTH_DONE = 'basic_auth_done',
  /** 已发送 CHECK_AUTHORIZATION，等待响应 */
  CHECKING = 'checking',
  /** 需要用户在 Go Ultra 上确认 */
  NEED_CAMERA_CONFIRM = 'need_camera_confirm',
  /** 已授权 */
  AUTHORIZED = 'authorized',
  /** 授权失败 */
  FAILED = 'failed',
}

// ============================================================
// GoUltraClient — 高级客户端 API
// ============================================================

export class GoUltraClient {
  private authSession: GoUltraAuthSession | null = null
  private keeperTimer: ReturnType<typeof setInterval> | null = null
  private _authState: AuthState = AuthState.NONE
  private authStateResolve: (() => void) | null = null

  // 授权状态变更事件
  onAuthStateChanged: ((state: AuthState) => void) | null = null
  onConnectionLost: (() => void) | null = null
  /** 等待用户在相机确认时触发 */
  onWaitingForCameraConfirm: (() => void) | null = null
  /** 授权成功时触发 */
  onAuthorized: (() => void) | null = null

  constructor(
    readonly host: string = DEFAULT_HOST,
    private readonly port: number = DEFAULT_PORT,
  ) {}

  get authState(): AuthState {
    return this._authState
  }

  /** 连接 + 基础认证 + 授权流程 */
  async connect(): Promise<void> {
    logMainInfo('[GoUltraClient] 开始连接', { host: this.host })

    if (!this.authSession) {
      this.authSession = new GoUltraAuthSession(this.host, this.port)
      this.setupSessionCallbacks()
    }

    // 步骤1：TCP + 基础 UCD2 认证
    await this.authSession.open()
    this.setState(AuthState.BASIC_AUTH_DONE)

    // 步骤2：检查授权状态
    await this.performAuthorization()
  }

  /** 执行授权流程 */
  private async performAuthorization(): Promise<void> {
    if (!this.authSession) return

    this.setState(AuthState.CHECKING)
    try {
      // 发送 CHECK_AUTHORIZATION — 检查是否已授权
      const checkResp = await this.authSession.sendCommand(MessageCode.CHECK_AUTHORIZATION, Buffer.alloc(0))
      logMainDebug('[GoUltraClient] CHECK_AUTHORIZATION 响应', {
        messageCode: checkResp.messageCode,
        dataHex: checkResp.data.subarray(0, 32).toString('hex'),
      })

      if (checkResp.messageCode === 0 || checkResp.data.length > 0) {
        // 响应数据可能包含授权状态
        // 尝试解析：field 1 可能是 bool/int 表示状态
        const rawHex = checkResp.data.toString('hex')
        // 如果响应是 0x08 0x01 → field 1 varint = 1 (已授权)
        // 如果响应是 0x08 0x00 → field 1 varint = 0 (未授权)
        if (rawHex === '0801' || rawHex === '08 01') {
          logMainInfo('[GoUltraClient] 相机已授权此设备', { host: this.host })
          this.setAuthorized(true)
          return
        } else if (rawHex === '0800' || rawHex === '08 00') {
          logMainInfo('[GoUltraClient] 相机未授权，请求授权', { host: this.host })
          await this.requestAuthorization()
        } else {
          // 未知响应格式，尝试发送授权请求
          logMainWarn('[GoUltraClient] CHECK_AUTHORIZATION 未知响应格式', { rawHex })
          await this.requestAuthorization()
        }
      } else {
        await this.requestAuthorization()
      }
    } catch (error) {
      logMainError('[GoUltraClient] 授权检查失败', { host: this.host, error: String(error) })
      this.setState(AuthState.FAILED)
      throw error
    }
  }

  /** 请求授权（触发相机屏幕弹窗） */
  private async requestAuthorization(): Promise<void> {
    if (!this.authSession) return

    this.setState(AuthState.NEED_CAMERA_CONFIRM)
    logMainInfo('[GoUltraClient] 发送授权请求，请在 Go Ultra 屏幕上确认', { host: this.host })
    this.onWaitingForCameraConfirm?.()

    try {
      // 先发送 PHONE_INFO，让相机知道是哪个设备
      this.authSession.sendNotify(MessageCode.PHONE_INFO, Buffer.alloc(0))

      // 发送 REQUEST_AUTHORIZATION 触发相机弹窗
      const authResp = await this.authSession.sendCommand(MessageCode.REQUEST_AUTHORIZATION, Buffer.alloc(0), 60000)
      logMainDebug('[GoUltraClient] REQUEST_AUTHORIZATION 响应', {
        messageCode: authResp.messageCode,
        dataHex: authResp.data.subarray(0, 32).toString('hex'),
      })

      // 部分相机可能在响应中直接返回授权结果
      if (authResp.messageCode === 0) {
        // 检查响应数据
        const rawHex = authResp.data.toString('hex')
        if (rawHex === '0801' || rawHex === '08 01') {
          this.setAuthorized(true)
          return
        }
      }

      // 如果没直接返回，等待 AUTHORIZATION_RESULT 通知（已在 setupSessionCallbacks 中监听）
      // 等待用户确认最长 55 秒（扣除已消耗的时间）
      logMainInfo('[GoUltraClient] 等待用户在 Go Ultra 上确认授权...', { host: this.host })
    } catch (error) {
      logMainError('[GoUltraClient] 授权请求失败', { host: this.host, error: String(error) })
      this.setState(AuthState.FAILED)
      throw error
    }
  }

  /** 设置授权状态 */
  private setAuthorized(val: boolean): void {
    if (this.authSession) {
      this.authSession.authorized = val
    }
    this.setState(val ? AuthState.AUTHORIZED : AuthState.NONE)
    if (val) {
      this.onAuthorized?.()
    }
  }

  private setState(state: AuthState): void {
    this._authState = state
    this.authStateResolve?.()
    this.authStateResolve = null
    this.onAuthStateChanged?.(state)
  }

  private setupSessionCallbacks(): void {
    if (!this.authSession) return

    // 监听 AUTHORIZATION_RESULT (8209) 通知
    this.authSession.onNotificationCode(8209, (msg) => {
      logMainInfo('[GoUltraClient] 收到授权结果通知', { dataHex: msg.data.subarray(0, 32).toString('hex') })
      // 解析通知数据: 通常 field 1 = 授权结果 (0=拒绝, 1=同意)
      const rawHex = msg.data.toString('hex')
      if (rawHex === '0801' || rawHex === '08 01') {
        this.setAuthorized(true)
      } else if (rawHex === '0800' || rawHex === '08 00') {
        logMainWarn('[GoUltraClient] 用户在相机上拒绝了授权', { host: this.host })
        this.setState(AuthState.FAILED)
      }
    })

    // 监听 CHECK_AUTHORIZATION_RESULT (8228) 通知
    this.authSession.onNotificationCode(8228, (msg) => {
      logMainDebug('[GoUltraClient] 收到检查授权结果通知', { dataHex: msg.data.subarray(0, 32).toString('hex') })
    })

    // 监听连接断开
    this.authSession.onDisconnected = () => {
      logMainWarn('[GoUltraClient] 连接断开', { host: this.host })
      this._authState = AuthState.NONE
      this.onConnectionLost?.()
    }

    // 通用通知处理器（日志）
    this.authSession.onNotification = (msg) => {
      if (msg.messageCode !== 8209 && msg.messageCode !== 8228) {
        logMainDebug('[GoUltraClient] 收到通知', { messageCode: msg.messageCode, dataLen: msg.data.length })
      }
    }
  }

  /** 获取授权状态（返回 Promise，授权完成后 resolve） */
  waitForAuthorization(timeoutMs: number = 60000): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this._authState === AuthState.AUTHORIZED) {
        resolve(true)
        return
      }
      if (this._authState === AuthState.FAILED) {
        resolve(false)
        return
      }

      const timer = setTimeout(() => {
        reject(new Error('等待授权超时'))
      }, timeoutMs)

      this.onAuthStateChanged = (state) => {
        if (state === AuthState.AUTHORIZED) {
          clearTimeout(timer)
          resolve(true)
        } else if (state === AuthState.FAILED) {
          clearTimeout(timer)
          resolve(false)
        }
      }
    })
  }

  /** 检查连接状态（端口探测） */
  async checkStatus(): Promise<ConnectionStatus> {
    let httpOk = false
    let controlOk = false
    let message = '未检测到 Go Ultra'
    let controlError: string | null = null

    try {
      const socket = await this.connectSocketSimple(this.host, 80, 1500)
      socket.destroy()
      httpOk = true
    } catch {
      // http 不可用
    }

    if (this.authSession?.isOpen) {
      controlOk = true
    } else {
      try {
        const socket = await this.connectSocketSimple(this.host, this.port, 1500)
        socket.destroy()
        controlOk = true
      } catch (error) {
        controlError = String(error)
        if (httpOk) message = `控制端口不可用: ${controlError}`
      }
    }

    if (httpOk && controlOk) message = '已检测到 Go Ultra'
    return { host: this.host, httpOk, controlOk, message }
  }

  /** 授权后 HTTP 文件列表读取 */
  async listFiles(): Promise<LunaFile[]> {
    if (this._authState !== AuthState.AUTHORIZED) {
      throw new Error('尚未授权，请先完成授权流程')
    }

    logMainInfo('[GoUltraClient] 开始读取文件列表', { host: this.host })
    const url = `http://${this.host}${STORAGE_PATH}`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LunaAI-Cut/0.1',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const html = await response.text()
    const files = this.parseIndex(html, url)
    logMainInfo('[GoUltraClient] 文件列表读取完成', { fileCount: files.length })
    return files
  }

  /** 保活 — 保持 TCP 连接活跃 */
  startKeepAlive(intervalMs: number = 10000): void {
    this.stopKeepAlive()
    this.keeperTimer = setInterval(() => {
      if (this.authSession?.isOpen) {
        logMainDebug('[GoUltraClient] 保活：连接正常', { host: this.host })
      } else {
        logMainWarn('[GoUltraClient] 保活：连接已断开', { host: this.host })
        this.stopKeepAlive()
        this.onConnectionLost?.()
      }
    }, intervalMs)
  }

  stopKeepAlive(): void {
    if (this.keeperTimer !== null) {
      clearInterval(this.keeperTimer)
      this.keeperTimer = null
    }
  }

  close(): void {
    logMainInfo('[GoUltraClient] 关闭连接', { host: this.host })
    this.stopKeepAlive()
    this.authSession?.close()
    this.authSession = null
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  private connectSocketSimple(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port })
      let settled = false
      const timer = setTimeout(() => {
        settled = true
        socket.destroy()
        reject(new Error(`连接 ${host}:${port} 超时`))
      }, timeoutMs)
      socket.once('connect', () => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve(socket)
        }
      })
      socket.once('error', (err) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(err)
        }
      })
    })
  }

  /** 解析 Apache 目录列表 HTML */
  private parseIndex(html: string, baseUrl: string): LunaFile[] {
    const regex = /<a href="(?<href>[^"]+)">(?<name>[^<]+)<\/a>\s+(?:\S+)\s+(?:\S+)\s+(?:\S+)/gi
    const files: LunaFile[] = []
    let match: RegExpExecArray | null

    while ((match = regex.exec(html)) !== null) {
      const href = match.groups?.href ?? ''
      const name = match.groups?.name ?? ''
      if (href === '../' || name === '../') continue
      if (href.endsWith('/')) continue

      const url = new URL(href, baseUrl).toString()
      files.push({
        id: name,
        name,
        href,
        sourceUrl: url,
        url,
        dateText: '',
        timeText: '',
        sizeText: '',
        bytes: null,
        kind: 'unknown',
        extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '',
        capturedAt: null,
        groupDay: '',
        groupHour: '',
        videoKey: null,
        previewName: null,
        previewUrl: null,
        cacheFilePath: null,
        downloadFilePath: null,
        thumbnailUrl: null,
        isLivePhoto: false,
        livePhotoVideoName: null,
        livePhotoVideoUrl: null,
        livePhotoCacheFilePath: null,
        downloadName: name,
        canPreview: false,
      })
    }
    return files
  }
}

// ============================================================
// 便捷函数
// ============================================================

export function createGoUltraClient(host?: string, port?: number): GoUltraClient {
  return new GoUltraClient(host ?? DEFAULT_HOST, port ?? DEFAULT_PORT)
}
