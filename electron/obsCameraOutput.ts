import { spawn, type ChildProcess } from 'node:child_process'

import type { CameraBridgeFrame } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'

const OBS_PORT = 49999
const VIDEO_CONFIG_TYPE = 2
const VIDEO_TYPE = 3
const KEYFRAME_FLAG = 1
const DEFAULT_FPS = 30

export const OBS_CAMERA_STREAM_URL = `udp://127.0.0.1:${OBS_PORT}`

export type ObsCameraOutputStatus = {
  supported: boolean
  state: 'unsupported' | 'stopped' | 'starting' | 'running' | 'error'
  streamUrl: string
  codec: string
  frames: number
  droppedFrames: number
  error: string | null
}

const EMPTY_STATUS: ObsCameraOutputStatus = {
  supported: process.platform === 'darwin',
  state: process.platform === 'darwin' ? 'stopped' : 'unsupported',
  streamUrl: OBS_CAMERA_STREAM_URL,
  codec: 'H.264',
  frames: 0,
  droppedFrames: 0,
  error: null,
}

type VideoConfig = {
  codec?: string
  fps?: number
  csd0?: string
  csd1?: string
}

class ObsCameraOutput {
  private status: ObsCameraOutputStatus = { ...EMPTY_STATUS }
  private child: ChildProcess | null = null
  private inputFormat = 'h264'
  private fps = DEFAULT_FPS
  private parameterSets: Buffer[] = []
  private prependParameterSets = true
  private generation = 0
  private stopping = false
  private listeners = new Set<(status: ObsCameraOutputStatus) => void>()
  private lastStatusAt = 0

  getStatus(): ObsCameraOutputStatus {
    return this.status
  }

  subscribe(listener: (status: ObsCameraOutputStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  start(config?: VideoConfig): ObsCameraOutputStatus {
    if (!this.status.supported) return this.update({ state: 'unsupported', error: 'OBS 输出当前只支持 macOS' }, true)
    if (this.status.state === 'running' || this.status.state === 'starting') return this.status

    this.stopping = false
    this.status = {
      ...this.status,
      state: 'starting',
      frames: 0,
      droppedFrames: 0,
      error: null,
    }
    this.applyConfig(config)
    this.spawnProcess()
    return this.status
  }

  stop(): ObsCameraOutputStatus {
    this.stopping = true
    this.generation += 1
    const child = this.child
    this.child = null
    if (child && !child.killed) child.kill('SIGTERM')
    return this.update({ state: this.status.supported ? 'stopped' : 'unsupported', error: null }, true)
  }

  writeFrame(frame: CameraBridgeFrame): void {
    if (frame.type === VIDEO_CONFIG_TYPE) {
      this.applyConfig(parseVideoConfig(frame.payload))
      return
    }
    if (frame.type !== VIDEO_TYPE || this.status.state !== 'running') return

    const input = this.child?.stdin
    if (!input || input.destroyed || !input.writable) return
    if (input.writableNeedDrain && (frame.flags & KEYFRAME_FLAG) === 0) {
      this.update({ droppedFrames: this.status.droppedFrames + 1 })
      return
    }
    try {
      const payload = Buffer.from(frame.payload)
      const keyframe = (frame.flags & KEYFRAME_FLAG) !== 0
      const parameterSets = keyframe && this.prependParameterSets ? this.parameterSets : []
      input.write(parameterSets.length > 0 ? Buffer.concat([...parameterSets, payload]) : payload)
      if (parameterSets.length > 0) this.prependParameterSets = false
      this.update({ frames: this.status.frames + 1 })
    } catch {
      this.update({ droppedFrames: this.status.droppedFrames + 1 })
    }
  }

  private applyConfig(config: VideoConfig | null | undefined): void {
    if (!config) return
    const nextFormat = ffmpegInputFormat(config.codec)
    const nextFps = Number.isFinite(config.fps) && (config.fps ?? 0) > 0 ? Math.round(config.fps ?? DEFAULT_FPS) : DEFAULT_FPS
    const changed = nextFormat !== this.inputFormat || nextFps !== this.fps
    this.inputFormat = nextFormat
    this.fps = nextFps
    const parameterSets = [config.csd0, config.csd1]
      .map((value) => value ? decodeParameterSet(value) : null)
      .filter((value): value is Buffer => value !== null)
    if (parameterSets.length > 0) {
      this.parameterSets = parameterSets
      this.prependParameterSets = true
    }
    this.update({ codec: nextFormat === 'hevc' ? 'H.265' : 'H.264' })
    if (changed && this.status.state === 'running') {
      this.stopProcess()
      this.spawnProcess()
    }
  }

  private spawnProcess(): void {
    const generation = ++this.generation
    const child = spawn(getFfmpegPath(), [
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', '+genpts',
      '-use_wallclock_as_timestamps', '1',
      '-f', this.inputFormat,
      '-r', String(this.fps),
      '-i', 'pipe:0',
      '-an',
      '-c:v', 'copy',
      '-muxdelay', '0',
      '-flush_packets', '1',
      '-mpegts_flags', 'resend_headers',
      '-f', 'mpegts',
      OBS_CAMERA_STREAM_URL,
    ], { stdio: ['pipe', 'ignore', 'pipe'] })
    this.child = child
    this.update({ state: 'running' }, true)

    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000)
    })
    child.stdin?.on('error', () => {
      // The close handler reports the process failure when FFmpeg exits.
    })
    child.once('error', (error) => {
      if (generation !== this.generation || this.stopping) return
      this.child = null
      this.update({ state: 'error', error: `OBS 输出进程启动失败：${error.message}` }, true)
    })
    child.once('close', (code, signal) => {
      if (generation !== this.generation || this.stopping) return
      this.child = null
      this.update({
        state: 'error',
        error: stderr.trim() || `OBS 输出进程已退出 (${code ?? signal ?? 'unknown'})`,
      }, true)
    })
  }

  private stopProcess(): void {
    this.generation += 1
    const child = this.child
    this.child = null
    if (child && !child.killed) child.kill('SIGTERM')
  }

  private update(patch: Partial<ObsCameraOutputStatus>, force = false): ObsCameraOutputStatus {
    this.status = { ...this.status, ...patch }
    const now = Date.now()
    if (force || now - this.lastStatusAt >= 250) {
      this.lastStatusAt = now
      for (const listener of this.listeners) listener(this.status)
    }
    return this.status
  }
}

function parseVideoConfig(payload: Uint8Array): VideoConfig | null {
  try {
    const value = JSON.parse(Buffer.from(payload).toString('utf8')) as VideoConfig
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function decodeParameterSet(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, 'base64')
    if (decoded.length === 0) return null
    if (hasAnnexBStartCode(decoded)) return decoded
    return Buffer.concat([Buffer.from([0, 0, 0, 1]), decoded])
  } catch {
    return null
  }
}

function hasAnnexBStartCode(value: Buffer): boolean {
  return value.length >= 4
    && value[0] === 0
    && value[1] === 0
    && (value[2] === 1 || (value[2] === 0 && value[3] === 1))
}

function ffmpegInputFormat(codec: string | undefined): 'h264' | 'hevc' {
  return /265|hevc|hev1|hvc1/i.test(codec ?? '') ? 'hevc' : 'h264'
}

export const obsCameraOutput = new ObsCameraOutput()
