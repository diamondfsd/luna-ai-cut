import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

import { localThumbnailUrl, safeName } from './filePathUtils'
import { previewCacheDir } from './settingsService'
import type {
  LunaFile,
  PreviewResult,
  VideoExportSettings,
  WatermarkPosition,
  WatermarkSettings,
  WatermarkSize,
  WatermarkStyle,
} from '../src/shared/types'

const _require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

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

function getFfmpegPath(): string {
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

function getWatermarkDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'watermark')
  return path.join(app.getAppPath(), 'src', 'assets', 'watermark')
}

function watermarkFileFor(kind: 'image' | 'video', style: WatermarkStyle): string {
  const filenames: Record<WatermarkStyle, Record<'image' | 'video', string>> = {
    luna_ultra: {
      video: 'ic_watermark_luna_ultra.png',
      image: 'ic_watermark_luna_ultra_image.png',
    },
    luna_ultra_cn: {
      video: 'ic_watermark_luna_ultra_cn.png',
      image: 'ic_watermark_luna_ultra_image_cn.png',
    },
  }
  return path.join(getWatermarkDir(), filenames[style][kind])
}

const WATERMARK_SCALE: Record<WatermarkSize, number> = {
  small: 0.08,
  medium: 0.12,
  large: 0.18,
}

interface ImageInfo {
  width: number
  height: number
}

/** 用 ffprobe 获取图片宽高（优雅降级到默认值） */
async function probeImage(inputPath: string): Promise<ImageInfo> {
  try {
    const { stdout } = await execFileAsync(getFfprobePath(), [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      inputPath,
    ], { encoding: 'utf-8' })
    const data = JSON.parse(stdout) as {
      streams?: Array<{ codec_type: string; width?: number; height?: number }>
    }
    const videoStream = data.streams?.find((s) => s.codec_type === 'video')
    return {
      width: videoStream?.width ?? 1920,
      height: videoStream?.height ?? 1080,
    }
  } catch {
    return { width: 1920, height: 1080 }
  }
}

interface MediaProbe {
  durationSeconds: number | null
  videoBitrate: number | null
  videoCodec: string | null
  videoWidth: number
  videoHeight: number
}

async function probeMedia(inputPath: string): Promise<MediaProbe> {
  const fallback: MediaProbe = {
    durationSeconds: null,
    videoBitrate: null,
    videoCodec: null,
    videoWidth: 1920,
    videoHeight: 1080,
  }

  try {
    const { stdout } = await execFileAsync(getFfprobePath(), [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ], { encoding: 'utf-8' })
    const data = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string }
      streams?: Array<{
        codec_type: string
        codec_name?: string
        width?: number
        height?: number
        bit_rate?: string
      }>
    }
    const videoStream = data.streams?.find((stream) => stream.codec_type === 'video')
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

/** 分辨率预设映射 */
const RESOLUTION_MAP: Record<string, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
}

/** 画质预设码率映射 */
const QUALITY_BITRATES: Record<string, string> = {
  high: '50M',
  medium: '20M',
  low: '10M',
}

/** 构建分辨率缩放 filter 字符串 */
function scaleFilter(targetWidth: number, targetHeight: number): string {
  return `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1`
}

function videoCodecArgs(codec: string | null): string[] {
  // libx265 默认输出 hev1 标签，QuickTime Player 只认 hvc1
  if (codec === 'hevc' || codec === 'h265') return ['-c:v', 'libx265', '-tag:v', 'hvc1']
  if (codec === 'prores') return ['-c:v', 'prores_ks']
  return ['-c:v', 'libx264']
}

function videoBitrateArgs(bitrate: number | string | null): string[] {
  // -pix_fmt yuv420p: QuickTime Player 不支持 yuv444p，必须显式指定 yuv420p
  if (!bitrate) return ['-crf', '18', '-pix_fmt', 'yuv420p']
  const b = typeof bitrate === 'number' ? String(bitrate) : bitrate
  // 提取数值和后缀（如 "20M" → 20, "M"）
  const match = b.match(/^(\d+)([kKM]?)$/)
  const num = match ? parseInt(match[1]) : 0
  const suffix = match?.[2] || ''
  return ['-b:v', b, '-maxrate', b, '-bufsize', `${num * 2}${suffix}`, '-pix_fmt', 'yuv420p']
}

/** 根据输出扩展名选择 ffmpeg 图片编码器参数（最高质量保留） */
function ffmpegImgEncoder(ext: string): string[] {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return ['-c:v', 'mjpeg', '-q:v', '1']
    case '.png':
      return ['-c:v', 'png']
    case '.webp':
      return ['-c:v', 'libwebp', '-quality', '100']
    default:
      return ['-c:v', 'libwebp', '-quality', '100', '-lossless', '1']
  }
}

export async function applyWatermarkToImage(
  inputPath: string,
  outputPath: string,
  size: WatermarkSize,
  position: WatermarkPosition,
  style: WatermarkStyle,
): Promise<void> {
  const ffmpegPath = getFfmpegPath()
  const wmPath = watermarkFileFor('image', style)

  // 获取原图尺寸
  const imgInfo = await probeImage(inputPath)

  // 获取水印 PNG 尺寸
  const wmInfo = await probeImage(wmPath)

  // 计算水印缩放后的实际尺寸（withoutEnlargement 语义：不超过原始水印宽）
  const wmRatio = wmInfo.height / wmInfo.width
  const targetWmWidth = Math.round(imgInfo.width * WATERMARK_SCALE[size])
  const actualWmWidth = Math.min(targetWmWidth, wmInfo.width)
  const actualWmHeight = Math.round(actualWmWidth * wmRatio)

  // 计算位置
  const margin = Math.round(imgInfo.width * 0.03)
  const [vPos, hPos] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  const x = hPos === 'left'
    ? margin
    : hPos === 'right'
      ? Math.round(imgInfo.width - actualWmWidth - margin)
      : Math.round((imgInfo.width - actualWmWidth) / 2)
  const y = vPos === 'bottom'
    ? Math.round(imgInfo.height - actualWmHeight - margin)
    : margin

  // 输出编码器根据输出文件扩展名决定
  const outputExt = path.extname(outputPath).toLowerCase()
  const encoder = ffmpegImgEncoder(outputExt)

  // ffmpeg overlay：缩放水印 → 合成
  await execFileAsync(ffmpegPath, [
    '-i', inputPath,
    '-i', wmPath,
    '-filter_complex',
    `[1:v]scale=${actualWmWidth}:-1[wm];[0:v][wm]overlay=${x}:${y}`,
    ...encoder,
    '-map_metadata', '0',
    '-y',
    outputPath,
  ], { timeout: 30000 })
}

export async function applyWatermarkToVideo(
  inputPath: string,
  outputPath: string,
  size: WatermarkSize,
  position: WatermarkPosition,
  style: WatermarkStyle,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  /** 视频导出参数（分辨率/帧率/码率），不传则保持原始 */
  videoExportSettings?: VideoExportSettings,
): Promise<void> {
  const ffmpegPath = getFfmpegPath()
  const wmPath = watermarkFileFor('video', style)
  const media = await probeMedia(inputPath)
  const { durationSeconds, videoBitrate, videoCodec, videoWidth, videoHeight } = media

  // 判断是否真的需要添加水印（相比 videoExportSettings，水印是独立控制的）
  const hasWatermark = true // 此函数始终由「需要水印」的场景调用

  // 1️⃣ 计算目标分辨率和帧率
  const res = videoExportSettings?.resolution
    ? RESOLUTION_MAP[videoExportSettings.resolution]
    : null
  const targetWidth = res?.width ?? videoWidth
  const targetHeight = res?.height ?? videoHeight
  const needsScale = targetWidth !== videoWidth || targetHeight !== videoHeight

  // 帧率参数
  const frameRate = videoExportSettings?.frameRate
    ? (videoExportSettings.frameRate !== 'original' ? videoExportSettings.frameRate : null)
    : null

  // 码率参数
  let bitrateOverride: string | null = null
  if (videoExportSettings?.quality && videoExportSettings.quality !== 'original') {
    bitrateOverride = QUALITY_BITRATES[videoExportSettings.quality]
  }

  // 2️⃣ 计算水印位置（基于目标分辨率）
  const wmTargetWidth = Math.round(targetWidth * WATERMARK_SCALE[size])
  const marginPx = Math.round(targetWidth * 0.03)
  const [vPos, hPos] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  const x = hPos === 'left'
    ? marginPx
    : hPos === 'right'
      ? targetWidth - wmTargetWidth - marginPx
      : Math.round((targetWidth - wmTargetWidth) / 2)
  let y = marginPx
  if (vPos === 'bottom') {
    const wmInfo = await probeImage(wmPath)
    const wmRatio = wmInfo.height / wmInfo.width
    y = Math.round(targetHeight - wmTargetWidth * wmRatio - marginPx)
  }

  // 3️⃣ 构建 ffmpeg 参数
  const args: string[] = ['-i', inputPath, '-i', wmPath]

  // 3a. filter_complex：缩放 + 水印合成
  if (needsScale && hasWatermark) {
    // 先缩放视频，再叠加缩放后的水印
    args.push(
      '-filter_complex',
      `[0:v]${scaleFilter(targetWidth, targetHeight)}[v0];[1:v]scale=${wmTargetWidth}:-1[wm];[v0][wm]overlay=${x}:${y}`,
    )
  } else if (needsScale) {
    // 仅缩放，无水印
    args.push('-vf', scaleFilter(targetWidth, targetHeight))
  } else if (hasWatermark) {
    // 仅水印，不缩放
    args.push(
      '-filter_complex',
      `[1:v]scale=${wmTargetWidth}:-1[wm];[0:v][wm]overlay=${x}:${y}`,
    )
  }

  // 3b. 帧率
  if (frameRate) {
    args.push('-r', frameRate)
  }

  // 3c. 编码器和码率
  args.push(...videoCodecArgs(videoCodec))
  if (bitrateOverride) {
    args.push(...videoBitrateArgs(bitrateOverride))
  } else {
    args.push(...videoBitrateArgs(videoBitrate))
  }

  // 3d. 音频
  args.push('-c:a', 'aac', '-b:a', '192k')

  // 3e. 通用参数
  args.push('-map_metadata', '0', '-progress', 'pipe:2', '-nostats', '-y', outputPath)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args)

    const abort = (): void => {
      child.kill('SIGTERM')
      reject(new DOMException('导出已取消', 'AbortError'))
    }

    if (signal?.aborted) {
      abort()
      return
    }

    signal?.addEventListener('abort', abort, { once: true })

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      const match = chunk.match(/out_time_ms=(\d+)/)
      if (match && durationSeconds) {
        const seconds = Number(match[1]) / 1_000_000
        onProgress?.(Math.max(1, Math.min(99, (seconds / durationSeconds) * 100)))
      }
    })
    child.on('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return
      if (code === 0) {
        onProgress?.(100)
        resolve()
        return
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
    })
  })
}

async function watermarkCachePath(sourcePath: string, settings: WatermarkSettings): Promise<string> {
  const dir = await previewCacheDir()
  const ext = path.extname(sourcePath)
  const base = path.basename(sourcePath, ext)
  const params = `wm_${settings.style}_${settings.size}_${settings.position}`
  return path.join(dir, `${safeName(base)}_${params}${ext}`)
}

/**
 * 仅应用视频导出参数（分辨率/帧率/码率），不添加水印
 * 当用户不需要水印但想要调整输出参数时使用
 */
export async function applyVideoExportSettings(
  inputPath: string,
  outputPath: string,
  videoExportSettings: VideoExportSettings,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const ffmpegPath = getFfmpegPath()
  const media = await probeMedia(inputPath)
  const { durationSeconds, videoBitrate, videoCodec, videoWidth, videoHeight } = media

  // 目标分辨率
  const res = videoExportSettings.resolution !== 'original'
    ? RESOLUTION_MAP[videoExportSettings.resolution]
    : null
  const targetWidth = res?.width ?? videoWidth
  const targetHeight = res?.height ?? videoHeight
  const needsScale = targetWidth !== videoWidth || targetHeight !== videoHeight

  // 帧率
  const frameRate = videoExportSettings.frameRate !== 'original' ? videoExportSettings.frameRate : null

  // 码率
  let bitrateOverride: string | null = null
  if (videoExportSettings.quality !== 'original') {
    bitrateOverride = QUALITY_BITRATES[videoExportSettings.quality]
  }

  const args: string[] = ['-i', inputPath]

  // 分辨率缩放
  if (needsScale) {
    args.push('-vf', scaleFilter(targetWidth, targetHeight))
  }

  // 帧率
  if (frameRate) {
    args.push('-r', frameRate)
  }

  // 编码和码率
  args.push(...videoCodecArgs(videoCodec))
  if (bitrateOverride) {
    args.push(...videoBitrateArgs(bitrateOverride))
  } else {
    args.push(...videoBitrateArgs(videoBitrate))
  }

  // 音频
  args.push('-c:a', 'aac', '-b:a', '192k')

  // 通用
  args.push('-map_metadata', '0', '-progress', 'pipe:2', '-nostats', '-y', outputPath)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args)

    const abort = (): void => {
      child.kill('SIGTERM')
      reject(new DOMException('导出已取消', 'AbortError'))
    }

    if (signal?.aborted) {
      abort()
      return
    }

    signal?.addEventListener('abort', abort, { once: true })

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      const match = chunk.match(/out_time_ms=(\d+)/)
      if (match && durationSeconds) {
        const seconds = Number(match[1]) / 1_000_000
        onProgress?.(Math.max(1, Math.min(99, (seconds / durationSeconds) * 100)))
      }
    })
    child.on('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return
      if (code === 0) {
        onProgress?.(100)
        resolve()
        return
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
    })
  })
}

export async function previewWithWatermark(
  file: LunaFile,
  sourcePath: string,
  settings: WatermarkSettings,
): Promise<PreviewResult> {
  if (file.kind !== 'image' && file.kind !== 'video') {
    return { fileName: file.name, kind: file.kind, source: null, cachedPath: null, message: '不支持的格式' }
  }
  if (!settings.enabled) {
    return { fileName: file.name, kind: file.kind, source: null, cachedPath: null, message: '水印未启用' }
  }

  const destPath = await watermarkCachePath(sourcePath, settings)
  try {
    await fs.access(destPath)
    return { fileName: file.name, kind: file.kind, source: localThumbnailUrl(destPath), cachedPath: destPath }
  } catch {
    // Generate below.
  }

  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    if (file.kind === 'image') {
      await applyWatermarkToImage(sourcePath, destPath, settings.size, settings.position, settings.style)
    } else {
      await applyWatermarkToVideo(sourcePath, destPath, settings.size, settings.position, settings.style)
    }
    return { fileName: file.name, kind: file.kind, source: localThumbnailUrl(destPath), cachedPath: destPath }
  } catch (error) {
    console.error('[watermark] 预览水印生成失败:', error)
    return { fileName: file.name, kind: file.kind, source: null, cachedPath: null, message: '水印生成失败' }
  }
}
