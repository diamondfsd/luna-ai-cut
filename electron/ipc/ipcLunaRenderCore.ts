/**
 * IPC 处理器 — Luna Render Core
 */
import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFileSync, existsSync, statSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, extname, basename, dirname, isAbsolute } from 'node:path'
import {
  warmupRenderCore,
  renderCompositionFrame as lrcRenderCompositionFrame,
  renderCompositionFrameAsync as lrcRenderCompositionFrameAsync,
  resolveRenderSource as lrcResolveRenderSource,
  exportCompositionVideoAsync as lrcExportCompositionVideoAsync,
  exportCompositionImageAsync as lrcExportCompositionImageAsync,
  cancelExportTask as lrcCancelExportTask,
  getExportTaskProgress as lrcGetExportTaskProgress,
  resetRenderCompatibilityBlock,
} from '../platform/render/lunaRenderCore'

// 导入纹理管理方法
import { getNative, cleanNativeInput } from '../platform/render/lunaRenderCore'
import { getFfmpegPath, getFfprobePath } from '../platform/ffmpeg/pipeline'
import * as exportTaskService from '../export/exportTaskService'
import { getLogDir, logMainError, logMainInfo, logMainWarn } from '../infrastructure/loggerService'
import { RUNTIME_RESOURCE_DEFINITIONS } from '../infrastructure/runtimeResourceDefinitions'
import { loadRuntimeResource } from '../infrastructure/runtimeResourceService'
import { embedJpegSourceMetadata, embedVideoSourceMetadata } from '../export/exportSourceMetadata'

interface RegisterContext {
  activeNativeExportTasks: Set<string>
  activeExportEncoders: Map<string, ChildProcessWithoutNullStreams>
}

function runtimeResourceCacheRoot(): string {
  return join(app.getPath('userData'), 'resource-packs')
}

function relativePackPath(value: string, root: 'fonts' | 'luts'): string | null {
  const normalized = value.replace(/\\/g, '/')
  const prefix = `${root}/`
  if (!isAbsolute(value)) return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null
  const index = normalized.toLowerCase().lastIndexOf(`/${prefix}`)
  return index >= 0 ? normalized.slice(index + prefix.length + 1) : null
}

function joinPackPath(root: string, relative: string): string {
  if (!relative || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('资源文件路径不安全')
  }
  return join(root, ...relative.split('/'))
}

function localPackPath(root: 'fonts' | 'luts', relative: string): string | null {
  const appRoot = process.env.APP_ROOT ?? join(import.meta.dirname, '..')
  const candidates = [
    app.isPackaged ? join(process.resourcesPath, root, relative) : join(appRoot, 'public', root, relative),
    process.env.VITE_PUBLIC ? join(process.env.VITE_PUBLIC, root, relative) : null,
    join(process.resourcesPath || '', root, relative),
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function resolveRuntimePaths<T>(value: T): Promise<T> {
  if (Array.isArray(value)) return await Promise.all(value.map(resolveRuntimePaths)) as T
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    if (key === 'fontFile' && typeof item === 'string') {
      const relative = relativePackPath(item, 'fonts')
      const localPath = relative && !isAbsolute(item)
        ? (app.isPackaged
        ? join(process.resourcesPath, 'fonts', relative)
        : join(process.env.APP_ROOT ?? join(import.meta.dirname, '..'), 'public', 'fonts', relative))
        : item
      if (existsSync(localPath)) output[key] = localPath
      else if (relative) {
        const root = await loadRuntimeResource(runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS.fonts)
        output[key] = joinPackPath(root, relative)
      } else output[key] = item
    } else if ((key === 'lutId' || key === 'restoreLutId') && typeof item === 'string') {
      const relative = relativePackPath(item, 'luts')
      if (existsSync(item) || !relative) output[key] = item
      else {
        output[key] = localPackPath('luts', relative)
          ?? joinPackPath(await loadRuntimeResource(runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS.luts), relative)
      }
    } else {
      output[key] = await resolveRuntimePaths(item)
    }
  }
  return output as T
}

/** 写日志到文件（追加模式），APP_ROOT 在 appMain.ts 中设置 */
function rcLog(msg: string): void {
  const logPath = join(getLogDir(), 'luna-rc.log')
  try {
    const ts = new Date().toISOString().slice(11, 23)
    appendFileSync(logPath, `[${ts}] [main] ${msg}\n`)
  } catch { /* ignore */ }
}

function describeExecutable(filePath: string): string {
  try {
    const info = statSync(filePath)
    return JSON.stringify({ path: filePath, exists: true, isFile: info.isFile(), size: info.size })
  } catch (error) {
    return JSON.stringify({
      path: filePath,
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function waitForChildProcess(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
}

interface WebGpuVideoProbeResult {
  duration: number | null
  fps: number | null
  width: number | null
  height: number | null
}

interface FfprobeVideoStream {
  codec_type?: unknown
  duration?: unknown
  width?: unknown
  height?: unknown
  avg_frame_rate?: unknown
  r_frame_rate?: unknown
  disposition?: { attached_pic?: unknown }
}

interface FfprobeJson {
  format?: { duration?: unknown }
  streams?: FfprobeVideoStream[]
}

const WEBGPU_VIDEO_PROBE_TIMEOUT_MS = 15_000
const WEBGPU_VIDEO_PROBE_MAX_ATTEMPTS = 4
const WEBGPU_VIDEO_PROBE_RETRY_DELAYS_MS = [100, 250, 500] as const
const WEBGPU_VIDEO_PROBE_MAX_OUTPUT_BYTES = 1024 * 1024

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function waitMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function runFfprobeOnce(ffprobePath: string, sourcePath: string): Promise<{ stdout: string; stderr: string }> {
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_entries', 'format=duration:stream=codec_type,duration,width,height,avg_frame_rate,r_frame_rate,disposition',
    '-show_format',
    '-show_streams',
    sourcePath,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      const failure = Object.assign(new Error(`ffprobe 探测超时（${WEBGPU_VIDEO_PROBE_TIMEOUT_MS}ms）`), { code: 'ETIMEDOUT' })
      try {
        child.kill()
      } catch {
        // 进程可能已经退出，超时错误仍需返回给调用方。
      }
      rejectOnce(failure)
    }, WEBGPU_VIDEO_PROBE_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      child.removeListener('error', onError)
      child.removeListener('close', onClose)
    }
    const resolveOnce = (result: { stdout: string; stderr: string }) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onError = (error: Error) => rejectOnce(error)
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        resolveOnce({ stdout, stderr })
        return
      }
      const failure = new Error(`ffprobe 进程失败${stderr.trim() ? `: ${stderr.trim()}` : `（退出码 ${code ?? '未知'}${signal ? `，信号 ${signal}` : ''}）`}`)
      Object.assign(failure, { code: 'FFPROBE_EXIT', exitCode: code, signal })
      rejectOnce(failure)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > WEBGPU_VIDEO_PROBE_MAX_OUTPUT_BYTES) stdout = stdout.slice(-WEBGPU_VIDEO_PROBE_MAX_OUTPUT_BYTES)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > WEBGPU_VIDEO_PROBE_MAX_OUTPUT_BYTES) stderr = stderr.slice(-WEBGPU_VIDEO_PROBE_MAX_OUTPUT_BYTES)
    })
    child.once('error', onError)
    child.once('close', onClose)
  })
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function parseFrameRate(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const raw = String(value).trim()
  if (!raw || raw === '0/0' || raw === 'N/A') return null
  const parts = raw.split('/')
  const numerator = Number(parts[0])
  const denominator = parts.length > 1 ? Number(parts[1]) : 1
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null
  const fps = numerator / denominator
  return Number.isFinite(fps) && fps > 0 ? fps : null
}

function selectWebGpuProbeStream(streams: FfprobeVideoStream[] | undefined): FfprobeVideoStream | undefined {
  return (streams ?? [])
    .filter((stream) => stream.codec_type === 'video' && Number(stream.disposition?.attached_pic) !== 1)
    .sort((left, right) => {
      const leftArea = (positiveNumber(left.width) ?? 0) * (positiveNumber(left.height) ?? 0)
      const rightArea = (positiveNumber(right.width) ?? 0) * (positiveNumber(right.height) ?? 0)
      return rightArea - leftArea
    })[0]
}

function parseWebGpuVideoProbe(stdout: string): WebGpuVideoProbeResult {
  const parsed = JSON.parse(stdout) as FfprobeJson
  const stream = selectWebGpuProbeStream(parsed.streams)
  if (!stream) throw new Error('ffprobe 未找到可用视频流')
  return {
    duration: positiveNumber(stream.duration) ?? positiveNumber(parsed.format?.duration),
    fps: parseFrameRate(stream?.avg_frame_rate) ?? parseFrameRate(stream?.r_frame_rate),
    width: positiveNumber(stream?.width),
    height: positiveNumber(stream?.height),
  }
}

async function validateWebGpuVideoProbePath(sourcePath: unknown): Promise<string> {
  if (typeof sourcePath !== 'string') throw new Error('WebGPU 视频探测路径无效')
  const normalized = sourcePath.trim()
  if (!normalized || normalized.length > 4096 || normalized.includes('\0') || !isAbsolute(normalized)) {
    throw new Error('WebGPU 视频探测路径无效')
  }
  const sourceStat = await stat(normalized)
  if (!sourceStat.isFile()) throw new Error('WebGPU 视频探测源不是文件')
  return normalized
}

/** 包装 handler：自动 catch 异常并记日志 */
function safe<T extends (...args: any[]) => any>(label: string, fn: T): T {
  let firstCall = true
  return (async (...args: any[]) => {
    const traceThisCall = firstCall
    firstCall = false
    if (traceThisCall) logMainInfo('[LRC] 首次调用开始', { label })
    try {
      const result = await fn(...args)
      if (traceThisCall) logMainInfo('[LRC] 首次调用完成', { label })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      rcLog(`ERROR in ${label}: ${msg}`)
      logMainError('[LRC] 调用失败', { label, error: msg })
      throw err
    }
  }) as unknown as T
}

export function register(ctx: RegisterContext): void {
  const webGpuSessions = new Map<string, { outputPath: string; sourcePath: string | null; stderr: { value: string } }>()

  ipcMain.handle('lrc:resetCompatibilityBlock', async () => {
    resetRenderCompatibilityBlock()
    logMainInfo('[LRC] 已解除渲染兼容保护，等待重新检测')
  })

  ipcMain.handle('lrc:init', safe('init', async (_event: IpcMainInvokeEvent, logPath?: string) => {
    await warmupRenderCore(logPath)
    rcLog('lrc:init OK')
  }))

  ipcMain.handle('lrc:webgpu-video-probe', safe('webgpu-video-probe',
    async (_event: IpcMainInvokeEvent, sourcePath: unknown): Promise<WebGpuVideoProbeResult> => {
      const startedAt = performance.now()
      let normalizedSourcePath: string | null = null
      let ffprobePath: string | null = null
      let attempts = 0
      try {
        normalizedSourcePath = await validateWebGpuVideoProbePath(sourcePath)
        ffprobePath = getFfprobePath()
        logMainInfo('[LRC] WebGPU 视频元数据探测开始', {
          sourcePath: normalizedSourcePath,
          ffprobePath,
          timeoutMs: WEBGPU_VIDEO_PROBE_TIMEOUT_MS,
          maxAttempts: WEBGPU_VIDEO_PROBE_MAX_ATTEMPTS,
        })

        while (attempts < WEBGPU_VIDEO_PROBE_MAX_ATTEMPTS) {
          attempts += 1
          try {
            const processResult = await runFfprobeOnce(ffprobePath, normalizedSourcePath)
            const result = parseWebGpuVideoProbe(processResult.stdout)
            logMainInfo('[LRC] WebGPU 视频元数据探测完成', {
              sourcePath: normalizedSourcePath,
              attempts,
              elapsedMs: Math.round(performance.now() - startedAt),
              ...result,
            })
            return result
          } catch (error) {
            const code = errorCode(error)
            if (code !== 'EAGAIN' || attempts >= WEBGPU_VIDEO_PROBE_MAX_ATTEMPTS) throw error
            const delayMs = WEBGPU_VIDEO_PROBE_RETRY_DELAYS_MS[attempts - 1] ?? WEBGPU_VIDEO_PROBE_RETRY_DELAYS_MS[WEBGPU_VIDEO_PROBE_RETRY_DELAYS_MS.length - 1]
            logMainWarn('[LRC] WebGPU 视频元数据探测重试', {
              sourcePath: normalizedSourcePath,
              attempt: attempts,
              nextAttempt: attempts + 1,
              maxAttempts: WEBGPU_VIDEO_PROBE_MAX_ATTEMPTS,
              errorCode: code,
              error: error instanceof Error ? error.message : String(error),
              delayMs,
            })
            await waitMilliseconds(delayMs)
          }
        }
        throw new Error('WebGPU 视频元数据探测失败')
      } catch (error) {
        logMainError('[LRC] WebGPU 视频元数据探测失败', {
          sourcePath: normalizedSourcePath ?? (typeof sourcePath === 'string' ? sourcePath : null),
          ffprobePath,
          attempts,
          elapsedMs: Math.round(performance.now() - startedAt),
          errorCode: errorCode(error),
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },
  ))

  ipcMain.handle('lrc:getNativePreviewCapabilities', safe('getNativePreviewCapabilities', async () => {
    return getNative().getNativePreviewCapabilities()
  }))

  ipcMain.handle('lrc:prepareRuntimeResource', safe('prepareRuntimeResource',
    async (_event: IpcMainInvokeEvent, kind: 'fonts' | 'luts') => {
      if (kind !== 'fonts' && kind !== 'luts') throw new Error('未知运行时资源类型')
      await loadRuntimeResource(runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS[kind])
    },
  ))

  // 纹理管理方法
  ipcMain.handle('lrc:loadTexture', safe('loadTexture',
    async (_event: IpcMainInvokeEvent, data: Buffer, width: number, height: number) => {
      return getNative().loadTexture(data, width, height)
    },
  ))

  ipcMain.handle('lrc:updateTexture', safe('updateTexture',
    async (_event: IpcMainInvokeEvent, textureId: number, data: Buffer) => {
      return getNative().updateTexture(textureId, data)
    },
  ))

  ipcMain.handle('lrc:renderFrame', safe('renderFrame',
    async (_event: IpcMainInvokeEvent, canvasWidth: number, canvasHeight: number, layers: any[], compositionTime?: number) => {
      return getNative().renderFrame(
        canvasWidth,
        canvasHeight,
        cleanNativeInput(await resolveRuntimePaths(layers)),
        compositionTime,
      )
    },
  ))

  ipcMain.handle('lrc:releaseTexture', safe('releaseTexture',
    async (_event: IpcMainInvokeEvent, textureId: number) => {
      return getNative().releaseTexture(textureId)
    },
  ))

  ipcMain.handle('lrc:renderCompositionFrame', safe('renderCompositionFrame',
    async (_event: IpcMainInvokeEvent, composition: any, time: number, maxSide?: number) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      return lrcRenderCompositionFrame(ffmpegPath, ffprobePath, await resolveRuntimePaths(composition), time, maxSide)
    },
  ))

  ipcMain.handle('lrc:renderCompositionFrameAsync', safe('renderCompositionFrameAsync',
    async (_event: IpcMainInvokeEvent, composition: any, time: number, maxSide?: number) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      return lrcRenderCompositionFrameAsync(ffmpegPath, ffprobePath, await resolveRuntimePaths(composition), time, maxSide)
    },
  ))

  ipcMain.handle('lrc:exportCompositionImage', safe('exportCompositionImage',
    async (
      _event: IpcMainInvokeEvent,
      outputPath: string,
      composition: any,
      format: string,
      quality: number,
      exportTaskId?: string,
      exportItemId?: string,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      rcLog(`lrc:exportCompositionImage out=${outputPath} fmt=${format} q=${quality}`)

      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting' }).catch(() => {})
        _event.sender?.send('export:progress', {
          exportId: exportItemId,
          taskId: exportTaskId,
          fileName: outputPath.split(/[\\/]/).pop(),
          percent: 0,
          status: 'exporting',
          destinationPath: outputPath,
        })
      }

      await lrcExportCompositionImageAsync({ ffmpegPath, ffprobePath, outputPath, composition: await resolveRuntimePaths(composition), format, quality })
      const sourcePath = composition?.layers?.find((layer: any) => layer?.layerType === 'media')?.source?.path
        ?? composition?.layers?.find((layer: any) => layer?.source?.path)?.source?.path
      await embedJpegSourceMetadata(outputPath, sourcePath).catch((error) => {
        logMainWarn('[导出] 无法写入图片来源信息', {
          outputPath,
          error: error instanceof Error ? error.message : String(error),
        })
      })

      if (exportTaskId && exportItemId) {
        _event.sender?.send('export:progress', {
          exportId: exportItemId,
          taskId: exportTaskId,
          fileName: outputPath.split(/[\\/]/).pop(),
          percent: 100,
          status: 'done',
          destinationPath: outputPath,
        })
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'done', progress: 100, destinationPath: outputPath }).catch(() => {})
      }
      rcLog('lrc:exportCompositionImage done')
    },
  ))

  ipcMain.handle('lrc:resolveRenderSource', safe('resolveRenderSource',
    async (_event: IpcMainInvokeEvent, originalPath: string, cacheDir: string) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      rcLog(`lrc:resolveRenderSource path=${originalPath}`)
      return lrcResolveRenderSource(ffmpegPath, ffprobePath, originalPath, cacheDir)
    },
  ))

  ipcMain.handle('lrc:exportCompositionVideo', safe('exportCompositionVideo',
    async (
      _event: IpcMainInvokeEvent,
      outputPath: string,
      composition: any,
      fps: number | null,
      duration: number | null,
      hardware: boolean,
      taskId?: string,
      qualityPreset?: string,
      exportTaskId?: string,
      exportItemId?: string,
      includeAudio?: boolean,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      const renderTaskId = taskId ?? exportItemId ?? `composition_${Date.now()}`
      const progressExportId = exportItemId ?? renderTaskId
      const fileName = fileNameFromPath(outputPath)
      rcLog(`lrc:exportCompositionVideo start out=${outputPath} task=${renderTaskId} layers=${composition?.layers?.length ?? 0} audio=${includeAudio !== false}`)
      rcLog(`lrc:exportCompositionVideo runtime ${JSON.stringify({
        mode: app.isPackaged ? 'packaged' : 'development',
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        cwd: process.cwd(),
        ffmpeg: describeExecutable(ffmpegPath),
        ffprobe: describeExecutable(ffprobePath),
      })}`)
      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting' }).catch(() => {})
        _event.sender?.send('export:progress', {
          exportId: progressExportId,
          taskId: exportTaskId,
          fileName,
          percent: 0,
          status: 'exporting',
          destinationPath: outputPath,
        })
      }
      const progressTimer = setInterval(() => {
        const progress = lrcGetExportTaskProgress(renderTaskId)
        if (!progress) return
        const currentFrame = Number(progress[0])
        const totalFrames = Number(progress[1])
        if (totalFrames <= 1) return
        const percent = Math.max(0, Math.min(99, Math.floor((currentFrame / totalFrames) * 100)))
        if (exportTaskId && exportItemId) {
          exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting', progress: percent }).catch(() => {})
          _event.sender?.send('export:progress', {
            exportId: progressExportId,
            taskId: exportTaskId,
            fileName,
            percent,
            status: 'exporting',
            destinationPath: outputPath,
          })
        }
      }, 500)
      ctx.activeNativeExportTasks.add(renderTaskId)
      try {
        await lrcExportCompositionVideoAsync({
          ffmpegPath,
          ffprobePath,
          outputPath,
          composition: await resolveRuntimePaths(composition),
          fps,
          duration,
          hardware,
          taskId: renderTaskId,
          qualityPreset,
          includeAudio,
        })
        const sourcePath = composition?.layers?.find((layer: any) => layer?.layerType === 'media')?.source?.path
          ?? composition?.layers?.find((layer: any) => layer?.source?.path)?.source?.path
        await embedVideoSourceMetadata(ffmpegPath, outputPath, sourcePath).catch((error) => {
          logMainWarn('[导出] 无法写入来源设备信息', {
            outputPath,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        if (exportTaskId && exportItemId) {
          await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'done', progress: 100, destinationPath: outputPath }).catch(() => {})
          _event.sender?.send('export:progress', {
            exportId: progressExportId,
            taskId: exportTaskId,
            fileName,
            percent: 100,
            status: 'done',
            destinationPath: outputPath,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (exportTaskId && exportItemId) {
          await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'failed', error: message }).catch(() => {})
          _event.sender?.send('export:progress', {
            exportId: progressExportId,
            taskId: exportTaskId,
            fileName,
            percent: 100,
            status: 'failed',
            destinationPath: outputPath,
            error: message,
          })
        }
        throw error
      } finally {
        clearInterval(progressTimer)
        ctx.activeNativeExportTasks.delete(renderTaskId)
      }
    },
  ))

  ipcMain.handle('lrc:webgpu-video-begin', safe('webgpu-video-begin',
    async (
      _event: IpcMainInvokeEvent,
      sessionId: string,
      outputPath: string,
      sourcePath: string | null,
      width: number,
      height: number,
      fps: number,
      duration: number,
      sourceStartTime: number,
      includeAudio: boolean,
    ) => {
      if (!sessionId || ctx.activeExportEncoders.has(sessionId)) throw new Error('WebGPU 视频导出会话已存在')
      if (!outputPath || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
        throw new Error('WebGPU 视频导出尺寸无效')
      }
      if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(duration) || duration <= 0) {
        throw new Error('WebGPU 视频导出时间参数无效')
      }
      await mkdir(dirname(outputPath), { recursive: true })
      const safeSourcePath = typeof sourcePath === 'string' && sourcePath.trim().length > 0 ? sourcePath : null
      const safeStartTime = Number.isFinite(sourceStartTime) ? Math.max(0, sourceStartTime) : 0
      const videoInput = ['-f', 'h264', '-r', String(fps), '-i', 'pipe:0']
      const audioInput = safeSourcePath && includeAudio
        ? [...(safeStartTime > 0 ? ['-ss', String(safeStartTime)] : []), '-i', safeSourcePath]
        : []
      const args = [
        '-y', '-hide_banner', '-loglevel', 'error',
        ...videoInput,
        ...audioInput,
        '-map', '0:v:0',
        ...(audioInput.length > 0 ? ['-map', '1:a:0?'] : []),
        '-c:v', 'copy',
        ...(audioInput.length > 0 ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']),
        '-t', String(duration),
        '-movflags', '+faststart',
        outputPath,
      ]
      const child = spawn(getFfmpegPath(), args, { stdio: ['pipe', 'pipe', 'pipe'] })
      child.stdout.resume()
      const stderr = { value: '' }
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr.value += chunk
        if (stderr.value.length > 16_384) stderr.value = stderr.value.slice(-16_384)
      })
      child.once('error', (error) => {
        rcLog(`lrc:webgpu-video process error session=${sessionId} error=${error.message}`)
      })
      ctx.activeExportEncoders.set(sessionId, child)
      webGpuSessions.set(sessionId, { outputPath, sourcePath: safeSourcePath, stderr })
      rcLog(`lrc:webgpu-video-begin session=${sessionId} size=${width}x${height} fps=${fps} duration=${duration} audio=${Boolean(audioInput.length)}`)
    },
  ))

  ipcMain.handle('lrc:webgpu-video-write', safe('webgpu-video-write',
    async (_event: IpcMainInvokeEvent, sessionId: string, data: Uint8Array) => {
      const child = ctx.activeExportEncoders.get(sessionId)
      if (!child || child.stdin.destroyed || child.exitCode !== null) throw new Error('WebGPU 视频导出会话不可用')
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      if (bytes.byteLength === 0) return
      if (!child.stdin.write(Buffer.from(bytes))) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup()
            reject(new Error('WebGPU 视频输出管道等待超时'))
          }, 30_000)
          const onDrain = () => {
            cleanup()
            resolve()
          }
          const onError = (error: Error) => {
            cleanup()
            reject(error)
          }
          const onClose = () => {
            cleanup()
            reject(new Error('WebGPU 视频封装进程已提前退出'))
          }
          const cleanup = () => {
            clearTimeout(timeout)
            child.stdin.off('drain', onDrain)
            child.stdin.off('error', onError)
            child.off('close', onClose)
          }
          child.stdin.once('drain', onDrain)
          child.stdin.once('error', onError)
          child.once('close', onClose)
        })
      }
    },
  ))

  ipcMain.handle('lrc:webgpu-video-end', safe('webgpu-video-end',
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      const child = ctx.activeExportEncoders.get(sessionId)
      const session = webGpuSessions.get(sessionId)
      if (!child || !session) throw new Error('WebGPU 视频导出会话不可用')
      ctx.activeExportEncoders.delete(sessionId)
      webGpuSessions.delete(sessionId)
      child.stdin.end()
      const result = await waitForChildProcess(child)
      if (result.code !== 0) {
        throw new Error(`WebGPU 视频封装失败${session.stderr.value ? `: ${session.stderr.value.trim()}` : `（退出码 ${result.code ?? '未知'}）`}`)
      }
      if (session.sourcePath) {
        await embedVideoSourceMetadata(getFfmpegPath(), session.outputPath, session.sourcePath).catch((error) => {
          logMainWarn('[导出] WebGPU 视频无法写入来源设备信息', {
            outputPath: session.outputPath,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
      rcLog(`lrc:webgpu-video-end session=${sessionId} output=${session.outputPath}`)
    },
  ))

  ipcMain.handle('lrc:webgpu-video-cancel', safe('webgpu-video-cancel',
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      const child = ctx.activeExportEncoders.get(sessionId)
      if (child) {
        ctx.activeExportEncoders.delete(sessionId)
        child.kill()
        child.stdin.destroy()
      }
      webGpuSessions.delete(sessionId)
      rcLog(`lrc:webgpu-video-cancel session=${sessionId}`)
    },
  ))

  ipcMain.handle('lrc:cancelExportTask', safe('cancelExportTask',
    async (_event: IpcMainInvokeEvent, taskId: string) => {
      lrcCancelExportTask(taskId)
      const encoder = ctx.activeExportEncoders.get(taskId)
      if (encoder) {
        ctx.activeExportEncoders.delete(taskId)
        encoder.kill()
        encoder.stdin.destroy()
      }
      rcLog(`lrc:cancelExportTask task=${taskId}`)
    },
  ))

  ipcMain.handle('lrc:getExportTaskProgress', safe('getExportTaskProgress',
    async (_event: IpcMainInvokeEvent, taskId: string) => {
      return lrcGetExportTaskProgress(taskId)
    },
  ))

  /** 递归扫描 .cube 文件（内置 + 外部目录），按目录名作为分类 */
  ipcMain.handle('lrc:listCubeFiles', safe('listCubeFiles',
    async (_event: IpcMainInvokeEvent, dirPath: string) => {
      const results: Array<{
        path: string
        name: string
        relDir: string
        description?: string
        isBuiltin: boolean
        isTechnical?: boolean
        deviceId?: string
      }> = []
      const seen = new Set<string>()

      // 内置 LUT 目录：打包版可能只附带部分 LUT（例如 DJI 专用 LUT），
      // 仍需和按需下载的完整资源包合并扫描。
      //   打包后：process.resourcesPath/luts（extraResources 复制到 resources/luts/）
      //   开发时：VITE_PUBLIC/luts 或 APP_ROOT/public/luts
      const localBuiltinDirs = [
        join(process.resourcesPath || '', 'luts'),
        join(process.env.VITE_PUBLIC || join(process.env.APP_ROOT || join(import.meta.dirname, '..'), 'public'), 'luts'),
      ].filter((p, index, candidates) => {
        if (candidates.indexOf(p) !== index) return false
        try { return statSync(p).isDirectory() } catch { return false }
      })
      const builtinDirs = [...localBuiltinDirs]
      // 完整开发资源目录带有根清单；打包版的局部资源没有清单，需要补充运行时资源包。
      const hasCompleteLocalPack = localBuiltinDirs.some((directory) => {
        try { return statSync(join(directory, 'manifest.json')).isFile() } catch { return false }
      })
      if (!hasCompleteLocalPack) {
        try {
          builtinDirs.push(await loadRuntimeResource(runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS.luts))
        } catch (error) {
          if (localBuiltinDirs.length === 0) throw error
          // 本地已附带的 LUT 仍然可用，资源包下载由工作台继续重试。
          console.warn('[lrc] 完整 LUT 资源包暂时不可用，将使用已附带的 LUT:', error)
        }
      }

      async function scanDir(dir: string, baseDir: string, isBuiltin: boolean): Promise<void> {
        let entries: string[]
        try { entries = await readdir(dir) } catch { return }
        for (const entry of entries.sort()) {
          const fullPath = join(dir, entry)
          try {
            const info = await stat(fullPath)
            if (info.isDirectory()) {
              await scanDir(fullPath, baseDir, isBuiltin)
            } else if (info.isFile() && extname(entry).toLowerCase() === '.cube') {
              const fileBaseName = entry.replace(/\.cube$/i, '')
              // 尝试读取同名的 .meta.json，用其中的 name 字段作为显示名
              let name = fileBaseName
              let description: string | undefined
              let isTechnical = false
              let deviceId: string | undefined
              try {
                const metaPath = join(dir, `${fileBaseName}.cube.meta.json`)
                const metaRaw = await readFile(metaPath, 'utf8')
                const meta = JSON.parse(metaRaw)
                if (meta.name) name = meta.name
                if (meta.description) description = meta.description
                isTechnical = meta.isTechnical === true
                if (typeof meta.deviceId === 'string' && meta.deviceId.trim()) deviceId = meta.deviceId.trim()
              } catch { /* 没有 meta 文件就用文件名 */ }
              const relDir = dir === baseDir ? '' : dir.slice(baseDir.length + 1)
              const key = `${fileBaseName}:${relDir}`
              if (seen.has(key)) continue
              seen.add(key)
              results.push({ path: fullPath, name, relDir, description, isBuiltin, isTechnical, deviceId })
            }
          } catch { /* 跳过无权限文件 */ }
        }
      }

      await scanDir(dirPath, dirPath, false)

      // 始终扫描所有内置 LUT 来源。先扫描本地覆盖资源，再扫描完整资源包，
      // 让同一相对路径下的本地文件优先保留。
      for (const builtinDir of [...new Set(builtinDirs)]) {
        try {
          await stat(builtinDir)
          await scanDir(builtinDir, builtinDir, true)
        } catch { /* 内置 LUT 目录不存在则跳过 */ }
      }

      return results
    },
  ))

  /** 导入 .cube 文件到 LUT 目录的指定分组 */
  ipcMain.handle('lrc:importCubeFile', safe('importCubeFile',
    async (
      _event: IpcMainInvokeEvent,
      sourcePath: string,
      categoryName: string,
      lutDir: string,
      targetName?: string,
      meta?: { name?: string; description?: string },
    ) => {
      if (!sourcePath.toLowerCase().endsWith('.cube')) {
        throw new Error('只支持 .cube 格式的 LUT 文件')
      }
      const fileName = targetName ? `${targetName}.cube` : basename(sourcePath)
      const destDir = join(lutDir, categoryName)
      await mkdir(destDir, { recursive: true })
      const destPath = join(destDir, fileName)
      await cp(sourcePath, destPath, { force: true })
      const fileBaseName = fileName.replace(/\.cube$/i, '')

      // 写入同名 .meta.json（与内置 LUT 格式一致）
      const metaObj: Record<string, unknown> = {}
      if (meta?.name) {
        metaObj.name = meta.name
      } else {
        metaObj.name = fileBaseName
      }
      if (meta?.description) metaObj.description = meta.description
      const metaPath = destPath + '.meta.json'
      await writeFile(metaPath, JSON.stringify(metaObj), 'utf-8')

      rcLog(`lrc:importCubeFile ${destPath}`)
      return { path: destPath, name: fileBaseName, relDir: categoryName }
    },
  ))

  /** 删除 .cube 文件及其同名 .meta.json（内置 LUT 不可删除） */
  ipcMain.handle('lrc:deleteCubeFile', safe('deleteCubeFile',
    async (_event: IpcMainInvokeEvent, cubePath: string, isBuiltin?: boolean) => {
      if (isBuiltin) {
        throw new Error('内置 LUT 不可删除')
      }
      const rmOpts = { force: true } as const
      await rm(cubePath, rmOpts)
      // 同时删除同名的 meta 文件（如果存在）
      const metaPath = cubePath + '.meta.json'
      await rm(metaPath, rmOpts)
      rcLog(`lrc:deleteCubeFile ${cubePath}`)
    },
  ))

}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || 'export.mp4'
}
