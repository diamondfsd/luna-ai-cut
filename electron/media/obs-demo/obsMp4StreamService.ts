import { app } from 'electron'
import { existsSync } from 'node:fs'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { Readable } from 'node:stream'
import { join } from 'node:path'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'
import { LocalVideoStreamServer } from '../../devices/common/localVideoStreamServer'
import type { ObsStreamDemoStatus } from '../../../src/shared/types'

const SOURCE_NAME = 'Luna AI Cut OBS Demo'
const DEMO_FILE_NAME = 'obs-demo.mp4'

type FfmpegProcess = ChildProcessByStdio<null, Readable, Readable>

function demoFilePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'obs-demo', DEMO_FILE_NAME)
    : join(app.getAppPath(), 'electron', 'media', 'obs-demo', DEMO_FILE_NAME)
}

function nowIso(): string {
  return new Date().toISOString()
}

function previewUrlFor(filePath: string): string {
  return pathToFileURL(filePath).toString()
}

class ObsMp4StreamService {
  private readonly output = new LocalVideoStreamServer('video/mp2t')
  private ffmpeg: FfmpegProcess | null = null
  private startPromise: Promise<ObsStreamDemoStatus> | null = null
  private statusValue: ObsStreamDemoStatus

  constructor() {
    const sourcePath = demoFilePath()
    this.statusValue = {
      state: 'idle',
      sourceName: SOURCE_NAME,
      obsStreamUrl: null,
      previewUrl: previewUrlFor(sourcePath),
      port: null,
      bytes: 0,
      startedAt: null,
      message: 'OBS 视频源尚未启动',
      error: null,
    }
  }

  status(): ObsStreamDemoStatus {
    return { ...this.statusValue }
  }

  start(): Promise<ObsStreamDemoStatus> {
    if (this.statusValue.state === 'running') return Promise.resolve(this.status())
    if (this.startPromise) return this.startPromise

    const sourcePath = demoFilePath()
    this.statusValue = {
      ...this.statusValue,
      state: 'starting',
      obsStreamUrl: null,
      port: null,
      bytes: 0,
      startedAt: nowIso(),
      message: '正在启动 OBS 视频源',
      error: null,
    }
    const task = this.startInternal(sourcePath)
      .then(() => this.status())
      .catch(async (error: unknown) => {
        await this.stop()
        const detail = error instanceof Error ? error.message : String(error)
        this.statusValue = {
          ...this.statusValue,
          state: 'error',
          message: 'OBS 视频源启动失败',
          error: detail,
        }
        throw error
      })
      .finally(() => {
        if (this.startPromise === task) this.startPromise = null
      })
    this.startPromise = task
    return task
  }

  private async startInternal(sourcePath: string): Promise<void> {
    if (!existsSync(sourcePath)) throw new Error(`找不到演示视频：${sourcePath}`)

    const local = await this.output.start()
    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-re',
      '-stream_loop', '-1',
      '-i', sourcePath,
      '-map', '0:v:0',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-g', '30',
      '-keyint_min', '30',
      '-bf', '0',
      '-mpegts_flags', 'resend_headers',
      '-flush_packets', '1',
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-f', 'mpegts',
      'pipe:1',
    ]
    const child = spawn(getFfmpegPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.ffmpeg = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const detail = chunk.trim()
      if (detail) logMainWarn('[OBS 演示] 视频处理输出', { detail })
    })
    child.stdout.on('data', (chunk: Buffer) => {
      this.statusValue = { ...this.statusValue, bytes: this.statusValue.bytes + chunk.length }
      this.output.publish(chunk)
    })
    child.once('error', (error) => {
      if (this.ffmpeg !== child) return
      logMainWarn('[OBS 演示] 视频处理进程异常', { error: error.message })
    })
    child.once('close', (code, signal) => {
      if (this.ffmpeg !== child) return
      this.ffmpeg = null
      void this.output.stop().catch((error: unknown) => {
        logMainWarn('[OBS 演示] 输出地址关闭失败', { error: error instanceof Error ? error.message : String(error) })
      })
      if (this.statusValue.state === 'starting' || this.statusValue.state === 'running') {
        this.statusValue = {
          ...this.statusValue,
          state: code === 0 || signal === 'SIGTERM' ? 'stopped' : 'error',
          obsStreamUrl: null,
          port: null,
          message: code === 0 || signal === 'SIGTERM' ? 'OBS 视频源已停止' : 'OBS 视频源意外停止',
          error: code === 0 || signal === 'SIGTERM' ? null : `视频处理进程退出码 ${code ?? 'unknown'}`,
        }
      }
    })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
    } catch (error) {
      if (this.ffmpeg === child) this.ffmpeg = null
      await this.output.stop()
      throw error
    }
    this.statusValue = {
      ...this.statusValue,
      state: 'running',
      obsStreamUrl: local.url,
      port: local.port,
      message: 'OBS 视频源已启动，等待 OBS 连接',
      error: null,
    }
    logMainInfo('[OBS 演示] MP4 视频源已启动', { sourcePath, url: local.url })
  }

  async stop(): Promise<ObsStreamDemoStatus> {
    const child = this.ffmpeg
    this.ffmpeg = null
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
    this.statusValue = {
      ...this.statusValue,
      state: 'stopped',
      obsStreamUrl: null,
      port: null,
      message: 'OBS 视频源已停止',
      error: null,
    }
    return this.status()
  }
}

let service: ObsMp4StreamService | null = null

function obsMp4StreamService(): ObsMp4StreamService {
  service ??= new ObsMp4StreamService()
  return service
}

export function getObsStreamDemoStatus(): ObsStreamDemoStatus {
  return obsMp4StreamService().status()
}

export function startObsStreamDemo(): Promise<ObsStreamDemoStatus> {
  return obsMp4StreamService().start()
}

export function stopObsStreamDemo(): Promise<ObsStreamDemoStatus> {
  return obsMp4StreamService().stop()
}

export async function stopObsStreamDemoOnQuit(): Promise<void> {
  await service?.stop().catch(() => undefined)
  service = null
}
