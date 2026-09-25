import { randomUUID } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import type { WebContents } from 'electron'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import {
  USB_STREAM_AUDIO,
  USB_STREAM_CONTROL_RESULT,
  USB_STREAM_VIDEO,
  type LiveMediaReceiver,
  type UsbAoaState,
  type UsbAoaStatus,
} from './usbAoaReceiver'
import { createLiveMediaReceiver } from './mediaReceiver'
import { LivePreviewStreamService } from './livePreviewStreamService'
import { RtmpStreamService, type RtmpStreamState } from './rtmpStreamService'
import type {
  LiveStreamAudioInputFrame,
  LiveStreamAudioSourceMode,
  LiveStreamControlCapabilities,
  LiveStreamControlCommand,
  LiveStreamControlResult,
  LiveStreamOptions,
  LiveStreamState,
  LiveStreamStatus,
} from '../../../src/shared/types'

interface ActiveSession {
  state: 'running' | 'stopping'
  receiver: LiveMediaReceiver
  lastControlResult: LiveStreamControlResult | null
  capabilities: LiveStreamControlCapabilities | null
  captureStream: WriteStream | null
  livePreview: LivePreviewStreamService
  rtmp: RtmpStreamService
  audioSourceMode: LiveStreamAudioSourceMode
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
let operation: Promise<LiveStreamStatus> | null = null

function statusState(
  usbState: UsbAoaState,
  rtmpState: RtmpStreamState,
): LiveStreamState {
  const session = activeSession
  if (!session) return 'idle'
  if (session.state === 'stopping') return 'stopping'
  if (usbState === 'error' || rtmpState === 'error') return 'error'
  if (usbState === 'waiting' || usbState === 'switching' || usbState === 'idle') return 'waiting-usb'
  if (rtmpState === 'starting' || rtmpState === 'stopping') return 'starting'
  if (rtmpState === 'running') return 'running'
  return 'ready'
}

function statusMessage(state: LiveStreamState, usb: UsbAoaStatus, rtmpMessage: string): string {
  if (state === 'idle') return '输入接收未启动'
  if (state === 'waiting-usb') return usb.message
  if (state === 'ready') return '手机连接已就绪'
  if (state === 'starting') return '正在准备直播地址'
  if (state === 'running') return '本机直播地址已就绪'
  if (state === 'stopping') return '正在停止直播输出'
  return usb.error ?? rtmpMessage
}

export async function getLiveStreamStatus(): Promise<LiveStreamStatus> {
  const usb = activeSession?.receiver.status() ?? IDLE_USB_STATUS
  const rtmp = activeSession?.rtmp.status()
  const rtmpState = rtmp?.state ?? 'idle'
  const state = statusState(usb.state, rtmpState)
  const outputEnabled = rtmpState === 'starting' || rtmpState === 'running' || rtmpState === 'stopping'
  const outputReady = rtmpState === 'running'
  const error = activeSession?.error ?? usb.error ?? rtmp?.error ?? null

  return {
    state,
    platform: process.platform,
    controlReady: usb.controlReady,
    lastControlResult: activeSession?.lastControlResult ?? null,
    capabilities: activeSession?.capabilities ?? null,
    localPreviewUrl: activeSession?.livePreview.status().url ?? null,
    localPreviewError: activeSession?.livePreview.status().error ?? null,
    receiverConnected: usb.state === 'connected' || usb.state === 'streaming',
    transport: usb.transport,
    usbState: usb.state,
    usbMessage: usb.message,
    usbDeviceLabel: usb.deviceLabel,
    usbVendorId: usb.vendorId,
    usbProductId: usb.productId,
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
    outputEnabled,
    outputReady,
    pullUrl: rtmp?.pullUrl ?? null,
    outputAcceleration: rtmp?.acceleration ?? null,
    outputWarning: rtmp?.warning ?? null,
    outputMessage: rtmp?.error ?? (rtmp?.state === 'starting' ? rtmp.message : null),
    startedAt: activeSession?.startedAt ?? null,
    message: error ?? statusMessage(state, usb, rtmp?.message ?? ''),
    error,
  }
}

export function sendLiveStreamAudioFrame(frame: LiveStreamAudioInputFrame): void {
  const session = activeSession
  if (!session || session.audioSourceMode !== 'desktop') return
  session.rtmp.pushAudio(frame)
}

export async function setLiveStreamAudioSource(source: LiveStreamAudioSourceMode): Promise<void> {
  const session = activeSession
  if (session) session.audioSourceMode = source === 'desktop' ? 'desktop' : 'phone'
}

export function setLiveStreamAudioMonitor(enabled: boolean, target: WebContents): boolean {
  const session = activeSession
  if (!session) throw new Error('请先获取画面')
  session.audioMonitor = enabled ? target : null
  return Boolean(session.audioMonitor)
}

export async function sendLiveStreamControlCommand(command: LiveStreamControlCommand): Promise<string> {
  const session = activeSession
  if (!session) throw new Error('手机 USB 尚未连接')
  const requestId = randomUUID()
  await session.receiver.sendControl({ ...command, version: 1, requestId })
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
    const rtmp = new RtmpStreamService()
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
        rtmp.pushVideo(frame.body)
      }
      if (frame.streamType === USB_STREAM_AUDIO && frame.audio) {
        if (session.audioSourceMode === 'phone') rtmp.pushAudio(frame.audio)
        if (session.audioMonitor && !session.audioMonitor.isDestroyed()) {
          session.audioMonitor.send('live-stream:audio-monitor-frame', {
            sampleRate: frame.audio.sampleRate,
            channels: frame.audio.channels,
            sampleCount: frame.audio.sampleCount,
            pcm16Le: frame.audio.pcm16Le,
          })
        }
      }
    })
    const session: ActiveSession = {
      state: 'running',
      receiver,
      lastControlResult: null,
      capabilities: null,
      captureStream: process.env.LUNA_USB_CAPTURE_PATH
        ? createWriteStream(process.env.LUNA_USB_CAPTURE_PATH, { flags: 'w' })
        : null,
      livePreview,
      rtmp,
      audioSourceMode: 'phone',
      audioMonitor: null,
      startedAt: new Date().toISOString(),
      error: null,
    }
    activeSession = session
    receiver.start()
    logMainInfo('[直播流] USB AOA 接收已启动')
    return getLiveStreamStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

export function startLiveStreamOutput(options: LiveStreamOptions): Promise<LiveStreamStatus> {
  if (operation) return operation
  const task = (async () => {
    const session = activeSession
    if (!session) throw new Error('请先获取画面')
    try {
      await session.rtmp.start(options)
      session.error = null
      return getLiveStreamStatus()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      session.error = detail
      throw error
    }
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

export function stopLiveStreamOutput(): Promise<LiveStreamStatus> {
  if (operation) return operation
  const task = (async () => {
    const session = activeSession
    if (!session) return getLiveStreamStatus()
    await session.rtmp.stop()
    session.error = null
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
      await session.receiver.stop()
      await session.rtmp.stop()
      session.captureStream?.end()
      session.audioMonitor = null
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
