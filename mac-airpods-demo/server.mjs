import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { existsSync, readFile } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { Insta360TcpSession } = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor/luna-protocol/luna-protocol.cjs'))

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.LUNA_DEMO_PORT || 8787)
const MOTION_BRIDGE_PORT = Number(process.env.LUNA_MOTION_BRIDGE_PORT || 8788)
const DEFAULT_HOST = '192.168.42.1'
const DEFAULT_CAMERA_PORT = 6666
const DEFAULT_PHONE_RELAY_HOST = '127.0.0.1'
const PHONE_RELAY_PORT = 26666
const DEFAULT_TRANSPORT = 'phone-relay'
const DEFAULT_GIMBAL_SPEED = 40
const MOTION_SMOOTHING_TAU_SECONDS = 0.18
const FOLLOW_ENTER_DEAD_ZONE = 0.15
const FOLLOW_EXIT_DEAD_ZONE = 0.08
const FOLLOW_AXIS_SWITCH_MARGIN = 0.18
const MOTION_APP = join(ROOT, '.runtime/HeadphoneMotion.app')
const INDEX_FILE = join(ROOT, 'index.html')

const clients = new Set()
let motionAppOpen = null
let motionBridgeSocket = null
let motionStartTimer = null
let mockTimer = null
let mockStartedAt = 0
let cameraSession = null
let cameraHeartbeat = null
let pulseTimer = null
let pulseInFlight = false
let desiredGimbal = null
let desiredStopTimer = null
let motionFilter = null
let followAxis = null

const state = {
  motion: {
    running: false,
    source: 'none',
    connected: false,
    available: false,
    last: null,
    zero: null,
  },
  camera: {
    connected: false,
    connecting: false,
    transport: DEFAULT_TRANSPORT,
    host: DEFAULT_PHONE_RELAY_HOST,
    port: PHONE_RELAY_PORT,
    info: null,
  },
  follow: {
    enabled: false,
    baseline: null,
  },
  gimbal: {
    speed: DEFAULT_GIMBAL_SPEED,
  },
}

function publicState() {
  return {
    motion: { ...state.motion },
    camera: { ...state.camera },
    follow: {
      enabled: state.follow.enabled,
      baseline: state.follow.baseline,
    },
    gimbal: { ...state.gimbal },
    desiredGimbal,
  }
}

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of clients) {
    try {
      client.write(message)
    } catch {
      clients.delete(client)
    }
  }
}

function log(message, level = 'info') {
  const entry = { at: Date.now(), level, message }
  console.log(`[${level}] ${message}`)
  broadcast('log', entry)
}

function publishState() {
  broadcast('state', publicState())
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function sendError(response, status, message) {
  sendJson(response, status, { ok: false, error: message })
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求数据格式不正确')
  }
}

function encodeVarint(value) {
  let current = BigInt(value)
  const bytes = []
  do {
    let byte = Number(current & 0x7fn)
    current >>= 7n
    if (current !== 0n) byte |= 0x80
    bytes.push(byte)
  } while (current !== 0n)
  return Buffer.from(bytes)
}

function wireVarintField(field, value) {
  return Buffer.concat([encodeVarint(BigInt(field << 3)), encodeVarint(value)])
}

function wireBytesField(field, value) {
  return Buffer.concat([encodeVarint(BigInt((field << 3) | 2)), encodeVarint(value.length), value])
}

function zigzag32(value) {
  const signed = BigInt(value)
  return BigInt.asUintN(32, (signed << 1n) ^ (signed >> 31n))
}

function buildGimbalControl(action, upDown = 0, leftRight = 0) {
  let fields = wireVarintField(1, action)
  if (action === 1) {
    const virtualRc = Buffer.concat([
      upDown === 0 ? Buffer.alloc(0) : wireVarintField(1, zigzag32(upDown)),
      leftRight === 0 ? Buffer.alloc(0) : wireVarintField(2, zigzag32(leftRight)),
    ])
    if (virtualRc.length > 0) fields = Buffer.concat([fields, wireBytesField(2, virtualRc)])
  }
  return fields
}

function directionVector(direction) {
  switch (direction) {
    case 'up': return { upDown: 1, leftRight: 0 }
    case 'down': return { upDown: -1, leftRight: 0 }
    case 'left': return { upDown: 0, leftRight: -1 }
    case 'right': return { upDown: 0, leftRight: 1 }
    default: throw new Error(`不支持的方向：${direction}`)
  }
}

function stopDesired() {
  const hadDesired = Boolean(desiredGimbal)
  desiredGimbal = null
  if (desiredStopTimer) clearTimeout(desiredStopTimer)
  desiredStopTimer = null
  if (hadDesired) publishState()
}

function setDesired(direction, amplitude, durationMs) {
  if (!directionVector(direction)) return
  desiredGimbal = { direction, amplitude, until: Date.now() + durationMs }
  if (desiredStopTimer) clearTimeout(desiredStopTimer)
  desiredStopTimer = setTimeout(() => {
    desiredStopTimer = null
    if (!state.follow.enabled) {
      const hadDesired = Boolean(desiredGimbal)
      stopDesired()
      if (hadDesired) void sendNeutral()
    }
  }, durationMs)
  publishState()
}

async function pulseTick() {
  if (pulseInFlight || !desiredGimbal || !cameraSession?.isOpen) return
  if (desiredGimbal.until <= Date.now()) {
    const hadDesired = Boolean(desiredGimbal)
    stopDesired()
    if (hadDesired) void sendNeutral()
    return
  }
  pulseInFlight = true
  try {
    const vector = directionVector(desiredGimbal.direction)
    await cameraSession.sendCommand(226, buildGimbalControl(1, vector.upDown * desiredGimbal.amplitude, vector.leftRight * desiredGimbal.amplitude), 1_500)
  } catch (error) {
    log(`云台脉冲发送失败：${error instanceof Error ? error.message : String(error)}`, 'warn')
  } finally {
    pulseInFlight = false
  }
}

function ensurePulseTimer() {
  if (pulseTimer) return
  pulseTimer = setInterval(() => { void pulseTick() }, 100)
}

async function sendNeutral() {
  if (!cameraSession?.isOpen) return
  try {
    await cameraSession.sendCommand(226, buildGimbalControl(1), 1_500)
  } catch (error) {
    log(`云台停止发送失败：${error instanceof Error ? error.message : String(error)}`, 'warn')
  }
}

function normalizeAngle(angle) {
  let result = angle
  while (result > Math.PI) result -= Math.PI * 2
  while (result < -Math.PI) result += Math.PI * 2
  return result
}

function smoothValue(previous, current, alpha) {
  if (typeof previous !== 'number' || typeof current !== 'number') return current
  return previous + (current - previous) * alpha
}

function smoothAngle(previous, current, alpha) {
  if (typeof previous !== 'number' || typeof current !== 'number') return current
  return previous + normalizeAngle(current - previous) * alpha
}

function smoothMotion(message) {
  const currentAt = typeof message.at === 'number' ? message.at : Date.now()
  if (!motionFilter || motionFilter.source !== message.source) {
    motionFilter = { ...message, at: currentAt }
    return message
  }

  const elapsedSeconds = Math.max(0.01, Math.min(0.2, (currentAt - motionFilter.at) / 1_000))
  const alpha = 1 - Math.exp(-elapsedSeconds / MOTION_SMOOTHING_TAU_SECONDS)
  const filtered = {
    ...message,
    roll: smoothAngle(motionFilter.roll, message.roll, alpha),
    pitch: smoothAngle(motionFilter.pitch, message.pitch, alpha),
    yaw: smoothAngle(motionFilter.yaw, message.yaw, alpha),
    x: smoothValue(motionFilter.x, message.x, alpha),
    y: smoothValue(motionFilter.y, message.y, alpha),
    z: smoothValue(motionFilter.z, message.z, alpha),
    at: currentAt,
  }
  motionFilter = filtered
  return filtered
}

function resetMotionZero() {
  const current = state.motion.last
  if (!current || typeof current.roll !== 'number' || typeof current.pitch !== 'number' || typeof current.yaw !== 'number') {
    throw new Error('还没有收到姿态数据，暂时不能重置零点')
  }
  state.motion.zero = {
    roll: current.roll,
    pitch: current.pitch,
    yaw: current.yaw,
    at: Date.now(),
  }
  if (state.follow.enabled) {
    state.follow.baseline = { yaw: current.yaw, pitch: current.pitch }
    followAxis = null
    const hadDesired = Boolean(desiredGimbal)
    stopDesired()
    if (hadDesired) void sendNeutral()
  }
  log('已将当前 AirPods 姿态重置为零点')
  publishState()
}

function updateFollow(motion) {
  if (!state.follow.enabled || typeof motion.yaw !== 'number' || typeof motion.pitch !== 'number') return
  if (!state.follow.baseline) {
    state.follow.baseline = { yaw: motion.yaw, pitch: motion.pitch }
  }
  const yawDelta = normalizeAngle(motion.yaw - state.follow.baseline.yaw)
  const pitchDelta = motion.pitch - state.follow.baseline.pitch
  const yawAbs = Math.abs(yawDelta)
  const pitchAbs = Math.abs(pitchDelta)
  const maxDelta = Math.max(yawAbs, pitchAbs)
  const deadZone = followAxis ? FOLLOW_EXIT_DEAD_ZONE : FOLLOW_ENTER_DEAD_ZONE
  if (maxDelta < deadZone) {
    followAxis = null
    const hadDesired = Boolean(desiredGimbal)
    stopDesired()
    if (hadDesired) void sendNeutral()
    return
  }

  if (!followAxis) followAxis = yawAbs >= pitchAbs ? 'yaw' : 'pitch'
  const currentAbs = followAxis === 'yaw' ? yawAbs : pitchAbs
  const otherAbs = followAxis === 'yaw' ? pitchAbs : yawAbs
  if (otherAbs > currentAbs + FOLLOW_AXIS_SWITCH_MARGIN) followAxis = followAxis === 'yaw' ? 'pitch' : 'yaw'
  const delta = followAxis === 'yaw' ? yawDelta : pitchDelta
  const direction = followAxis === 'yaw' ? (delta > 0 ? 'right' : 'left') : (delta > 0 ? 'up' : 'down')
  const amplitude = Math.max(1, Math.min(state.gimbal.speed, Math.round(Math.abs(delta) * 90)))
  desiredGimbal = { direction, amplitude, until: Date.now() + 300 }
  publishState()
}

function normalizeGimbalSpeed(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed) || speed < 1 || speed > 100) throw new Error('云台速度必须在 1-100 之间')
  return Math.round(speed)
}

function processMotion(message) {
  if (message.type === 'motion') {
    const smoothed = smoothMotion(message)
    state.motion.last = smoothed
    state.motion.connected = true
    state.motion.available = true
    broadcast('motion', smoothed)
    updateFollow(smoothed)
  } else if (message.type === 'status') {
    state.motion.connected = Boolean(message.connected)
    state.motion.available = Boolean(message.available)
    state.motion.lastError = message.error || null
    broadcast('motion-status', message)
    publishState()
    if (!state.motion.connected && state.follow.enabled) {
      const hadDesired = Boolean(desiredGimbal)
      stopDesired()
      if (hadDesired) void sendNeutral()
    }
  }
}

const motionBridgeServer = createNetServer((socket) => {
  motionBridgeSocket?.destroy()
  motionBridgeSocket = socket
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { processMotion(JSON.parse(line)) } catch { log('AirPods App 返回了无法解析的数据', 'warn') }
    }
  })
  socket.on('close', () => {
    if (motionBridgeSocket !== socket) return
    motionBridgeSocket = null
    if (state.motion.source === 'airpods') {
      motionFilter = null
      followAxis = null
      state.motion.running = false
      state.motion.source = 'none'
      state.motion.connected = false
      state.motion.available = false
      publishState()
    }
  })
  socket.on('error', (error) => log(`AirPods App 回环连接失败：${error.message}`, 'warn'))
  log('AirPods App 已连接到本地服务')
})

function startAirpods() {
  if (motionBridgeSocket || motionAppOpen || state.motion.running) return
  if (!existsSync(MOTION_APP)) throw new Error('未找到 AirPods App，请先运行 node mac-airpods-demo/build-motion-helper.mjs')
  stopMock()
  const child = spawn('open', ['-g', MOTION_APP, '--args', String(MOTION_BRIDGE_PORT)], { stdio: 'ignore' })
  motionAppOpen = child
  state.motion.running = true
  state.motion.source = 'airpods'
  state.motion.last = null
  state.motion.zero = null
  motionFilter = null
  followAxis = null
  state.motion.lastError = null
  child.once('error', (error) => log(`AirPods helper 启动失败：${error.message}`, 'error'))
  child.once('close', (code) => {
    if (motionAppOpen === child) motionAppOpen = null
    if (code !== 0) log(`AirPods App 启动请求失败（代码 ${code ?? 'unknown'}）`, 'warn')
  })
  motionStartTimer = setTimeout(() => {
    motionStartTimer = null
    if (!motionBridgeSocket && state.motion.source === 'airpods') {
      state.motion.running = false
      state.motion.source = 'none'
      state.motion.lastError = 'AirPods App 没有连接到本地服务，请检查 macOS 运动权限。'
      publishState()
    }
  }, 3_000)
  log('已启动 AirPods 运动采集')
  publishState()
}

function stopAirpods() {
  if (motionStartTimer) clearTimeout(motionStartTimer)
  motionStartTimer = null
  motionBridgeSocket?.end()
  motionBridgeSocket = null
  motionAppOpen?.kill('SIGTERM')
  motionAppOpen = null
}

function startMock() {
  stopAirpods()
  stopMock()
  mockStartedAt = Date.now()
  state.motion.running = true
  state.motion.source = 'mock'
  state.motion.connected = true
  state.motion.available = true
  state.motion.last = null
  state.motion.zero = null
  motionFilter = null
  followAxis = null
  mockTimer = setInterval(() => {
    const seconds = (Date.now() - mockStartedAt) / 1_000
    processMotion({
      type: 'motion',
      source: 'mock',
      at: Date.now(),
      x: Math.sin(seconds * 1.8) * 0.08,
      y: Math.cos(seconds * 1.3) * 0.08,
      z: Math.sin(seconds * 1.1) * 0.08,
      roll: Math.sin(seconds * 0.8) * 0.32,
      pitch: Math.sin(seconds * 0.6) * 0.24,
      yaw: Math.sin(seconds * 0.45) * 0.5,
    })
  }, 50)
  log('已启动模拟运动数据')
  publishState()
}

function stopMock() {
  if (!mockTimer) return
  clearInterval(mockTimer)
  mockTimer = null
  if (!motionBridgeSocket && !motionAppOpen) {
    state.motion.running = false
    state.motion.source = 'none'
    state.motion.connected = false
    state.motion.available = false
    publishState()
  }
}

function stopMotion() {
  stopAirpods()
  stopMock()
  state.motion.running = false
  state.motion.source = 'none'
  state.motion.connected = false
  state.motion.available = false
  state.motion.last = null
  state.motion.zero = null
  motionFilter = null
  followAxis = null
  stopDesired()
  publishState()
}

async function connectCamera(host = DEFAULT_PHONE_RELAY_HOST, port = PHONE_RELAY_PORT, transport = DEFAULT_TRANSPORT) {
  await disconnectCamera()
  const normalizedTransport = transport === 'phone-relay' ? 'phone-relay' : 'direct'
  const normalizedHost = typeof host === 'string' && host.trim()
    ? host.trim()
    : normalizedTransport === 'phone-relay' ? DEFAULT_PHONE_RELAY_HOST : DEFAULT_HOST
  const normalizedPort = normalizedTransport === 'phone-relay' ? PHONE_RELAY_PORT : Number(port)
  if (!normalizedHost || !Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65_535) throw new Error('目标地址或端口无效')
  state.camera = { connected: false, connecting: true, transport: normalizedTransport, host: normalizedHost, port: normalizedPort, info: null }
  publishState()
  const session = new Insta360TcpSession(normalizedHost, normalizedPort)
  try {
    log(`正在建立 Luna 控制握手（${normalizedTransport === 'phone-relay' ? '手机中转' : 'Mac 直连'}），不会启动视频流`)
    await session.open()
    cameraSession = session
    state.camera = { connected: true, connecting: false, transport: normalizedTransport, host: normalizedHost, port: normalizedPort, info: session.info || null }
    cameraHeartbeat = setInterval(() => {
      if (cameraSession === session && session.isOpen) void session.refresh().catch((error) => log(`相机保活失败：${error.message}`, 'warn'))
    }, 3_000)
    ensurePulseTimer()
    log(`Luna 控制握手已就绪${normalizedTransport === 'phone-relay' ? '（手机中转）' : ''} ${normalizedHost}:${normalizedPort}，未启动视频流`)
    publishState()
  } catch (error) {
    session.close()
    state.camera = { connected: false, connecting: false, transport: normalizedTransport, host: normalizedHost, port: normalizedPort, info: null }
    publishState()
    throw error
  }
}

async function disconnectCamera() {
  stopDesired()
  await sendNeutral()
  if (cameraHeartbeat) clearInterval(cameraHeartbeat)
  cameraHeartbeat = null
  cameraSession?.close()
  cameraSession = null
  state.camera = { ...state.camera, connected: false, connecting: false, info: null }
  publishState()
}

async function handleApi(path, method, body, response) {
  if (method === 'GET' && path === '/api/state') return sendJson(response, 200, { ok: true, state: publicState() })
  if (method !== 'POST') return sendError(response, 405, '只支持 GET 和 POST')

  if (path === '/api/motion/start') {
    startAirpods()
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/motion/mock') {
    body.enabled === false ? stopMotion() : startMock()
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/motion/stop') {
    stopMotion()
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/motion/reset') {
    resetMotionZero()
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/follow') {
    state.follow.enabled = Boolean(body.enabled)
    followAxis = null
    state.follow.baseline = state.follow.enabled && state.motion.last
      ? { yaw: state.motion.last.yaw, pitch: state.motion.last.pitch }
      : null
    if (!state.follow.enabled) {
      stopDesired()
      await sendNeutral()
    }
    log(state.follow.enabled ? '已开启头部跟随' : '已关闭头部跟随')
    publishState()
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/camera/connect') {
    await connectCamera(body.host, body.port, body.transport)
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/camera/disconnect') {
    await disconnectCamera()
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/gimbal/move') {
    if (!cameraSession?.isOpen) throw new Error('请先连接相机')
    const durationMs = Math.max(100, Math.min(5_000, Number(body.durationMs) || 300))
    const amplitude = Math.max(1, Math.min(200, Number(body.speed) || Number(body.amplitude) || state.gimbal.speed))
    setDesired(body.direction, amplitude, durationMs)
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/gimbal/settings') {
    state.gimbal.speed = normalizeGimbalSpeed(body.speed)
    log(`云台速度已调整为 ${state.gimbal.speed}`)
    publishState()
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/gimbal/stop') {
    stopDesired()
    await sendNeutral()
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  if (path === '/api/gimbal/center') {
    if (!cameraSession?.isOpen) throw new Error('请先连接相机')
    stopDesired()
    await cameraSession.sendCommand(226, buildGimbalControl(2), 4_000)
    log('已发送云台回正')
    return sendJson(response, 200, { ok: true, state: publicState() })
  }
  return sendError(response, 404, '未找到接口')
}

function serveIndex(response) {
  readFile(INDEX_FILE, (error, data) => {
    if (error) return sendError(response, 500, error.message)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(data)
  })
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  if (request.method === 'GET' && url.pathname === '/') return serveIndex(response)
  if (request.method === 'GET' && url.pathname === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`)
    clients.add(response)
    request.on('close', () => clients.delete(response))
    return
  }
  if (!url.pathname.startsWith('/api/')) return sendError(response, 404, '未找到页面')
  void (async () => {
    try {
      const body = request.method === 'POST' ? await readJson(request) : {}
      await handleApi(url.pathname, request.method || 'GET', body, response)
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : String(error))
    }
  })()
})

motionBridgeServer.listen(MOTION_BRIDGE_PORT, '127.0.0.1')
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Luna Mac AirPods demo: http://127.0.0.1:${PORT}`)
  console.log('先运行 build-motion-helper.mjs，再点击页面中的“启动 AirPods”。')
})

process.on('SIGINT', async () => {
  stopMotion()
  await disconnectCamera()
  motionBridgeServer.close()
  server.close(() => process.exit(0))
})
