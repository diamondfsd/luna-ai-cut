import { spawn } from 'node:child_process'
import * as path from 'node:path'
import { app } from 'electron'
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

// ─── FFmpeg 二进制路径 ─────────────────────────────

export function getFfmpegPath(): string {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : ''
    return path.join(process.resourcesPath, 'ffmpeg', `ffmpeg${ext}`)
  }
  try {
    const resolved = _require.resolve('ffmpeg-static')
    const pkgDir = path.dirname(resolved)
    return path.join(pkgDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  } catch {
    return 'ffmpeg'
  }
}

// ─── 媒体探测结果 ────────────────────────────────

export interface MediaProbe {
  durationSeconds: number | null
  videoBitrate: number | null
  videoCodec: string | null
  videoWidth: number
  videoHeight: number
}

// ─── 模块构建上下文 ───────────────────────────────

export interface BuildContext {
  /** 已探测的媒体信息 */
  probe: MediaProbe
  /** 原始视频尺寸 */
  videoWidth: number
  videoHeight: number
  /** 上一个视频 filter 的输出标签，供链式 filter 使用 */
  prevLabel: string
  /** 输出分辨率（ScaleModule 等模块可更新此值） */
  outputWidth: number
  outputHeight: number
  /** 原始文件名（用于判断 Live Photo 等） */
  sourceName?: string
}

// ─── 模块贡献的参数 ───────────────────────────────

export interface ModuleArgs {
  /** 额外输入文件（如水印图） */
  inputs?: string[]
  /** filter_complex 片段（按顺序拼接） */
  filters?: string[]
  /** 非 filter 的输出参数 */
  outputArgs?: string[]
  /** 本模块 filter 的输出视频标签（供下游模块链入） */
  outputLabel?: string
}

// ─── 模块接口 ────────────────────────────────────

export interface FfmpegModule {
  /** 模块名称（调试用） */
  readonly name: string
  /** 是否有实际效果（false 则跳过 build） */
  isActive(): boolean
  /** 构建本模块贡献的 ffmpeg 参数 */
  build(ctx: BuildContext): ModuleArgs
}

// ─── Pipeline ────────────────────────────────────

export class FfmpegPipeline {
  private modules: FfmpegModule[] = []

  addModule(module: FfmpegModule): this {
    this.modules.push(module)
    return this
  }

  /**
   * 编译所有模块并执行 ffmpeg
   */
  async execute(
    inputPath: string,
    outputPath: string,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const probe = await probeMedia(inputPath)

    const ctx: BuildContext = {
      probe,
      videoWidth: probe.videoWidth,
      videoHeight: probe.videoHeight,
      outputWidth: probe.videoWidth,
      outputHeight: probe.videoHeight,
      prevLabel: '[0:v]',
    }

    const allInputs: string[] = [inputPath]
    const allFilters: string[] = []
    const allOutputArgs: string[] = []

    // 各模块依次贡献参数
    for (const mod of this.modules) {
      if (!mod.isActive()) continue
      const args = mod.build(ctx)
      if (args.inputs) allInputs.push(...args.inputs)
      if (args.filters) allFilters.push(...args.filters)
      if (args.outputArgs) allOutputArgs.push(...args.outputArgs)
      if (args.outputLabel) ctx.prevLabel = args.outputLabel
    }

    // 编译完整 ffmpeg 参数
    const ffmpegArgs = [
      ...allInputs.flatMap((f) => ['-i', f]),
      ...(allFilters.length > 0 ? ['-filter_complex', allFilters.join(';')] : []),
      ...allOutputArgs,
      '-map_metadata', '0',
      '-progress', 'pipe:2',
      '-nostats',
      '-y',
      outputPath,
    ]

    const ffmpegPath = getFfmpegPath()
    const duration = probe.durationSeconds

    console.log('[FFMPEG pipeline]', {
      input: inputPath,
      output: outputPath,
      modules: this.modules.filter(m => m.isActive()).map(m => m.name),
      inputs: allInputs,
      filters: allFilters,
      outputArgs: allOutputArgs,
      prevLabel: ctx.prevLabel,
    })

    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, ffmpegArgs)

      const abort = (): void => {
        child.kill('SIGTERM')
        reject(new DOMException('导出已取消', 'AbortError'))
      }

      if (signal?.aborted) { abort(); return }
      signal?.addEventListener('abort', abort, { once: true })

      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
        const match = chunk.match(/out_time_ms=(\d+)/)
        if (match && duration) {
          const seconds = Number(match[1]) / 1_000_000
          onProgress?.(Math.max(1, Math.min(99, (seconds / duration) * 100)))
        }
      })

      child.on('error', (error) => {
        signal?.removeEventListener('abort', abort)
        reject(error)
      })

      child.on('close', (code) => {
        signal?.removeEventListener('abort', abort)
        if (signal?.aborted) return
        if (code === 0) { onProgress?.(100); resolve(); return }
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
      })
    })
  }
}

// ─── ffprobe 探测 ────────────────────────────────

function getFfprobePath(): string {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : ''
    return path.join(process.resourcesPath, 'ffmpeg', `ffprobe${ext}`)
  }
  try {
    const pkgDir = path.dirname(_require.resolve('ffprobe-static/package.json'))
    return path.join(pkgDir, 'bin', process.platform, process.arch, `ffprobe${process.platform === 'win32' ? '.exe' : ''}`)
  } catch {
    return 'ffprobe'
  }
}

const execFileAsync = (cmd: string, args: string[]) =>
  new Promise<{ stdout: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { encoding: 'utf-8' } as never)
    let stdout = ''
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout })
      else reject(new Error(`ffprobe exited with code ${code}`))
    })
  })

export async function probeMedia(inputPath: string): Promise<MediaProbe> {
  const fallback: MediaProbe = {
    durationSeconds: null,
    videoBitrate: null,
    videoCodec: null,
    videoWidth: 1920,
    videoHeight: 1080,
  }

  try {
    const ffprobe = getFfprobePath()
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ])

    const data = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string }
      streams?: Array<{
        codec_type: string; codec_name?: string
        width?: number; height?: number; bit_rate?: string
      }>
    }

    const videoStream = data.streams?.find((s) => s.codec_type === 'video')
    const parsedDuration = Number(data.format?.duration)
    const streamBitrate = Number(videoStream?.bit_rate)
    const formatBitrate = Number(data.format?.bit_rate)

    return {
      durationSeconds: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null,
      videoBitrate: Number.isFinite(streamBitrate) && streamBitrate > 0
        ? Math.round(streamBitrate)
        : Number.isFinite(formatBitrate) && formatBitrate > 0
          ? Math.round(formatBitrate)
          : null,
      videoCodec: videoStream?.codec_name ?? null,
      videoWidth: videoStream?.width ?? fallback.videoWidth,
      videoHeight: videoStream?.height ?? fallback.videoHeight,
    }
  } catch {
    return fallback
  }
}
