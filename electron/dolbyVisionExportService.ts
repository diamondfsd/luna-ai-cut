import { spawn } from 'node:child_process'
import { app } from 'electron'
import { access, mkdtemp, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import type { DolbyVisionProbeResult, DolbyVisionWatermarkExportRequest } from '../src/shared/types'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import { resolveDolbyVisionBitrate } from './dolbyVisionBitrate'
import { hvccMatchesSps, readHevcSpsConfiguration, readHvccConfigurations, repairHvccFromSps } from './dolbyVisionHvcc'

interface DolbyVisionExportCallbacks {
  signal?: AbortSignal
  onProgress?: (percent: number) => void
}

interface VideoStream {
  codec_name?: string
  profile?: string
  width?: number
  height?: number
  pix_fmt?: string
  color_space?: string
  color_transfer?: string
  color_primaries?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  nb_frames?: string
  duration?: string
  bit_rate?: string
  side_data_list?: Array<Record<string, unknown>>
}

interface MediaProbeJson {
  streams?: Array<VideoStream & { codec_type?: string }>
  format?: { duration?: string; bit_rate?: string }
}

function toolPath(name: 'dovi_tool' | 'mp4mux'): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  if (app.isPackaged) return path.join(process.resourcesPath, 'dolby-vision', `${name}${ext}`)
  const local = path.join(process.env.APP_ROOT ?? path.join(import.meta.dirname, '..'), 'resources', 'dolby-vision', `${name}${ext}`)
  return local
}

async function executable(name: 'dovi_tool' | 'mp4mux'): Promise<string> {
  const bundled = toolPath(name)
  try {
    await access(bundled, constants.X_OK)
    return bundled
  } catch {
    if (!app.isPackaged) return name
    throw new Error('Dolby Vision 导出组件缺失，请重新安装应用')
  }
}

async function run(command: string, args: string[], signal?: AbortSignal, onOutput?: (text: string) => void): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let output = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(output)
    }
    const abort = () => {
      child.kill('SIGTERM')
      finish(new DOMException('导出已取消', 'AbortError'))
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    const collect = (chunk: Buffer | string) => {
      const text = chunk.toString()
      output = (output + text).slice(-64_000)
      onOutput?.(text)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => finish(error))
    child.on('close', (code) => finish(code === 0 ? undefined : new Error(output.trim() || `${path.basename(command)} 执行失败 (${code})`)))
  })
}

async function ffprobe(filePath: string): Promise<MediaProbeJson> {
  const output = await run(getFfprobePath(), [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath,
  ])
  return JSON.parse(output) as MediaProbeJson
}

function videoStream(probe: MediaProbeJson): VideoStream | undefined {
  return probe.streams?.find((stream) => stream.codec_type === 'video')
}

function frameRateNumber(value: string | undefined): number {
  if (!value) return 0
  const parts = value.split('/')
  const numerator = Number(parts[0])
  const denominator = Number(parts[1] ?? 1)
  return denominator > 0 ? numerator / denominator : 0
}

export function parseDolbyVisionProbe(probe: MediaProbeJson): DolbyVisionProbeResult {
  const stream = videoStream(probe)
  if (!stream) return { eligible: false, reason: '未找到视频轨道' }
  const dovi = stream.side_data_list?.find((item) => item.side_data_type === 'DOVI configuration record')
  const profile = Number(dovi?.dv_profile)
  const compatibilityId = Number(dovi?.dv_bl_signal_compatibility_id)
  const baseValid = stream.codec_name === 'hevc'
    && stream.profile === 'Main 10'
    && stream.pix_fmt === 'yuv420p10le'
    && stream.color_primaries === 'bt2020'
    && stream.color_transfer === 'arib-std-b67'
    && stream.color_space === 'bt2020nc'
  const eligible = baseValid && profile === 8 && compatibilityId === 4 && Number(dovi?.rpu_present_flag) === 1
  return {
    eligible,
    profile: Number.isFinite(profile) ? profile : undefined,
    compatibilityId: Number.isFinite(compatibilityId) ? compatibilityId : undefined,
    frameCount: Number(stream.nb_frames) || undefined,
    width: stream.width,
    height: stream.height,
    frameRate: stream.avg_frame_rate || stream.r_frame_rate,
    reason: eligible ? undefined : '仅支持 HEVC Main 10、BT.2020 HLG 的 Dolby Vision 8.4 视频',
  }
}

export async function probeDolbyVision(filePath: string): Promise<DolbyVisionProbeResult> {
  if (!path.isAbsolute(filePath)) return { eligible: false, reason: '视频路径无效' }
  try {
    return parseDolbyVisionProbe(await ffprobe(filePath))
  } catch {
    return { eligible: false, reason: '无法读取 Dolby Vision 信息' }
  }
}

function overlayExpression(positioning: DolbyVisionWatermarkExportRequest['positioning']): { x: string; y: string } {
  const mx = Math.max(0, positioning.marginX ?? 0)
  const my = Math.max(0, positioning.marginY ?? 0)
  const left = `round(main_w*${mx})`
  const right = `main_w-overlay_w-round(main_w*${mx})`
  const top = `round(main_h*${my})`
  const bottom = `main_h-overlay_h-round(main_h*${my})`
  switch (positioning.anchor) {
    case 'top-left': return { x: left, y: top }
    case 'top-center': return { x: '(main_w-overlay_w)/2', y: top }
    case 'top-right': return { x: right, y: top }
    case 'center': return { x: '(main_w-overlay_w)/2', y: '(main_h-overlay_h)/2' }
    case 'bottom-left': return { x: left, y: bottom }
    case 'bottom-right': return { x: right, y: bottom }
    default: return { x: '(main_w-overlay_w)/2', y: bottom }
  }
}

function encoderCandidates(): Array<{ name: string; args: string[] }> {
  const common = ['-pix_fmt', 'p010le', '-bf', '0']
  if (process.platform === 'darwin') {
    return [
      { name: 'hevc_videotoolbox', args: ['-c:v', 'hevc_videotoolbox', '-profile:v', 'main10', ...common] },
      { name: 'libx265', args: ['-c:v', 'libx265', '-profile:v', 'main10', ...common, '-x265-params', 'bframes=0'] },
    ]
  }
  if (process.platform === 'win32') {
    return [
      { name: 'hevc_nvenc', args: ['-c:v', 'hevc_nvenc', '-profile:v', 'main10', ...common] },
      { name: 'hevc_qsv', args: ['-c:v', 'hevc_qsv', '-profile:v', 'main10', ...common] },
      { name: 'libx265', args: ['-c:v', 'libx265', '-profile:v', 'main10', ...common, '-x265-params', 'bframes=0'] },
    ]
  }
  return [{ name: 'libx265', args: ['-c:v', 'libx265', '-profile:v', 'main10', ...common, '-x265-params', 'bframes=0'] }]
}

function assertRequest(request: DolbyVisionWatermarkExportRequest): void {
  if (!path.isAbsolute(request.sourcePath) || !path.isAbsolute(request.outputPath) || !path.isAbsolute(request.watermarkPath)) {
    throw new Error('Dolby Vision 导出路径无效')
  }
  if (request.sourcePath === request.outputPath || path.extname(request.outputPath).toLowerCase() !== '.mp4') {
    throw new Error('Dolby Vision 输出文件无效')
  }
  if (!(request.positioning.targetWidth > 0 && request.positioning.targetWidth <= 1)) {
    throw new Error('Dolby Vision 水印尺寸无效')
  }
}

export async function exportDolbyVisionWatermark(
  request: DolbyVisionWatermarkExportRequest,
  callbacks: DolbyVisionExportCallbacks = {},
): Promise<void> {
  assertRequest(request)
  await Promise.all([access(request.sourcePath), access(request.watermarkPath)])
  const sourceProbe = await ffprobe(request.sourcePath)
  const eligibility = parseDolbyVisionProbe(sourceProbe)
  if (!eligibility.eligible) throw new Error(eligibility.reason || '该视频不支持 Dolby Vision 保真导出')
  const sourceVideo = videoStream(sourceProbe)!
  const fps = frameRateNumber(sourceVideo.avg_frame_rate || sourceVideo.r_frame_rate)
  if (!fps || !eligibility.width || !eligibility.height) throw new Error('无法读取原视频规格')
  const duration = Number(sourceVideo.duration ?? sourceProbe.format?.duration) || 0
  const bitrate = resolveDolbyVisionBitrate(sourceVideo.bit_rate, sourceProbe.format?.bit_rate)
  const ffmpeg = getFfmpegPath()
  const dovi = await executable('dovi_tool')
  const mp4mux = await executable('mp4mux')
  const tempDir = await mkdtemp(path.join(app.getPath('temp'), 'luna-dolby-'))
  const sourceHevc = path.join(tempDir, 'source.hevc')
  const baseHevc = path.join(tempDir, 'base.hevc')
  const rpu = path.join(tempDir, 'rpu.bin')
  const encodedHevc = path.join(tempDir, 'encoded.hevc')
  const injectedHevc = path.join(tempDir, 'injected.hevc')
  const partialOutput = `${request.outputPath}.partial-${Date.now()}.mp4`
  const progress = (value: number) => callbacks.onProgress?.(Math.max(0, Math.min(99, Math.round(value))))
  try {
    progress(2)
    await run(ffmpeg, ['-v', 'error', '-i', request.sourcePath, '-map', '0:v:0', '-c:v', 'copy', '-bsf:v', 'hevc_mp4toannexb', '-y', sourceHevc], callbacks.signal)
    progress(8)
    await run(dovi, ['extract-rpu', '-i', sourceHevc, '-o', rpu], callbacks.signal)
    await run(dovi, ['remove', '-i', sourceHevc, '-o', baseHevc], callbacks.signal)
    progress(12)

    const position = overlayExpression(request.positioning)
    const width = Math.max(2, Math.round(eligibility.width * request.positioning.targetWidth / 2) * 2)
    const filter = `[0:v]format=p010le,setparams=range=limited:color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc[base];[1:v]scale=${width}:-2:flags=lanczos,format=rgba,colorchannelmixer=rr=0.90:gg=0.90:bb=0.90,format=yuva444p10le[wm];[base][wm]overlay=x=${position.x}:y=${position.y}:format=yuv420p10:shortest=1[out]`
    let encoded = false
    let lastError: unknown
    for (const candidate of encoderCandidates()) {
      await rm(encodedHevc, { force: true })
      try {
        const args = [
          '-v', 'error', '-i', baseHevc, '-loop', '1', '-i', request.watermarkPath,
          '-filter_complex', filter, '-map', '[out]', '-an', ...candidate.args,
          '-b:v', String(bitrate), '-maxrate', String(Math.round(bitrate * 1.5)), '-bufsize', String(bitrate * 2),
          '-color_range', 'tv', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc',
          '-progress', 'pipe:2', '-nostats', '-f', 'hevc', '-y', encodedHevc,
        ]
        let progressText = ''
        await run(ffmpeg, args, callbacks.signal, (chunk) => {
          progressText = (progressText + chunk).slice(-2048)
          const matches = [...progressText.matchAll(/out_time_ms=(\d+)/g)]
          const time = Number(matches[matches.length - 1]?.[1]) / 1_000_000
          if (duration > 0 && Number.isFinite(time)) progress(12 + (time / duration) * 70)
        })
        encoded = true
        break
      } catch (error) {
        if (callbacks.signal?.aborted) throw error
        lastError = error
      }
    }
    if (!encoded) throw lastError instanceof Error ? lastError : new Error('没有可用的 10-bit HEVC 编码器')
    progress(84)
    await run(dovi, ['inject-rpu', '-i', encodedHevc, '-r', rpu, '-o', injectedHevc], callbacks.signal)
    const encodedSps = await readHevcSpsConfiguration(injectedHevc)
    if (encodedSps.profileIdc !== 2 || encodedSps.chromaFormat !== 1
      || encodedSps.lumaBitDepth !== 10 || encodedSps.chromaBitDepth !== 10
      || encodedSps.numTemporalLayers < 1) {
      throw new Error('HEVC 编码结果不是受支持的 Main 10 4:2:0 视频')
    }
    progress(90)
    const videoTrack = `h265:${injectedHevc}#dv_profile=8,dv_bc=4,frame_rate=${fps},format=hvc1`
    const hasAudio = sourceProbe.streams?.some((stream) => stream.codec_type === 'audio')
    const muxArgs = ['--track', videoTrack]
    if (hasAudio) muxArgs.push('--track', `mp4:${request.sourcePath}#track=audio`)
    muxArgs.push(partialOutput)
    await run(mp4mux, muxArgs, callbacks.signal)
    await repairHvccFromSps(partialOutput, encodedSps)
    const repairedHvcc = await readHvccConfigurations(partialOutput)
    if (repairedHvcc.length !== 1 || !hvccMatchesSps(repairedHvcc[0], encodedSps)) {
      throw new Error('Dolby Vision 输出的 hvcC 配置与 HEVC 码流不一致')
    }
    progress(96)
    const outputProbeJson = await ffprobe(partialOutput)
    const outputProbe = parseDolbyVisionProbe(outputProbeJson)
    if (!outputProbe.eligible) {
      throw new Error('未能生成有效的 Dolby Vision 文件')
    }
    await rename(partialOutput, request.outputPath)
    callbacks.onProgress?.(100)
  } finally {
    await rm(partialOutput, { force: true }).catch(() => {})
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
