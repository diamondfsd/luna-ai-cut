import { app, shell, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, renameSync, rmSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConnection, type Socket } from 'node:net'
import { promisify } from 'node:util'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import {
  USB_STREAM_AUDIO,
  USB_STREAM_CONTROL_RESULT,
  USB_STREAM_VIDEO,
  type DesktopMediaReceiver,
  type UsbAoaState,
  type UsbAoaStatus,
} from './usbAoaReceiver'
import { createDesktopMediaReceiver } from './desktopMediaReceiver'
import { LivePreviewStreamService } from './livePreviewStreamService'
import type {
  DesktopAudioInputFrame,
  DesktopAudioSourceMode,
  DesktopControlCapabilities,
  DesktopControlCommand,
  DesktopControlResult,
  DesktopVirtualCameraExtensionState,
  DesktopVirtualCameraOptions,
  DesktopVirtualCameraState,
  DesktopVirtualCameraStatus,
} from '../../../src/shared/types'

const execFileAsync = promisify(execFile)
const EXTENSION_IDENTIFIER = 'com.diamondfsd.luna.virtualcamera.host.extension'
const APP_NAME = 'LunaCameraHost.app'
const INSTALLED_HOST_PATH = `/Applications/${APP_NAME}`
const HOST_EXECUTABLE_PATH = `${INSTALLED_HOST_PATH}/Contents/MacOS/LunaCameraHost`
const MICROPHONE_DRIVER_NAME = 'LunaVirtualMicrophone.driver'
const INSTALLED_MICROPHONE_PATH = `/Library/Audio/Plug-Ins/HAL/${MICROPHONE_DRIVER_NAME}`
const MICROPHONE_NAME = 'Luna Virtual Microphone'
const DEFAULT_PORT = 4184
const AUDIO_DELAY_STREAM = 0x22
const AUDIO_STREAM = 0x21
const AUDIO_CODEC_PCM16_LE = 0x01
const AUDIO_SOURCE_DESKTOP_MICROPHONE = 0x04

interface ActiveSession {
  state: 'starting' | 'running' | 'stopping'
  socket: Socket | null
  receiver: DesktopMediaReceiver
  audioDelayMs: number
  sequence: number
  lastControlResult: DesktopControlResult | null
  capabilities: DesktopControlCapabilities | null
  captureStream: WriteStream | null
  livePreview: LivePreviewStreamService
  outputEnabled: boolean
  outputError: string | null
  outputReconnectTimer: NodeJS.Timeout | null
  outputReconnectInFlight: boolean
  audioSourceMode: DesktopAudioSourceMode
  audioMonitor: WebContents | null
  startedAt: string
  error: string | null
}

const IDLE_USB_STATUS: UsbAoaStatus = {
  state: 'idle',
  transport: 'usb-aoa',
  message: 'USB AOA 接收器未启动',
  deviceLabel: null,
  vendorId: null,
  productId: null,
  frames: 0,
  bytes: 0,
  lastFrameAt: null,
  videoFrames: 0,
  videoBytes: 0,
  lastVideoFrameAt: null,
  audioFrames: 0,
  audioBytes: 0,
  lastAudioFrameAt: null,
  audioSource: null,
  audioSampleRate: null,
  audioChannels: null,
  controlReady: false,
  error: null,
}

let activeSession: ActiveSession | null = null
let operation: Promise<DesktopVirtualCameraStatus> | null = null

async function execText(command: string, args: string[]): Promise<string> {
  const result = await execFileAsync(command, args, { encoding: 'utf8' })
  return String(result.stdout)
}

function installSourcePath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'desktop-virtual-camera', APP_NAME)]
    : [
        join(app.getAppPath(), 'desktop_virtual_camera', 'macos', '.build', 'SignedData', 'Build', 'Products', 'Debug', APP_NAME),
        join(app.getAppPath(), 'desktop_virtual_camera', 'macos', 'build', 'Debug', APP_NAME),
      ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function sourcePathOrThrow(): string {
  const source = installSourcePath()
  if (!source) {
    throw new Error('未找到已签名的 LunaCameraHost.app。请先运行 pnpm build:desktop-camera。')
  }
  return source
}

function microphoneSourcePath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'desktop-virtual-camera', MICROPHONE_DRIVER_NAME)]
    : [
        join(app.getAppPath(), 'desktop_virtual_camera', 'macos', '.build', MICROPHONE_DRIVER_NAME),
        join(app.getAppPath(), 'resources', 'desktop-virtual-camera', MICROPHONE_DRIVER_NAME),
      ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function clampAudioDelay(value: number | undefined): number {
  return Math.min(10_000, Math.max(-10_000, Math.round(value ?? 0)))
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function appleScriptQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function isHostRunning(): Promise<boolean> {
  try {
    await execFileAsync('pgrep', ['-f', `^${HOST_EXECUTABLE_PATH}$`], { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

async function readExtensionState(): Promise<{
  installed: boolean
  enabled: boolean
  state: DesktopVirtualCameraExtensionState
}> {
  try {
    const output = await execText('/usr/bin/systemextensionsctl', ['list'])
    const entries = output
      .split('\n')
      .filter((entry) => entry.includes(EXTENSION_IDENTIFIER))
      .map((entry) => entry.match(/\[([^\]]+)]\s*$/)?.[1]?.trim() ?? '')
    if (entries.length === 0) return { installed: false, enabled: false, state: 'not-found' }
    if (entries.some((stateText) => stateText.includes('activated enabled'))) {
      return { installed: true, enabled: true, state: 'enabled' }
    }
    if (entries.some((stateText) => stateText.includes('waiting for user'))) {
      return { installed: true, enabled: false, state: 'waiting-approval' }
    }
    if (entries.some((stateText) => stateText.includes('activated disabled') || stateText.includes('disabled'))) {
      return { installed: true, enabled: false, state: 'disabled' }
    }
    return { installed: true, enabled: false, state: 'unknown' }
  } catch {
    return { installed: false, enabled: false, state: 'unknown' }
  }
}

function statusState(
  unsupported: boolean,
  hostInstalled: boolean,
  extensionState: DesktopVirtualCameraExtensionState,
  usbState: UsbAoaState,
): DesktopVirtualCameraState {
  if (unsupported) return 'unsupported'
  if (activeSession) {
    if (usbState === 'error') return 'error'
    if (usbState === 'waiting' || usbState === 'switching' || usbState === 'idle') return 'waiting-usb'
    return activeSession.state
  }
  if (!hostInstalled) return 'not-installed'
  if (extensionState === 'waiting-approval' || extensionState === 'disabled') return 'needs-approval'
  if (usbState === 'error') return 'error'
  if (extensionState === 'enabled') return 'ready'
  return 'not-installed'
}

function statusMessage(
  state: DesktopVirtualCameraState,
  extensionState: DesktopVirtualCameraExtensionState,
  sourceAvailable: boolean,
  microphoneInstalled: boolean,
  usb: UsbAoaStatus,
): string {
  if (state === 'unsupported') {
    return process.platform === 'win32'
      ? 'Windows 虚拟摄像头原生组件尚未构建'
      : '直播控制台当前未在当前平台启用'
  }
  if (state === 'waiting-usb') return usb.message
  if (state === 'running') return usb.message
  if (state === 'starting') return '正在启动虚拟摄像头接收端'
  if (state === 'stopping') return '正在停止虚拟摄像头输出'
  if (state === 'needs-approval') return '等待在系统设置中启用 Luna Virtual Camera Extension'
  if (extensionState === 'not-found' && sourceAvailable) return 'Luna Camera Host 尚未安装'
  if (state === 'ready' && !microphoneInstalled) return '虚拟麦克风尚未安装'
  if (state === 'ready') return '音视频组件已就绪，连接手机 USB 后即可输出'
  return '尚未安装可用的 Luna Camera Host'
}

export async function getDesktopVirtualCameraStatus(): Promise<DesktopVirtualCameraStatus> {
  const unsupported = process.platform !== 'darwin'
  const hostInstalled = !unsupported && existsSync(INSTALLED_HOST_PATH)
  const source = unsupported ? null : installSourcePath()
  const microphoneSource = unsupported ? null : microphoneSourcePath()
  const microphoneInstalled = !unsupported && existsSync(INSTALLED_MICROPHONE_PATH)
  const extension = unsupported
    ? { installed: false, enabled: false, state: 'unknown' as const }
    : await readExtensionState()
  const usb = activeSession?.receiver.status() ?? IDLE_USB_STATUS
  const hostRunning = !unsupported && await isHostRunning()
  const state = statusState(unsupported, hostInstalled, extension.state, usb.state)
  const outputEnabled = Boolean(activeSession?.outputEnabled)
  const outputReady = outputEnabled && Boolean(activeSession?.socket && !activeSession.socket.destroyed)

  return {
    state,
    platform: process.platform,
    hostAppInstalled: hostInstalled,
    bundledHostAvailable: Boolean(source),
    hostAppPath: hostInstalled ? INSTALLED_HOST_PATH : source,
    installSourcePath: source,
    extensionIdentifier: EXTENSION_IDENTIFIER,
    extensionInstalled: extension.installed,
    extensionEnabled: extension.enabled,
    extensionState: extension.state,
    virtualMicrophoneInstalled: microphoneInstalled,
    virtualMicrophoneAvailable: Boolean(microphoneSource),
    virtualMicrophoneName: MICROPHONE_NAME,
    controlReady: usb.controlReady,
    lastControlResult: activeSession?.lastControlResult ?? null,
    capabilities: activeSession?.capabilities ?? null,
    localPreviewUrl: activeSession?.livePreview.status().url ?? null,
    localPreviewError: activeSession?.livePreview.status().error ?? null,
    hostRunning,
    outputEnabled,
    outputReady,
    outputMessage: activeSession?.outputError ?? null,
    receiverConnected: usb.state === 'connected' || usb.state === 'streaming',
    transport: usb.transport,
    usbState: usb.state,
    usbMessage: usb.message,
    usbDeviceLabel: usb.deviceLabel,
    usbVendorId: usb.vendorId,
    usbProductId: usb.productId,
    port: activeSession?.socket?.remotePort ?? DEFAULT_PORT,
    frames: usb.frames,
    bytes: usb.bytes,
    lastFrameAt: usb.lastFrameAt,
    videoFrames: usb.videoFrames,
    videoBytes: usb.videoBytes,
    lastVideoFrameAt: usb.lastVideoFrameAt,
    audioFrames: usb.audioFrames,
    audioBytes: usb.audioBytes,
    lastAudioFrameAt: usb.lastAudioFrameAt,
    audioSource: usb.audioSource,
    audioSampleRate: usb.audioSampleRate,
    audioChannels: usb.audioChannels,
    audioDelayMs: activeSession?.audioDelayMs ?? 0,
    startedAt: activeSession?.startedAt ?? null,
    message: activeSession?.error ?? usb.error ?? statusMessage(state, extension.state, Boolean(source), microphoneInstalled, usb),
    error: activeSession?.error ?? usb.error ?? null,
  }
}

async function stageHostApp(source: string): Promise<void> {
  const stagedPath = `/Applications/.${APP_NAME}.${process.pid}.staged`
  rmSync(stagedPath, { recursive: true, force: true })
  await execFileAsync('/usr/bin/ditto', [source, stagedPath], { encoding: 'utf8' })
  rmSync(INSTALLED_HOST_PATH, { recursive: true, force: true })
  renameSync(stagedPath, INSTALLED_HOST_PATH)
}

async function installMicrophoneDriver(source: string): Promise<void> {
  if (existsSync(INSTALLED_MICROPHONE_PATH)) return
  const installDir = '/Library/Audio/Plug-Ins/HAL'
  const stagedPath = `${installDir}/.${MICROPHONE_DRIVER_NAME}.${process.pid}.staged`
  const command = [
    `/usr/bin/install -d -m 755 ${shellQuote(installDir)}`,
    `/bin/rm -rf ${shellQuote(stagedPath)}`,
    `/usr/bin/ditto ${shellQuote(source)} ${shellQuote(stagedPath)}`,
    `/usr/sbin/chown -R root:wheel ${shellQuote(stagedPath)}`,
    `/usr/bin/find ${shellQuote(stagedPath)} -type d -exec /bin/chmod 755 {} +`,
    `/usr/bin/find ${shellQuote(stagedPath)} -type f -exec /bin/chmod 644 {} +`,
    `/bin/chmod 755 ${shellQuote(`${stagedPath}/Contents/MacOS/LunaVirtualMicrophone`)}`,
    `/usr/bin/codesign --verify --strict ${shellQuote(stagedPath)}`,
    `/bin/rm -rf ${shellQuote(INSTALLED_MICROPHONE_PATH)}`,
    `/bin/mv ${shellQuote(stagedPath)} ${shellQuote(INSTALLED_MICROPHONE_PATH)}`,
    '/usr/bin/killall -9 coreaudiod 2>/dev/null || true',
  ].join('\n')
  await execFileAsync('/usr/bin/osascript', [
    '-e',
    `do shell script ${appleScriptQuote(command)} with administrator privileges`,
  ], { encoding: 'utf8' })
}

export function installDesktopVirtualCameraHost(): Promise<DesktopVirtualCameraStatus> {
  if (operation) return operation
  const task = (async () => {
    if (process.platform !== 'darwin') return getDesktopVirtualCameraStatus()
    const source = sourcePathOrThrow()
    if (!existsSync(INSTALLED_HOST_PATH)) await stageHostApp(source)
    const microphoneSource = microphoneSourcePath()
    if (microphoneSource) await installMicrophoneDriver(microphoneSource)
    await execFileAsync('/usr/bin/open', [INSTALLED_HOST_PATH], { encoding: 'utf8' })
    logMainInfo('[虚拟摄像头] 音视频组件已安装', { source, microphoneSource })
    return getDesktopVirtualCameraStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

function makeAudioDelayFrame(delayMs: number, sequence: number): Buffer {
  const frame = Buffer.alloc(29)
  Buffer.from([0x55, 0x43, 0x44, 0x32]).copy(frame, 0)
  frame[4] = 0x01
  frame[5] = 0x0c
  frame[6] = 0x01
  frame[7] = sequence & 0xff
  frame.writeUInt32LE(13, 8)
  frame[12] = AUDIO_DELAY_STREAM
  frame.writeBigUInt64LE(BigInt(Date.now()) * 1_000n, 13)
  frame.writeInt32LE(clampAudioDelay(delayMs), 21)
  return frame
}

function sendAudioDelay(session: ActiveSession): void {
  if (!session.socket || session.socket.destroyed || !session.socket.writable) return
  session.sequence = (session.sequence + 1) & 0xff
  session.socket.write(makeAudioDelayFrame(session.audioDelayMs, session.sequence))
}

function updateSessionZoom(session: ActiveSession, value: number): void {
  if (!session.capabilities) return
  session.capabilities = {
    ...session.capabilities,
    zoom: { ...session.capabilities.zoom, current: value },
  }
}

function makeAudioFrame(frame: DesktopAudioInputFrame, sequence: number): Buffer {
  const sampleRate = Math.round(frame.sampleRate)
  const channels = Math.round(frame.channels)
  const sampleCount = Math.round(frame.sampleCount)
  const pcm = Buffer.from(frame.pcm16Le)
  if (sampleRate <= 0 || channels <= 0 || sampleCount <= 0 || pcm.length !== sampleCount * channels * 2) {
    throw new Error('电脑麦克风音频格式无效')
  }

  const audioBody = Buffer.alloc(12 + pcm.length)
  audioBody[0] = AUDIO_CODEC_PCM16_LE
  audioBody[1] = AUDIO_SOURCE_DESKTOP_MICROPHONE
  audioBody.writeUInt32LE(sampleRate, 2)
  audioBody[6] = channels
  audioBody.writeUInt32LE(sampleCount, 8)
  pcm.copy(audioBody, 12)

  const payloadLength = 9 + audioBody.length
  const packet = Buffer.alloc(12 + payloadLength + 4)
  Buffer.from([0x55, 0x43, 0x44, 0x32]).copy(packet, 0)
  packet[4] = 0x01
  packet[5] = 0x0c
  packet[6] = 0x01
  packet[7] = sequence & 0xff
  packet.writeUInt32LE(payloadLength, 8)
  packet[12] = AUDIO_STREAM
  packet.writeBigUInt64LE(BigInt(Date.now()) * 1_000n, 13)
  audioBody.copy(packet, 21)
  return packet
}

export function sendDesktopVirtualCameraAudioFrame(frame: DesktopAudioInputFrame): void {
  const session = activeSession
  if (!session?.outputEnabled || session.audioSourceMode !== 'desktop') return
  const socket = session.socket
  if (!socket || socket.destroyed || !socket.writable || socket.writableNeedDrain) return
  session.sequence = (session.sequence + 1) & 0xff
  socket.write(makeAudioFrame(frame, session.sequence))
}

export async function setDesktopVirtualCameraAudioSource(source: DesktopAudioSourceMode): Promise<void> {
  const session = activeSession
  if (session) session.audioSourceMode = source === 'desktop' ? 'desktop' : 'phone'
}

export async function setDesktopVirtualCameraAudioDelay(delayMs: number): Promise<DesktopVirtualCameraStatus> {
  const session = activeSession
  if (session) {
    session.audioDelayMs = clampAudioDelay(delayMs)
    sendAudioDelay(session)
    return getDesktopVirtualCameraStatus()
  }
  return getDesktopVirtualCameraStatus()
}

export function setDesktopVirtualCameraAudioMonitor(enabled: boolean, target: WebContents): boolean {
  const session = activeSession
  if (!session) throw new Error('请先获取画面')
  session.audioMonitor = enabled ? target : null
  return Boolean(session.audioMonitor)
}

export async function sendDesktopControlCommand(command: DesktopControlCommand): Promise<string> {
  const session = activeSession
  if (!session) throw new Error('手机 USB 尚未连接')
  const requestId = randomUUID()
  await session.receiver.sendControl({ ...command, version: 1, requestId })
  if (command.type === 'zoom.preview' || command.type === 'zoom.set') {
    updateSessionZoom(session, command.value)
  }
  return requestId
}

async function waitForHost(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isHostRunning()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Luna Camera Host 启动超时')
}

function connectToHost(port: number, timeoutMs = 5_000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tryConnect = () => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.off('error', onError)
        resolve(socket)
      })
      const onError = () => {
        socket.destroy()
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`无法连接虚拟摄像头接收端口 ${port}`))
          return
        }
        setTimeout(tryConnect, 150)
      }
      socket.once('error', onError)
    }
    tryConnect()
  })
}

function scheduleOutputReconnect(session: ActiveSession, delayMs = 1_500): void {
  if (!session.outputEnabled || session.outputReconnectTimer) return
  session.outputReconnectTimer = setTimeout(() => {
    session.outputReconnectTimer = null
    void reconnectOutput(session)
  }, delayMs)
}

async function reconnectOutput(session: ActiveSession): Promise<void> {
  if (activeSession !== session || !session.outputEnabled || session.outputReconnectInFlight) return
  session.outputReconnectInFlight = true
  try {
    const runtime = await getDesktopVirtualCameraStatus()
    const unavailable = outputUnavailableReason(runtime)
    if (unavailable) {
      session.outputEnabled = false
      session.outputError = unavailable
      return
    }
    if (!await isHostRunning()) {
      await execFileAsync('/usr/bin/open', [INSTALLED_HOST_PATH], { encoding: 'utf8' })
      await waitForHost()
    }
    const socket = await connectToHost(runtime.port)
    if (activeSession !== session || !session.outputEnabled) {
      socket.destroy()
      return
    }
    session.socket = socket
    session.outputError = null
    socket.once('close', () => {
      if (activeSession !== session || session.socket !== socket) return
      session.socket = null
      if (!session.outputEnabled || session.state === 'stopping') return
      session.outputError = '虚拟摄像头输出正在恢复'
      scheduleOutputReconnect(session)
    })
    sendAudioDelay(session)
    logMainInfo('[虚拟摄像头] 输出连接已恢复', { port: runtime.port })
  } catch (error) {
    if (activeSession !== session || !session.outputEnabled) return
    session.outputError = '虚拟摄像头输出正在恢复'
    logMainWarn('[虚拟摄像头] 输出连接恢复失败', {
      error: error instanceof Error ? error.message : String(error),
    })
    scheduleOutputReconnect(session)
  } finally {
    session.outputReconnectInFlight = false
  }
}

export function startDesktopVirtualCamera(options: DesktopVirtualCameraOptions): Promise<DesktopVirtualCameraStatus> {
  if (operation) return operation
  const task = (async () => {
    if (process.platform !== 'darwin') return getDesktopVirtualCameraStatus()
    if (activeSession) return getDesktopVirtualCameraStatus()
    const port = options.port ?? DEFAULT_PORT
    const livePreview = new LivePreviewStreamService()
    await livePreview.start()
    const receiver = createDesktopMediaReceiver((frame) => {
      if (frame.streamType === USB_STREAM_CONTROL_RESULT && frame.controlResult) {
        if (activeSession?.receiver === receiver) {
          activeSession.lastControlResult = frame.controlResult
          if (frame.controlResult.type === 'capabilities.get' && frame.controlResult.ok && frame.controlResult.data) {
            const nextCapabilities = frame.controlResult.data as DesktopControlCapabilities
            const currentZoom = activeSession.capabilities?.zoom.current
            activeSession.capabilities = currentZoom == null
              ? nextCapabilities
              : { ...nextCapabilities, zoom: { ...nextCapabilities.zoom, current: currentZoom } }
          }
        }
        return
      }
      if (activeSession?.receiver !== receiver) return
      activeSession.captureStream?.write(frame.raw)
      if (frame.streamType === USB_STREAM_VIDEO) activeSession.livePreview.pushHevcFrame(frame.body)
      if (frame.streamType === USB_STREAM_AUDIO && frame.audio && activeSession.audioMonitor && !activeSession.audioMonitor.isDestroyed()) {
        activeSession.audioMonitor.send('desktop-virtual-camera:audio-monitor-frame', {
          sampleRate: frame.audio.sampleRate,
          channels: frame.audio.channels,
          sampleCount: frame.audio.sampleCount,
          pcm16Le: frame.audio.pcm16Le,
        })
      }
      const socket = activeSession.socket
      if (!socket || socket.destroyed || !socket.writable || socket.writableNeedDrain) return
      if (
        frame.streamType === USB_STREAM_VIDEO
        || (frame.streamType === USB_STREAM_AUDIO && activeSession.audioSourceMode === 'phone')
      ) socket.write(frame.raw)
    })
    const session: ActiveSession = {
      state: 'running',
      socket: null,
      receiver,
      audioDelayMs: clampAudioDelay(options.audioDelayMs),
      sequence: 0,
      lastControlResult: null,
      capabilities: null,
      captureStream: process.env.LUNA_USB_CAPTURE_PATH
        ? createWriteStream(process.env.LUNA_USB_CAPTURE_PATH, { flags: 'w' })
        : null,
      livePreview,
      outputEnabled: false,
      outputError: null,
      outputReconnectTimer: null,
      outputReconnectInFlight: false,
      audioSourceMode: 'phone',
      audioMonitor: null,
      startedAt: new Date().toISOString(),
      error: null,
    }
    activeSession = session
    sendAudioDelay(session)
    receiver.start()
    logMainInfo('[虚拟摄像头] USB AOA 接收已启动', { port })
    return getDesktopVirtualCameraStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

function outputUnavailableReason(status: DesktopVirtualCameraStatus): string | null {
  if (status.platform !== 'darwin') return '虚拟摄像头输出暂不支持当前系统'
  if (!status.hostAppInstalled) return status.bundledHostAvailable ? '需要先安装虚拟摄像头组件' : '当前版本缺少虚拟摄像头组件'
  if (status.extensionState === 'not-found') return '虚拟摄像头扩展尚未安装，请重新安装组件'
  if (status.extensionState === 'waiting-approval' || status.extensionState === 'disabled') return '请在系统设置中启用 Luna Virtual Camera'
  if (!status.extensionEnabled) return '虚拟摄像头扩展当前不可用'
  return null
}

export async function startDesktopVirtualCameraOutput(): Promise<DesktopVirtualCameraStatus> {
  if (operation) return operation
  const task = (async () => {
    const session = activeSession
    if (!session) throw new Error('请先获取画面')
    if (session.outputEnabled && session.socket && !session.socket.destroyed) {
      return getDesktopVirtualCameraStatus()
    }

    const runtime = await getDesktopVirtualCameraStatus()
    const unavailable = outputUnavailableReason(runtime)
    if (unavailable) {
      session.outputEnabled = false
      session.outputError = unavailable
      return getDesktopVirtualCameraStatus()
    }

    session.outputEnabled = true
    session.outputError = null
    await reconnectOutput(session)
    logMainInfo('[虚拟摄像头] 输出已开启', { port: runtime.port })
    return getDesktopVirtualCameraStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

export async function stopDesktopVirtualCameraOutput(): Promise<DesktopVirtualCameraStatus> {
  if (operation) return operation
  const task = (async () => {
    const session = activeSession
    if (!session) return getDesktopVirtualCameraStatus()
    session.outputEnabled = false
    session.outputError = null
    if (session.outputReconnectTimer) clearTimeout(session.outputReconnectTimer)
    session.outputReconnectTimer = null
    session.socket?.end()
    session.socket?.destroy()
    session.socket = null
    clearPublishedFrame()
    if (process.platform === 'darwin' && await isHostRunning()) {
      await execFileAsync('/usr/bin/pkill', ['-TERM', '-f', `^${HOST_EXECUTABLE_PATH}$`], { encoding: 'utf8' }).catch(() => undefined)
    }
    logMainInfo('[虚拟摄像头] 输出已关闭')
    return getDesktopVirtualCameraStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

function clearPublishedFrame(): void {
  const candidates = [
    '/private/tmp/luna-virtual-camera/latest-bgra.frame',
    '/tmp/latest-bgra.frame',
    join(homedir(), 'Library', 'Group Containers', '8B6J8663PS.com.diamondfsd.luna.virtualcamera', 'latest-bgra.frame'),
  ]
  for (const candidate of candidates) rmSync(candidate, { force: true })
}

export function stopDesktopVirtualCamera(): Promise<DesktopVirtualCameraStatus> {
  if (operation) return operation
  const task = (async () => {
    const session = activeSession
    if (session) {
      session.state = 'stopping'
      await session.receiver.stop()
      session.socket?.end()
      session.socket?.destroy()
      session.captureStream?.end()
      session.audioMonitor = null
      await session.livePreview.stop()
      activeSession = null
    }
    clearPublishedFrame()
    if (process.platform === 'darwin' && await isHostRunning()) {
      await execFileAsync('/usr/bin/pkill', ['-TERM', '-f', `^${HOST_EXECUTABLE_PATH}$`], { encoding: 'utf8' }).catch(() => undefined)
    }
    logMainInfo('[虚拟摄像头] USB AOA 输出已停止')
    return getDesktopVirtualCameraStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

export async function openDesktopVirtualCameraSettings(): Promise<void> {
  if (process.platform !== 'darwin') return
  await execFileAsync('/usr/bin/open', [
    `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?extension=${EXTENSION_IDENTIFIER}`,
  ], { encoding: 'utf8' })
}

export function revealDesktopVirtualCameraSource(): void {
  const source = installSourcePath()
  if (!source) throw new Error('未找到 Luna Camera Host 构建产物')
  shell.showItemInFolder(source)
}

export async function stopDesktopVirtualCameraOnQuit(): Promise<void> {
  const session = activeSession
  if (!session) return
  await stopDesktopVirtualCamera().catch((error: unknown) => {
    logMainWarn('[虚拟摄像头] 退出清理失败', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
