import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'
import { LocalVideoStreamServer, type LocalVideoStreamInfo } from './localVideoStreamServer'

export type ObsInputCodec = 'h264' | 'h265'

/** 将相机的裸视频流复用为 OBS 可读取的本机 MPEG-TS HTTP 流。 */
export class LocalObsVideoStreamServer {
  private readonly output = new LocalVideoStreamServer('video/mp2t')
  private ffmpeg: ChildProcessWithoutNullStreams | null = null
  private inputUrl: string | null = null
  private stopPromise: Promise<void> | null = null
  private readonly onUnexpectedStop?: () => void
  private readonly ffmpegPath: string

  constructor(
    onUnexpectedStop?: () => void,
    ffmpegPath = getFfmpegPath(),
  ) {
    this.onUnexpectedStop = onUnexpectedStop
    this.ffmpegPath = ffmpegPath
  }

  async start(inputUrl: string, codec: ObsInputCodec): Promise<LocalVideoStreamInfo> {
    if (this.ffmpeg && this.inputUrl === inputUrl) return this.output.start()

    await this.stop()
    const local = await this.output.start()
    const inputFormat = codec === 'h265' ? 'hevc' : 'h264'
    const transcode = codec === 'h265'
    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-fflags', '+nobuffer',
      '-f', inputFormat,
      '-i', inputUrl,
      '-map', '0:v:0',
      '-an',
      ...(transcode
        ? [
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-pix_fmt', 'yuv420p',
            '-g', '30',
            '-keyint_min', '30',
            '-bf', '0',
          ]
        : ['-c:v', 'copy']),
      '-mpegts_flags', 'resend_headers',
      '-flush_packets', '1',
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-f', 'mpegts',
      'pipe:1',
    ]

    const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.ffmpeg = child
    this.inputUrl = inputUrl
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const detail = chunk.trim()
      if (detail) logMainWarn('[OBS 推送] 视频处理输出', { detail })
    })
    child.stdout.on('data', (chunk: Buffer) => this.output.publish(chunk))
    child.once('error', (error) => {
      if (this.ffmpeg !== child) return
      logMainWarn('[OBS 推送] 视频处理进程异常', { error: error.message })
    })
    child.once('close', (code, signal) => {
      if (this.ffmpeg !== child) return
      this.ffmpeg = null
      this.inputUrl = null
      if (code !== 0 && signal !== 'SIGTERM') {
        logMainWarn('[OBS 推送] 视频处理进程已停止', { code, signal })
      }
      void this.stop().catch((error: unknown) => {
        logMainWarn('[OBS 推送] 输出地址关闭失败', { error: error instanceof Error ? error.message : String(error) })
      })
      this.onUnexpectedStop?.()
    })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
    } catch (error) {
      if (this.ffmpeg === child) {
        this.ffmpeg = null
        this.inputUrl = null
      }
      await this.output.stop()
      throw error
    }
    logMainInfo('[OBS 推送] 本机视频地址已启动', { inputUrl, url: local.url, codec, transcode })
    return local
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    const child = this.ffmpeg
    this.ffmpeg = null
    this.inputUrl = null
    this.stopPromise = (async () => {
      if (child) {
        await new Promise<void>((resolve) => {
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            resolve()
          }
          child.once('close', finish)
          child.kill('SIGTERM')
          setTimeout(() => {
            if (!settled) child.kill('SIGKILL')
            finish()
          }, 2_000)
        })
      }
      await this.output.stop()
    })().finally(() => {
      this.stopPromise = null
    })
    return this.stopPromise
  }
}
