import { spawn, type ChildProcess } from 'node:child_process'
import type { Writable } from 'node:stream'

import type {
  LiveStreamAudioInputFrame,
  LiveStreamOptions,
  LiveStreamOutputAcceleration,
} from '../../../src/shared/types'
import { LocalVideoStreamServer } from '../../devices/common/localVideoStreamServer'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'
import {
  LIVE_STREAM_INPUT_CHANNELS,
  LIVE_STREAM_INPUT_SAMPLE_RATE,
  normalizeLiveStreamPcm,
} from './liveStreamAudio'
import { buildLiveStreamFfmpegArgs } from './liveStreamFfmpegArgs'

const INPUT_SAMPLE_RATE = LIVE_STREAM_INPUT_SAMPLE_RATE
const INPUT_CHANNELS = LIVE_STREAM_INPUT_CHANNELS
const SILENCE_BLOCK_MS = 20
const AUDIO_GAP_MS = 100
const INITIAL_SILENCE_BLOCKS = 10
const LIVE_STREAM_BASE_PORT = 18_080
const LIVE_STREAM_PRE_CLIENT_BUFFER_BYTES = 0
const SOFTWARE_FALLBACK_WARNING = '未检测到可用硬件解码，已切换软件处理，可能出现卡顿'

interface HardwareProbeResult {
  decoder: string
}

function hardwareCandidates(): string[] {
  if (process.platform === 'darwin') return ['videotoolbox']
  if (process.platform === 'win32') return ['d3d12va', 'd3d11va', 'dxva2']
  return ['vaapi', 'cuda', 'qsv']
}

function runFfmpegProbe(
  ffmpegPath: string,
  args: string[],
  timeoutMs = 2_500,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let output = ''
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, output })
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(false)
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.once('error', () => finish(false))
    child.once('close', (code) => finish(code === 0))
  })
}

async function probeHardwareDecoder(ffmpegPath: string): Promise<HardwareProbeResult | null> {
  try {
    const [hardwareList, decoderList] = await Promise.all([
      runFfmpegProbe(ffmpegPath, ['-hide_banner', '-hwaccels']),
      runFfmpegProbe(ffmpegPath, ['-hide_banner', '-decoders']),
    ])
    if (!hardwareList.ok || !decoderList.ok || !/\bhevc\b/.test(decoderList.output)) return null

    for (const decoder of hardwareCandidates()) {
      if (!new RegExp(`\\b${decoder}\\b`).test(hardwareList.output)) continue
      const initialized = await runFfmpegProbe(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        '-init_hw_device', decoder,
        '-f', 'lavfi',
        '-i', 'color=c=black:s=16x16:d=0.1',
        '-frames:v', '1',
        '-f', 'null',
        '-',
      ])
      if (initialized.ok) return { decoder }
    }
  } catch {
    // Capability detection is best effort; software processing remains available.
  }
  return null
}

export type RtmpStreamState = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

export interface RtmpStreamStatus {
  state: RtmpStreamState
  videoFrames: number
  videoBytes: number
  audioFrames: number
  audioBytes: number
  pullUrl: string | null
  acceleration: LiveStreamOutputAcceleration | null
  warning: string | null
  message: string
  error: string | null
}

interface ActiveRtmpProcess {
  child: ChildProcess
  videoInput: Writable
  audioInput: Writable
}

export class RtmpStreamService {
  private readonly output = new LocalVideoStreamServer(
    'video/mp2t',
    LIVE_STREAM_BASE_PORT,
    LIVE_STREAM_PRE_CLIENT_BUFFER_BYTES,
  )
  private active: ActiveRtmpProcess | null = null
  private statusValue: RtmpStreamStatus = {
    state: 'idle',
    videoFrames: 0,
    videoBytes: 0,
    audioFrames: 0,
    audioBytes: 0,
    pullUrl: null,
    acceleration: null,
    warning: null,
    message: '尚未开始输出',
    error: null,
  }
  private lastAudioAt = 0
  private silenceTimer: NodeJS.Timeout | null = null
  private diagnosticsTimer: NodeJS.Timeout | null = null
  private droppedVideoInputFrames = 0
  private droppedAudioInputFrames = 0

  status(): RtmpStreamStatus {
    return { ...this.statusValue }
  }

  async start(options: LiveStreamOptions): Promise<RtmpStreamStatus> {
    await this.stop()
    const enhanceQuality = options.enhanceQuality === true
    const ffmpegPath = getFfmpegPath()
    const hardware = enhanceQuality ? await probeHardwareDecoder(ffmpegPath) : null
    const local = await this.output.start()
    const args = buildLiveStreamFfmpegArgs(options, hardware?.decoder ?? null)
    const child = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const videoInput = child.stdin
    const audioInput = child.stdio[3] as Writable | null
    if (!videoInput || !audioInput) {
      child.kill('SIGTERM')
      await this.output.stop()
      throw new Error('无法创建推流输入')
    }

    this.active = { child, videoInput, audioInput }
    this.lastAudioAt = 0
    this.droppedVideoInputFrames = 0
    this.droppedAudioInputFrames = 0
    this.statusValue = {
      state: 'starting',
      videoFrames: 0,
      videoBytes: 0,
      audioFrames: 0,
      audioBytes: 0,
      pullUrl: local.url,
      acceleration: enhanceQuality ? (hardware ? 'hardware' : 'software') : 'passthrough',
      warning: enhanceQuality && !hardware ? SOFTWARE_FALLBACK_WARNING : null,
      message: '正在准备本机拉流地址',
      error: null,
    }

    let stderrTail = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      const detail = chunk.trim()
      if (detail) {
        stderrTail = `${stderrTail}${detail}`.slice(-4_000)
        logMainWarn('[直播输出] FFmpeg 输出', { detail })
      }
    })
    child.once('error', (error) => {
      if (this.active?.child !== child) return
      this.statusValue = {
        ...this.statusValue,
        state: 'error',
        pullUrl: null,
        acceleration: null,
        warning: null,
        message: '直播输出失败',
        error: error.message,
      }
    })
    child.once('close', (code, signal) => {
      if (this.active?.child !== child) return
      this.stopSilenceTimer()
      this.stopDiagnosticsTimer()
      this.active = null
      const stopped = code === 0 || signal === 'SIGTERM' || this.statusValue.state === 'stopping'
      this.statusValue = {
        ...this.statusValue,
        state: stopped ? 'idle' : 'error',
        pullUrl: null,
        acceleration: null,
        warning: null,
        message: stopped ? '直播输出已停止' : '直播输出意外停止',
        error: stopped ? null : stderrTail.trim() || `输出进程退出码 ${code ?? 'unknown'}`,
      }
      if (!stopped) logMainWarn('[直播输出] FFmpeg 意外退出', { code, signal, detail: stderrTail.trim() })
      if (!stopped) {
        void this.output.stop().catch((error: unknown) => {
          logMainWarn('[直播输出] 本机地址关闭失败', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    })
    child.stdout?.on('data', (chunk: Buffer) => this.output.publish(chunk))

    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
    } catch (error) {
      if (this.active?.child === child) this.active = null
      videoInput.destroy()
      audioInput.destroy()
      if (child.exitCode == null) child.kill('SIGTERM')
      await this.output.stop()
      throw error
    }
    if (this.active?.child !== child) throw new Error(this.statusValue.error ?? '推流启动失败')

    this.statusValue = {
      ...this.statusValue,
      state: 'running',
      message: '本机拉流地址已就绪',
      error: null,
    }
    this.startSilenceTimer()
    this.startDiagnosticsTimer()
    logMainInfo('[直播输出] 本机拉流地址已启动', {
      url: local.url,
      enhanceQuality,
      acceleration: enhanceQuality ? hardware?.decoder ?? 'software' : 'passthrough',
    })
    return this.status()
  }

  pushVideo(frame: Buffer): void {
    if (!this.active || frame.length === 0) return
    if (this.write(this.active.videoInput, frame)) {
      this.statusValue = {
        ...this.statusValue,
        videoFrames: this.statusValue.videoFrames + 1,
        videoBytes: this.statusValue.videoBytes + frame.length,
      }
    } else this.droppedVideoInputFrames += 1
  }

  pushAudio(frame: LiveStreamAudioInputFrame): void {
    if (!this.active) return
    const pcm = normalizeLiveStreamPcm(frame)
    if (!pcm) return
    this.lastAudioAt = Date.now()
    if (this.write(this.active.audioInput, pcm)) {
      this.statusValue = {
        ...this.statusValue,
        audioFrames: this.statusValue.audioFrames + 1,
        audioBytes: this.statusValue.audioBytes + pcm.length,
      }
    } else this.droppedAudioInputFrames += 1
  }

  async stop(): Promise<RtmpStreamStatus> {
    const active = this.active
    this.logDiagnostics('stop')
    this.active = null
    this.stopSilenceTimer()
    this.stopDiagnosticsTimer()
    if (active) {
      this.statusValue = { ...this.statusValue, state: 'stopping', message: '正在停止直播输出', error: null }
      active.videoInput.end()
      active.audioInput.end()
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        active.child.once('close', finish)
        active.child.kill('SIGTERM')
        setTimeout(() => {
          if (!settled) active.child.kill('SIGKILL')
        }, 1_500).unref()
      })
    }
    await this.output.stop()
    this.statusValue = {
      state: 'idle',
      videoFrames: 0,
      videoBytes: 0,
      audioFrames: 0,
      audioBytes: 0,
      pullUrl: null,
      acceleration: null,
      warning: null,
      message: '尚未开始输出',
      error: null,
    }
    return this.status()
  }

  private write(stream: Writable, data: Buffer): boolean {
    if (stream.destroyed || !stream.writable || stream.writableNeedDrain) return false
    try {
      stream.write(data)
      return true
    } catch (error) {
      logMainWarn('[直播输出] 写入媒体数据失败', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  private startSilenceTimer(): void {
    this.stopSilenceTimer()
    const silence = Buffer.alloc(INPUT_SAMPLE_RATE * SILENCE_BLOCK_MS / 1_000 * INPUT_CHANNELS * 2)

    // Seed the audio clock immediately. Waiting for the first phone packet lets
    // the MPEG-TS muxer publish video several seconds ahead of audio.
    for (let index = 0; index < INITIAL_SILENCE_BLOCKS; index += 1) {
      if (!this.active) break
      this.write(this.active.audioInput, silence)
    }
    this.silenceTimer = setInterval(() => {
      if (!this.active || Date.now() - this.lastAudioAt < AUDIO_GAP_MS) return
      this.write(this.active.audioInput, silence)
    }, SILENCE_BLOCK_MS)
  }

  private stopSilenceTimer(): void {
    if (!this.silenceTimer) return
    clearInterval(this.silenceTimer)
    this.silenceTimer = null
  }

  private startDiagnosticsTimer(): void {
    this.stopDiagnosticsTimer()
    this.diagnosticsTimer = setInterval(() => this.logDiagnostics('sample'), 5_000)
  }

  private stopDiagnosticsTimer(): void {
    if (!this.diagnosticsTimer) return
    clearInterval(this.diagnosticsTimer)
    this.diagnosticsTimer = null
  }

  private logDiagnostics(phase: 'sample' | 'stop'): void {
    const active = this.active
    logMainInfo('[直播输出] 传输诊断', {
      phase,
      videoFramesAccepted: this.statusValue.videoFrames,
      audioFramesAccepted: this.statusValue.audioFrames,
      videoInputDroppedFrames: this.droppedVideoInputFrames,
      audioInputDroppedFrames: this.droppedAudioInputFrames,
      videoInputBufferedBytes: active?.videoInput.writableLength ?? 0,
      audioInputBufferedBytes: active?.audioInput.writableLength ?? 0,
      ...this.output.stats(),
    })
  }
}
