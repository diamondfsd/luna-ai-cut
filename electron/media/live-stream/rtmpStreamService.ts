import { spawn, type ChildProcess } from 'node:child_process'
import type { Writable } from 'node:stream'

import type { LiveStreamAudioInputFrame } from '../../../src/shared/types'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'

const INPUT_SAMPLE_RATE = 48_000
const INPUT_CHANNELS = 1
const OUTPUT_AUDIO_CHANNELS = 2
const SILENCE_BLOCK_MS = 20
const AUDIO_GAP_MS = 100

export type RtmpStreamState = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

export interface RtmpStreamStatus {
  state: RtmpStreamState
  videoFrames: number
  videoBytes: number
  audioFrames: number
  audioBytes: number
  message: string
  error: string | null
}

interface RtmpTarget {
  value: string
  displayValue: string
}

interface ActiveRtmpProcess {
  child: ChildProcess
  videoInput: Writable
  audioInput: Writable
}

function normalizeRtmpTarget(rtmpUrl: string, streamKey = ''): RtmpTarget {
  const server = rtmpUrl.trim()
  const key = streamKey.trim().replace(/^\/+/, '')
  if (!server) throw new Error('请输入推流地址')

  let parsed: URL
  try {
    parsed = new URL(server)
  } catch {
    throw new Error('推流地址格式无效')
  }
  if (parsed.protocol !== 'rtmp:' && parsed.protocol !== 'rtmps:') {
    throw new Error('推流地址必须以 rtmp:// 或 rtmps:// 开头')
  }
  if (/\s/.test(server) || /\s/.test(key)) throw new Error('推流地址和直播码不能包含空格')
  if (key && parsed.search) throw new Error('完整推流地址已包含参数，请清空直播码')

  const value = key ? `${server.replace(/\/+$/, '')}/${key}` : server
  return { value, displayValue: `${parsed.protocol}//${parsed.host}` }
}

function clampSample(value: number): number {
  return Math.max(-32_768, Math.min(32_767, Math.round(value)))
}

function normalizePcm(frame: LiveStreamAudioInputFrame): Buffer | null {
  const sampleRate = Math.round(frame.sampleRate)
  const channels = Math.round(frame.channels)
  const sampleCount = Math.round(frame.sampleCount)
  const source = Buffer.from(frame.pcm16Le)
  if (sampleRate <= 0 || channels <= 0 || sampleCount <= 0 || source.length !== sampleCount * channels * 2) {
    return null
  }
  if (sampleRate === INPUT_SAMPLE_RATE && channels === INPUT_CHANNELS) return source

  const outputSampleCount = Math.max(1, Math.round(sampleCount * INPUT_SAMPLE_RATE / sampleRate))
  const output = Buffer.allocUnsafe(outputSampleCount * INPUT_CHANNELS * 2)
  for (let outputIndex = 0; outputIndex < outputSampleCount; outputIndex += 1) {
    const sourcePosition = outputIndex * sampleRate / INPUT_SAMPLE_RATE
    const firstIndex = Math.min(sampleCount - 1, Math.floor(sourcePosition))
    const secondIndex = Math.min(sampleCount - 1, firstIndex + 1)
    const mix = sourcePosition - firstIndex
    let sample = 0
    for (let channel = 0; channel < channels; channel += 1) {
      const first = source.readInt16LE((firstIndex * channels + channel) * 2)
      const second = source.readInt16LE((secondIndex * channels + channel) * 2)
      sample += first + (second - first) * mix
    }
    output.writeInt16LE(clampSample(sample / channels), outputIndex * 2)
  }
  return output
}

function safeError(value: string, target: RtmpTarget, streamKey: string): string {
  let detail = value.trim()
  if (target.value) detail = detail.split(target.value).join('***')
  if (streamKey.trim()) detail = detail.split(streamKey.trim()).join('***')
  return detail
}

export class RtmpStreamService {
  private active: ActiveRtmpProcess | null = null
  private statusValue: RtmpStreamStatus = {
    state: 'idle',
    videoFrames: 0,
    videoBytes: 0,
    audioFrames: 0,
    audioBytes: 0,
    message: '尚未开始推流',
    error: null,
  }
  private lastAudioAt = 0
  private silenceTimer: NodeJS.Timeout | null = null

  status(): RtmpStreamStatus {
    return { ...this.statusValue }
  }

  async start(rtmpUrl: string, streamKey = ''): Promise<RtmpStreamStatus> {
    await this.stop()
    const target = normalizeRtmpTarget(rtmpUrl, streamKey)
    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-thread_queue_size', '512',
      '-f', 'hevc',
      '-framerate', '30',
      '-i', 'pipe:0',
      '-thread_queue_size', '512',
      '-f', 's16le',
      '-ar', String(INPUT_SAMPLE_RATE),
      '-ac', String(INPUT_CHANNELS),
      '-i', 'pipe:3',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-vf', "scale=w='if(gt(iw,ih),min(1920,iw),-2)':h='if(gt(iw,ih),-2,min(1920,ih))'",
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-level:v', '4.1',
      '-r', '30',
      '-g', '60',
      '-keyint_min', '60',
      '-sc_threshold', '0',
      '-b:v', '6000k',
      '-maxrate', '6000k',
      '-bufsize', '12000k',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', String(INPUT_SAMPLE_RATE),
      '-ac', String(OUTPUT_AUDIO_CHANNELS),
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      target.value,
    ]
    const child = spawn(getFfmpegPath(), args, {
      stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const videoInput = child.stdin
    const audioInput = child.stdio[3] as Writable | null
    if (!videoInput || !audioInput) {
      child.kill('SIGTERM')
      throw new Error('无法创建推流输入')
    }

    this.active = { child, videoInput, audioInput }
    this.lastAudioAt = 0
    this.statusValue = {
      state: 'starting',
      videoFrames: 0,
      videoBytes: 0,
      audioFrames: 0,
      audioBytes: 0,
      message: '正在连接推流服务',
      error: null,
    }

    let stderrTail = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      const detail = safeError(chunk, target, streamKey)
      if (detail) stderrTail = detail.slice(-2_000)
    })
    child.once('error', (error) => {
      if (this.active?.child !== child) return
      this.statusValue = {
        ...this.statusValue,
        state: 'error',
        message: '推流连接失败',
        error: safeError(error.message, target, streamKey),
      }
    })
    child.once('close', (code, signal) => {
      if (this.active?.child !== child) return
      this.stopSilenceTimer()
      this.active = null
      const stopped = code === 0 || signal === 'SIGTERM' || this.statusValue.state === 'stopping'
      this.statusValue = {
        ...this.statusValue,
        state: stopped ? 'idle' : 'error',
        message: stopped ? '推流已停止' : '推流意外停止',
        error: stopped ? null : stderrTail.trim() || `推流进程退出码 ${code ?? 'unknown'}`,
      }
    })

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
      throw error
    }
    if (this.active?.child !== child) throw new Error(this.statusValue.error ?? '推流启动失败')

    this.statusValue = {
      ...this.statusValue,
      state: 'running',
      message: '正在直播',
      error: null,
    }
    this.startSilenceTimer()
    logMainInfo('[直播推流] 已开始', { rtmpServer: target.displayValue })
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
    }
  }

  pushAudio(frame: LiveStreamAudioInputFrame): void {
    if (!this.active) return
    const pcm = normalizePcm(frame)
    if (!pcm) return
    this.lastAudioAt = Date.now()
    if (this.write(this.active.audioInput, pcm)) {
      this.statusValue = {
        ...this.statusValue,
        audioFrames: this.statusValue.audioFrames + 1,
        audioBytes: this.statusValue.audioBytes + pcm.length,
      }
    }
  }

  async stop(): Promise<RtmpStreamStatus> {
    const active = this.active
    this.active = null
    this.stopSilenceTimer()
    if (active) {
      this.statusValue = { ...this.statusValue, state: 'stopping', message: '正在停止推流', error: null }
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
    this.statusValue = {
      state: 'idle',
      videoFrames: 0,
      videoBytes: 0,
      audioFrames: 0,
      audioBytes: 0,
      message: '尚未开始推流',
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
      logMainWarn('[直播推流] 写入媒体数据失败', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  private startSilenceTimer(): void {
    this.stopSilenceTimer()
    const silence = Buffer.alloc(INPUT_SAMPLE_RATE * SILENCE_BLOCK_MS / 1_000 * INPUT_CHANNELS * 2)
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
}
