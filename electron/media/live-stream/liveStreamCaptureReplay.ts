import { appendFileSync, createReadStream, mkdirSync, statSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Writable } from 'node:stream'

import { LocalVideoStreamServer, type LocalVideoStreamStats } from '../../devices/common/localVideoStreamServer.ts'
import type { LiveStreamReplayStatus } from '../../../src/shared/types'
import {
  consumeFrames,
  USB_STREAM_AUDIO,
  USB_STREAM_VIDEO,
  type UsbMediaFrame,
} from './usbAoaProtocol.ts'
import {
  LIVE_STREAM_INPUT_CHANNELS,
  LIVE_STREAM_INPUT_SAMPLE_RATE,
  normalizeLiveStreamPcm,
} from './liveStreamAudio.ts'
import { buildLiveStreamFfmpegArgs } from './liveStreamFfmpegArgs.ts'

const AUDIO_GAP_MS = 100
const SILENCE_BLOCK_MS = 20
const DIAGNOSTICS_INTERVAL_MS = 5_000
const MAX_FFMPEG_INPUT_BUFFER_BYTES = 32 * 1024 * 1024

export interface LiveStreamCaptureReplayOptions {
  capturePath: string
  diagnosticsLogPath: string
  ffmpegPath: string
  port?: number
  loop?: boolean
  enhanceQuality?: boolean
  onLog?: (level: 'info' | 'warn' | 'error', event: string, details: Record<string, unknown>) => void
}

export class LiveStreamCaptureReplay {
  private readonly options: LiveStreamCaptureReplayOptions
  private readonly output: LocalVideoStreamServer
  private statusValue: LiveStreamReplayStatus
  private child: ChildProcess | null = null
  private videoInput: Writable | null = null
  private audioInput: Writable | null = null
  private running = false
  private stopRequested = false
  private startPromise: Promise<LiveStreamReplayStatus> | null = null
  private playbackPromise: Promise<void> | null = null
  private silenceTimer: NodeJS.Timeout | null = null
  private diagnosticsTimer: NodeJS.Timeout | null = null
  private lastAudioAt = 0
  private stderrTail = ''

  constructor(options: LiveStreamCaptureReplayOptions) {
    this.options = options
    this.output = new LocalVideoStreamServer('video/mp2t', options.port ?? 18_080, 0)
    this.statusValue = {
      state: 'idle',
      capturePath: options.capturePath,
      pullUrl: null,
      diagnosticsLogPath: options.diagnosticsLogPath,
      startedAt: null,
      videoFrames: 0,
      audioFrames: 0,
      outputBytes: 0,
      videoInputBufferedBytes: 0,
      audioInputBufferedBytes: 0,
      maxPlaybackLagMs: 0,
      activeClients: 0,
      totalConnections: 0,
      totalDisconnections: 0,
      publishedBytes: 0,
      droppedBytesNoClient: 0,
      droppedBytesBackpressure: 0,
      error: null,
    }
  }

  status(): LiveStreamReplayStatus {
    const serverStats = this.output.stats()
    return {
      ...this.statusValue,
      videoInputBufferedBytes: this.videoInput?.writableLength ?? 0,
      audioInputBufferedBytes: this.audioInput?.writableLength ?? 0,
      ...this.copyServerStats(serverStats),
    }
  }

  start(): Promise<LiveStreamReplayStatus> {
    if (this.statusValue.state === 'running') return Promise.resolve(this.status())
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async stop(): Promise<LiveStreamReplayStatus> {
    if (!this.playbackPromise) return this.status()
    this.stopRequested = true
    this.running = false
    this.statusValue = { ...this.statusValue, state: 'stopping' }
    await this.playbackPromise
    return this.status()
  }

  async waitForCompletion(): Promise<void> {
    await this.playbackPromise
  }

  private async startInternal(): Promise<LiveStreamReplayStatus> {
    const capture = statSync(this.options.capturePath)
    if (!capture.isFile() || capture.size === 0) throw new Error('采集样本为空或无法读取')
    mkdirSync(dirname(this.options.diagnosticsLogPath), { recursive: true })
    appendFileSync(this.options.diagnosticsLogPath, '')
    this.statusValue = {
      ...this.statusValue,
      state: 'starting',
      startedAt: new Date().toISOString(),
      error: null,
    }
    this.log('info', 'replay-start', {
      capturePath: this.options.capturePath,
      captureBytes: capture.size,
      loop: this.options.loop !== false,
      enhanceQuality: this.options.enhanceQuality === true,
    })

    const local = await this.output.start()
    const child = spawn(this.options.ffmpegPath, buildLiveStreamFfmpegArgs({
      enhanceQuality: this.options.enhanceQuality === true,
    }), { stdio: ['pipe', 'pipe', 'pipe', 'pipe'], windowsHide: true })
    const videoInput = child.stdin
    const audioInput = child.stdio[3] as Writable | null
    if (!videoInput || !audioInput || !child.stdout || !child.stderr) {
      child.kill('SIGTERM')
      await this.output.stop()
      throw new Error('无法创建 FFmpeg 输入输出')
    }

    this.child = child
    this.videoInput = videoInput
    this.audioInput = audioInput
    this.statusValue = { ...this.statusValue, pullUrl: local.url }
    child.stdout.on('data', (chunk: Buffer) => {
      this.statusValue = { ...this.statusValue, outputBytes: this.statusValue.outputBytes + chunk.length }
      this.output.publish(chunk)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_000)
      this.log('warn', 'ffmpeg-stderr', { detail: chunk.trim() })
    })
    child.once('close', (code, signal) => {
      this.running = false
      if (!this.stopRequested && this.statusValue.state === 'running' && code !== 0) {
        this.setError(this.stderrTail.trim() || `FFmpeg exited with code ${code ?? signal ?? 'unknown'}`)
      }
    })

    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
    } catch (error) {
      this.child = null
      this.videoInput = null
      this.audioInput = null
      await this.output.stop()
      throw error
    }

    this.running = true
    this.lastAudioAt = Date.now()
    this.statusValue = { ...this.statusValue, state: 'running' }
    this.startSilenceTimer()
    this.diagnosticsTimer = setInterval(() => this.logSample(), DIAGNOSTICS_INTERVAL_MS)
    this.playbackPromise = this.runPlayback()
    return this.status()
  }

  private async runPlayback(): Promise<void> {
    const silence = Buffer.alloc(
      LIVE_STREAM_INPUT_SAMPLE_RATE * SILENCE_BLOCK_MS / 1_000 * LIVE_STREAM_INPUT_CHANNELS * 2,
    )
    try {
      for (let index = 0; index < 10; index += 1) this.writeInput(this.audioInput, silence)
      let loopBase = performance.now() + 250
      while (this.running) {
        let firstTimestamp: bigint | null = null
        let lastTimestamp: bigint | null = null
        for await (const frame of this.readCaptureFrames()) {
          if (!this.running) break
          if (frame.streamType !== USB_STREAM_VIDEO && frame.streamType !== USB_STREAM_AUDIO) continue
          const captureStartTimestamp: bigint = firstTimestamp ?? frame.timestampUs
          firstTimestamp = captureStartTimestamp
          lastTimestamp = frame.timestampUs
          const timestampDelta = frame.timestampUs >= captureStartTimestamp
            ? Number(frame.timestampUs - captureStartTimestamp) / 1_000
            : 0
          const target = loopBase + timestampDelta
          await this.waitUntil(target)
          if (!this.running) break
          this.statusValue = {
            ...this.statusValue,
            maxPlaybackLagMs: Math.max(this.statusValue.maxPlaybackLagMs, performance.now() - target),
          }

          if (frame.streamType === USB_STREAM_VIDEO) {
            this.writeInput(this.videoInput, frame.body)
            this.statusValue = { ...this.statusValue, videoFrames: this.statusValue.videoFrames + 1 }
          } else if (frame.audio) {
            const pcm = normalizeLiveStreamPcm({
              sampleRate: frame.audio.sampleRate,
              channels: frame.audio.channels,
              sampleCount: frame.audio.sampleCount,
              pcm16Le: frame.audio.pcm16Le,
            })
            if (pcm) {
              this.writeInput(this.audioInput, pcm)
              this.statusValue = { ...this.statusValue, audioFrames: this.statusValue.audioFrames + 1 }
              this.lastAudioAt = Date.now()
            }
          }
        }

        if (firstTimestamp === null || lastTimestamp === null || this.statusValue.videoFrames === 0) {
          if (this.running) throw new Error('采集样本中没有可播放的视频帧')
          break
        }
        if (!this.running || this.options.loop === false) break
        const durationMs = Math.max(0, Number(lastTimestamp - firstTimestamp) / 1_000)
        loopBase = Math.max(loopBase + durationMs, performance.now() + 20)
      }
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error))
    } finally {
      await this.cleanup()
    }

    if (this.statusValue.state !== 'error') {
      this.statusValue = { ...this.statusValue, state: 'stopped', pullUrl: null }
      this.log('info', 'replay-stopped', { ...this.status() })
    }
  }

  private async *readCaptureFrames() {
    let pending = Buffer.alloc(0)
    const stream = createReadStream(this.options.capturePath) as unknown as AsyncIterable<Buffer>
    for await (const chunk of stream) {
      const frames: UsbMediaFrame[] = []
      pending = consumeFrames(Buffer.concat([pending, chunk]), (frame) => frames.push(frame), (reason) => {
        this.log('warn', 'invalid-capture-frame', { reason })
      })
      for (const frame of frames) yield frame
    }
    if (pending.length > 0) this.log('warn', 'capture-trailing-bytes', { bytes: pending.length })
  }

  private writeInput(stream: Writable | null, data: Buffer): void {
    if (!stream || stream.destroyed || !stream.writable) throw new Error('FFmpeg 输入已关闭')
    stream.write(data)
    if (stream.writableLength > MAX_FFMPEG_INPUT_BUFFER_BYTES) {
      throw new Error('FFmpeg 处理速度低于采集速度，输入积压超过限制')
    }
  }

  private async waitUntil(target: number): Promise<void> {
    while (this.running) {
      const remaining = target - performance.now()
      if (remaining <= 0) return
      await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 100)))
    }
  }

  private startSilenceTimer(): void {
    const audioInput = this.audioInput
    if (!audioInput) return
    const silence = Buffer.alloc(
      LIVE_STREAM_INPUT_SAMPLE_RATE * SILENCE_BLOCK_MS / 1_000 * LIVE_STREAM_INPUT_CHANNELS * 2,
    )
    this.silenceTimer = setInterval(() => {
      if (!this.running || Date.now() - this.lastAudioAt < AUDIO_GAP_MS || audioInput.writableNeedDrain) return
      try {
        this.writeInput(audioInput, silence)
      } catch (error) {
        this.setError(error instanceof Error ? error.message : String(error))
        this.running = false
      }
    }, SILENCE_BLOCK_MS)
  }

  private async cleanup(): Promise<void> {
    this.running = false
    if (this.silenceTimer) clearInterval(this.silenceTimer)
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer)
    this.silenceTimer = null
    this.diagnosticsTimer = null
    for (const input of [this.videoInput, this.audioInput]) {
      if (input && !input.destroyed && input.writable) input.end()
    }
    const child = this.child
    if (child && child.exitCode == null && child.signalCode == null) {
      await Promise.race([
        once(child, 'close'),
        new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
      ])
      if (child.exitCode == null && child.signalCode == null) {
        child.kill('SIGTERM')
        await Promise.race([
          once(child, 'close'),
          new Promise<void>((resolve) => setTimeout(() => {
            child.kill('SIGKILL')
            resolve()
          }, 1_500)),
        ])
      }
    }
    await this.output.stop()
    this.child = null
    this.videoInput = null
    this.audioInput = null
  }

  private logSample(): void {
    this.log('info', 'replay-sample', { ...this.status() })
  }

  private log(
    level: 'info' | 'warn' | 'error',
    event: string,
    details: Record<string, unknown>,
  ): void {
    const entry = { at: new Date().toISOString(), level, event, ...details }
    try {
      appendFileSync(this.options.diagnosticsLogPath, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // Diagnostics must not interrupt video playback.
    }
    this.options.onLog?.(level, event, details)
  }

  private setError(error: string): void {
    if (this.statusValue.state === 'error') return
    this.statusValue = { ...this.statusValue, state: 'error', error, pullUrl: null }
    this.log('error', 'replay-error', { error })
  }

  private copyServerStats(stats: LocalVideoStreamStats) {
    return {
      activeClients: stats.activeClients,
      totalConnections: stats.totalConnections,
      totalDisconnections: stats.totalDisconnections,
      publishedBytes: stats.publishedBytes,
      droppedBytesNoClient: stats.droppedBytesNoClient,
      droppedBytesBackpressure: stats.droppedBytesBackpressure,
    }
  }
}
