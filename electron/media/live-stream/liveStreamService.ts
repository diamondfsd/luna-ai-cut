import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { app } from 'electron'
import { finished } from 'node:stream/promises'
import { join } from 'node:path'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import type { LiveUsageAnalytics } from '../../infrastructure/liveUsageAnalytics'
import {
  USB_STREAM_CONTROL_RESULT,
  USB_STREAM_VIDEO,
  controlDelivery,
  type LiveMediaReceiver,
  type UsbAoaState,
  type UsbAoaStatus,
} from './usbAoaReceiver'
import { createLiveMediaReceiver } from './mediaReceiver'
import { LivePreviewStreamService } from './livePreviewStreamService'
import { getAppleDeviceSupportStatus, getAppleDriverDownloadStatus } from './appleDeviceSupportService'
import type {
  AndroidConnectionMode,
  LiveStreamControlCapabilities,
  LiveStreamControlCommand,
  LiveStreamControlResult,
  LiveStreamState,
  LiveStreamStatus,
} from '../../../src/shared/types'

interface ActiveSession {
  state: 'running' | 'stopping'
  receiver: LiveMediaReceiver
  lastControlResult: LiveStreamControlResult | null
  capabilities: LiveStreamControlCapabilities | null
  captureStream: WriteStream | null
  capturePath: string | null
  livePreview: LivePreviewStreamService
  startedAt: string
}

const IDLE_USB_STATUS: UsbAoaStatus = {
  state: 'idle',
  transport: 'usb-aoa',
  message: 'USB AOA 接收器未启动',
  deviceLabel: null,
  vendorId: null,
  productId: null,
  deviceDetectionUnavailable: false,
  frames: 0,
  bytes: 0,
  lastFrameAt: null,
  videoFrames: 0,
  videoBytes: 0,
  lastVideoFrameAt: null,
  controlReady: false,
  error: null,
}

let activeSession: ActiveSession | null = null
let operation: Promise<LiveStreamStatus> | null = null
let lastCapturePath: string | null = null
let liveUsage: LiveUsageAnalytics | null = null
let onPhoneDisconnected: () => void = () => {}
let androidConnectionMode: AndroidConnectionMode = 'aoa'
let changingAndroidMode = false

export async function setAndroidConnectionMode(mode: AndroidConnectionMode): Promise<LiveStreamStatus> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前系统不支持此连接方式')
  if (mode !== 'aoa' && mode !== 'adb') throw new Error('不支持的手机连接方式')
  if (changingAndroidMode || operation) throw new Error('连接处理中，请稍后重试')
  if (mode === androidConnectionMode) return getLiveStreamStatus()
  const state = activeSession?.receiver.status().state
  if (activeSession?.captureStream || state === 'connected' || state === 'streaming') throw new Error('请先停止获取画面')
  changingAndroidMode = true
  try {
    const wasActive = Boolean(activeSession)
    if (wasActive) await stopLiveStream()
    androidConnectionMode = mode
    logMainInfo('[直播流] 安卓连接方式已切换', { mode })
    return await (wasActive ? startLiveStream() : getLiveStreamStatus())
  } finally {
    changingAndroidMode = false
  }
}

export function setLiveStreamDisconnectHandler(handler: () => void): void {
  onPhoneDisconnected = handler
}

export function setLiveUsageAnalytics(analytics: LiveUsageAnalytics): void {
  liveUsage = analytics
}

function statusState(usbState: UsbAoaState): LiveStreamState {
  const session = activeSession
  if (!session) return 'idle'
  if (session.state === 'stopping') return 'stopping'
  if (usbState === 'error') return 'error'
  if (usbState === 'waiting' || usbState === 'switching' || usbState === 'idle') return 'waiting-usb'
  return usbState === 'streaming' ? 'running' : 'ready'
}

function statusMessage(state: LiveStreamState, usb: UsbAoaStatus): string {
  if (state === 'idle') return '输入接收未启动'
  if (state === 'waiting-usb') return usb.message
  if (state === 'ready') return '手机连接已就绪'
  if (state === 'running') return '直播画面已连接'
  if (state === 'stopping') return '正在停止画面接收'
  return usb.error ?? usb.message
}

export async function getLiveStreamStatus(): Promise<LiveStreamStatus> {
  const appleDeviceSupport = await getAppleDeviceSupportStatus()
  const usb = activeSession?.receiver.status() ?? IDLE_USB_STATUS
  const usbMessage = usb.transport !== 'android-adb' && usb.state === 'waiting' && !usb.deviceLabel && !usb.error
    ? '等待 Android 或 iPhone 通过 USB 连接' : usb.message
  const state = statusState(usb.state)
  const error = usb.error ?? null
  if (activeSession) liveUsage?.capabilities(activeSession.startedAt, usb.controlReady, activeSession.capabilities)

  return {
    state,
    platform: process.platform,
    androidConnectionMode,
    appleDeviceSupport,
    appleDriverDownload: getAppleDriverDownloadStatus(),
    controlReady: usb.controlReady,
    lastControlResult: activeSession?.lastControlResult ?? null,
    capabilities: activeSession?.capabilities ?? null,
    localPreviewUrl: activeSession?.livePreview.status().url ?? null,
    localPreviewError: activeSession?.livePreview.status().error ?? null,
    capturePath: activeSession?.capturePath ?? lastCapturePath,
    captureActive: Boolean(activeSession?.captureStream),
    receiverConnected: usb.state === 'connected' || usb.state === 'streaming',
    transport: usb.transport,
    usbState: usb.state,
    usbMessage,
    usbDeviceLabel: usb.deviceLabel,
    usbVendorId: usb.vendorId,
    usbProductId: usb.productId,
    frames: usb.frames,
    bytes: usb.bytes,
    lastFrameAt: usb.lastFrameAt,
    videoFrames: usb.videoFrames,
    videoBytes: usb.videoBytes,
    lastVideoFrameAt: usb.lastVideoFrameAt,
    startedAt: activeSession?.startedAt ?? null,
    message: error ?? statusMessage(state, { ...usb, message: usbMessage }),
    error,
  }
}

export async function startLiveStreamCapture(): Promise<string> {
  const session = activeSession
  if (!session) throw new Error('请先获取画面')
  if (session.captureStream && session.capturePath) return session.capturePath

  const directory = join(app.getPath('userData'), 'live-captures')
  mkdirSync(directory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const capturePath = join(directory, `live-stream-${timestamp}.ucd2`)
  const stream = createWriteStream(capturePath, { flags: 'wx' })
  session.captureStream = stream
  session.capturePath = capturePath
  lastCapturePath = capturePath
  stream.on('error', (error) => {
    if (session.captureStream !== stream) return
    session.captureStream = null
    session.capturePath = null
    logMainWarn('[直播流] 原始抓取写入失败', { error: error.message })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        stream.off('error', onError)
        resolve()
      }
      const onError = (error: Error) => {
        stream.off('open', onOpen)
        reject(error)
      }
      stream.once('open', onOpen)
      stream.once('error', onError)
    })
  } catch (error) {
    if (session.captureStream === stream) {
      session.captureStream = null
      session.capturePath = null
    }
    throw error
  }

  logMainInfo('[直播流] 原始抓取已开始', { capturePath })
  return capturePath
}

export async function stopLiveStreamCapture(): Promise<string | null> {
  const session = activeSession
  if (!session?.captureStream) return session?.capturePath ?? lastCapturePath
  const stream = session.captureStream
  const capturePath = session.capturePath
  session.captureStream = null
  session.capturePath = null
  if (capturePath) lastCapturePath = capturePath
  stream.end()
  await finished(stream)
  logMainInfo('[直播流] 原始抓取已保存', { capturePath })
  return capturePath
}

export async function sendLiveStreamControlCommand(command: LiveStreamControlCommand): Promise<string> {
  const session = activeSession
  if (!session) throw new Error('手机 USB 尚未连接')
  const requestId = randomUUID()
  try {
    await session.receiver.sendControl({
      ...command,
      version: 1,
      requestId,
      delivery: controlDelivery(command),
    })
    liveUsage?.control(session.startedAt, command.type, false)
  } catch (error) {
    liveUsage?.control(session.startedAt, command.type, true)
    throw error
  }
  if ((command.type === 'zoom.preview' || command.type === 'zoom.set') && session.capabilities) {
    session.capabilities = {
      ...session.capabilities,
      zoom: { ...session.capabilities.zoom, current: command.value },
    }
  }
  return requestId
}

export function startLiveStream(): Promise<LiveStreamStatus> {
  if (operation) return operation
  const task = (async () => {
    if (activeSession) return getLiveStreamStatus()
    const livePreview = new LivePreviewStreamService()
    await livePreview.start()
    const receiver = createLiveMediaReceiver((frame) => {
      const session = activeSession
      if (!session || session.receiver !== receiver) return
      if (frame.streamType === USB_STREAM_CONTROL_RESULT && frame.controlResult) {
        session.lastControlResult = frame.controlResult
        if (frame.controlResult.type === 'capabilities.get' && frame.controlResult.ok && frame.controlResult.data) {
          const nextCapabilities = frame.controlResult.data as LiveStreamControlCapabilities
          const currentZoom = session.capabilities?.zoom.current
          session.capabilities = currentZoom == null
            ? nextCapabilities
            : { ...nextCapabilities, zoom: { ...nextCapabilities.zoom, current: currentZoom } }
        }
        return
      }

      session.captureStream?.write(frame.raw)
      if (frame.streamType === USB_STREAM_VIDEO) {
        session.livePreview.pushHevcFrame(frame.body)
      }
    }, () => {
      logMainInfo('[直播流] 手机连接断开，关闭直播窗口')
      onPhoneDisconnected()
    }, androidConnectionMode)
    const session: ActiveSession = {
      state: 'running',
      receiver,
      lastControlResult: null,
      capabilities: null,
      captureStream: process.env.LUNA_USB_CAPTURE_PATH
        ? createWriteStream(process.env.LUNA_USB_CAPTURE_PATH, { flags: 'w' })
        : null,
      capturePath: process.env.LUNA_USB_CAPTURE_PATH ?? null,
      livePreview,
      startedAt: new Date().toISOString(),
    }
    activeSession = session
    liveUsage?.start(session.startedAt)
    receiver.start()
    logMainInfo('[直播流] 手机输入接收已启动', { androidConnectionMode })
    return getLiveStreamStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

export function stopLiveStream(): Promise<LiveStreamStatus> {
  if (operation) return operation
  const task = (async () => {
    const session = activeSession
    if (session) {
      session.state = 'stopping'
      liveUsage?.stop(session.startedAt)
      await session.receiver.stop()
      await stopLiveStreamCapture()
      await session.livePreview.stop()
      activeSession = null
    }
    logMainInfo('[直播流] 输入接收已停止')
    return getLiveStreamStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

export async function stopLiveStreamOnQuit(): Promise<void> {
  if (!activeSession) return
  await stopLiveStream().catch((error: unknown) => {
    logMainWarn('[直播流] 退出清理失败', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
