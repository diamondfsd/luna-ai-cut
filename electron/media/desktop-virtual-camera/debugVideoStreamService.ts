import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { Socket } from 'node:net'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { getFfmpegPath, probeMedia } from '../../platform/ffmpeg/pipeline'

const VIDEO_STREAM_TYPE = 0x20

function encodeVideoFrame(sequence: number, payload: Buffer): Buffer {
  const rawLength = 9 + payload.length
  const frame = Buffer.allocUnsafe(12 + rawLength + 4)
  Buffer.from([0x55, 0x43, 0x44, 0x32]).copy(frame, 0)
  frame[4] = 0x01
  frame[5] = 0x0c
  frame[6] = 0x01
  frame[7] = sequence & 0xff
  frame.writeUInt32LE(rawLength, 8)
  frame[12] = VIDEO_STREAM_TYPE
  frame.writeBigUInt64LE(BigInt(Date.now()) * 1_000n, 13)
  payload.copy(frame, 21)
  frame.fill(0, frame.length - 4)
  return frame
}

function splitAccessUnits(data: Buffer): { units: Buffer[]; remainder: Buffer } {
  const starts: number[] = []
  for (let index = 0; index + 3 < data.length;) {
    if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1) {
      starts.push(index)
      index += 3
    } else if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 0 && data[index + 3] === 1) {
      starts.push(index)
      index += 4
    } else index += 1
  }
  if (starts.length < 2) return { units: [], remainder: data }
  const nals = starts.map((start, index) => data.subarray(start, starts[index + 1] ?? data.length))
  const groups: Buffer[][] = []
  let current: Buffer[] = []
  for (const nal of nals) {
    const headerLength = nal[2] === 1 ? 3 : 4
    const nalType = ((nal[headerLength] ?? 0) >> 1) & 0x3f
    if (nalType === 32 && current.length > 0) {
      groups.push(current)
      current = []
    }
    current.push(nal)
  }
  if (current.length > 0) groups.push(current)
  if (groups.length < 2) return { units: [], remainder: data }
  const units = groups.slice(0, -1).map((group) => Buffer.concat(group))
  const remainder = Buffer.concat(groups[groups.length - 1]!)
  return { units, remainder }
}

export class DebugVideoStreamService {
  private child: ChildProcess | null = null
  private stopped = false
  private sequence = 0
  private pending = Buffer.alloc(0)

  async start(filePath: string, socket: Socket): Promise<void> {
    if (!existsSync(filePath)) throw new Error(`找不到视频文件：${basename(filePath)}`)
    const probe = await probeMedia(filePath)
    const portrait = probe.videoHeight > probe.videoWidth
    const outputWidth = portrait ? 720 : 1280
    const outputHeight = portrait ? 1280 : 720
    await this.stop()
    this.stopped = false
    this.sequence = 0
    this.pending = Buffer.alloc(0)
    const child = spawn(getFfmpegPath(), [
      '-hide_banner', '-loglevel', 'warning', '-re', '-stream_loop', '-1',
      '-i', filePath, '-map', '0:v:0', '-an',
      '-vf', `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-profile:v', 'main', '-level:v', '3.1', '-pix_fmt', 'yuv420p',
      '-r', '30', '-g', '1', '-keyint_min', '1', '-bf', '0',
      '-x265-params', 'repeat-headers=1:keyint=1:min-keyint=1:scenecut=0',
      '-f', 'hevc', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const detail = chunk.trim()
      if (detail) logMainWarn('[虚拟摄像头调试] 视频处理输出', { detail })
    })
    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk, socket))
    child.once('error', (error) => {
      if (this.child === child && !this.stopped) logMainWarn('[虚拟摄像头调试] FFmpeg 异常', { error: error.message })
    })
    child.once('close', (code) => {
      if (this.child === child) this.child = null
      if (!this.stopped && code !== 0) logMainWarn('[虚拟摄像头调试] FFmpeg 退出', { code })
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    logMainInfo('[虚拟摄像头调试] 本地视频已开始输出', {
      filePath,
      inputWidth: probe.videoWidth,
      inputHeight: probe.videoHeight,
      outputWidth,
      outputHeight,
    })
  }

  private consume(chunk: Buffer, socket: Socket): void {
    this.pending = Buffer.concat([this.pending, chunk])
    const { units, remainder } = splitAccessUnits(this.pending)
    this.pending = remainder
    for (const unit of units) {
      // Let Node buffer the local test stream. Dropping a whole access unit when
      // writableNeedDrain is set can discard the parameter sets and leave the
      // decoder black until the next keyframe.
      if (socket.destroyed || !socket.writable) continue
      socket.write(encodeVideoFrame(this.sequence, unit))
      this.sequence = (this.sequence + 1) & 0xff
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    const child = this.child
    this.child = null
    if (!child) return
    await new Promise<void>((resolve) => {
      child.once('close', () => resolve())
      child.kill('SIGTERM')
      setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1_000).unref()
    })
  }
}
