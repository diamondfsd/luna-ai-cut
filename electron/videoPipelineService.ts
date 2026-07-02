import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
const execFile = promisify(execFileCallback)
import * as path from 'node:path'
import { FfmpegPipeline, getFfmpegPath } from './ffmpeg/pipeline'
import { detectHardwareAccel } from './ffmpeg/hwaccel'
import { CodecModule } from './ffmpeg/codec'
import { ScaleModule } from './ffmpeg/scale'
import { FrameRateModule } from './ffmpeg/framerate'
import { BitrateModule } from './ffmpeg/bitrate'
import { WatermarkModule } from './ffmpeg/watermark'
import { ColorGradingModule } from './ffmpeg/colorGrading'
import type { VideoExportSettings, WatermarkPosition, WatermarkStyle } from '../src/shared/types'
import type { ColorGradingOptions } from './ffmpeg/colorGrading'
import { logMainInfo, logMainError } from './loggerService'

type ConcreteWatermarkStyle = Exclude<WatermarkStyle, 'auto'>

// ─── 视频水印（pipeline 包装） ───────────────

export async function applyWatermarkToVideo(
  inputPath: string,
  outputPath: string,
  watermarkPercent: number,
  position: WatermarkPosition,
  style: ConcreteWatermarkStyle,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  videoExportSettings?: VideoExportSettings,
): Promise<void> {
  const pipeline = new FfmpegPipeline()
  const hwaccel = await detectHardwareAccel(getFfmpegPath())

  if (hwaccel.preInputArgs.length > 0) {
    pipeline.setPreInputArgs(hwaccel.preInputArgs)
  }

  // 模块顺序决定 filter 链顺序
  if (videoExportSettings?.resolution && videoExportSettings.resolution !== 'original') {
    pipeline.addModule(new ScaleModule({ resolution: videoExportSettings.resolution }))
  }
  pipeline.addModule(new WatermarkModule({ watermarkPercent, position, style }, hwaccel.overlayFilter))
  if (videoExportSettings?.frameRate && videoExportSettings.frameRate !== 'original') {
    pipeline.addModule(new FrameRateModule({ frameRate: videoExportSettings.frameRate }))
  }

  // 码率：硬件编码器必须给显式 -b:v（否则默认 ~2mbps）
  // 原始画质 + 硬件编码 → 用源视频码率
  // 原始画质 + 软件编码 → 不给码率（libx264 用 CRF 模式）
  const quality = videoExportSettings?.quality ?? 'original'
  const useHwEncoder = hwaccel.type !== null
  if (quality !== 'original' || useHwEncoder) {
    pipeline.addModule(new BitrateModule({
      quality,
      customBitrate: videoExportSettings?.customBitrate,
      useSourceBitrate: quality === 'original' && useHwEncoder,
    }))
  }

  pipeline.addModule(new CodecModule({
    encoderH264: hwaccel.encoderNameH264,
    encoderH265: hwaccel.encoderNameH265 ?? undefined,
    encoderArgs: hwaccel.encoderArgs,
  }))

  await pipeline.execute(inputPath, outputPath, onProgress, signal)
}

// ─── 纯视频转码（无水印） ───────────────────

export async function applyVideoExportSettings(
  inputPath: string,
  outputPath: string,
  videoExportSettings: VideoExportSettings,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pipeline = new FfmpegPipeline()
  const hwaccel = await detectHardwareAccel(getFfmpegPath())

  if (hwaccel.preInputArgs.length > 0) {
    pipeline.setPreInputArgs(hwaccel.preInputArgs)
  }

  if (videoExportSettings.resolution !== 'original') {
    pipeline.addModule(new ScaleModule({ resolution: videoExportSettings.resolution }))
  }
  if (videoExportSettings.frameRate !== 'original') {
    pipeline.addModule(new FrameRateModule({ frameRate: videoExportSettings.frameRate }))
  }

  // 码率：硬件编码器必须给显式 -b:v
  const useHwEncoder = hwaccel.type !== null
  if (videoExportSettings.quality !== 'original' || useHwEncoder) {
    pipeline.addModule(new BitrateModule({
      quality: videoExportSettings.quality,
      customBitrate: videoExportSettings.customBitrate,
      useSourceBitrate: videoExportSettings.quality === 'original' && useHwEncoder,
    }))
  }
  pipeline.addModule(new CodecModule({
    encoderH264: hwaccel.encoderNameH264,
    encoderH265: hwaccel.encoderNameH265 ?? undefined,
    encoderArgs: hwaccel.encoderArgs,
  }))

  await pipeline.execute(inputPath, outputPath, onProgress, signal)
}

// ─── 调色导出（图片/视频共用，由文件扩展名决定编码） ─

export async function applyColorGrading(
  inputPath: string,
  outputPath: string,
  color: ColorGradingOptions,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const ext = path.extname(outputPath).toLowerCase()
  const isVid = ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)
  logMainInfo(`[applyColorGrading] 开始`, { inputPath, outputPath, isVid })

  const pipeline = new FfmpegPipeline()

  if (isVid) {
    const hwaccel = await detectHardwareAccel(getFfmpegPath())
    if (hwaccel.preInputArgs.length > 0) pipeline.setPreInputArgs(hwaccel.preInputArgs)

    // 调色滤镜
    pipeline.addModule(new ColorGradingModule(color))

    // 编码器 — 预览导出强制 H.264（比 HEVC 快 3-5x）
    pipeline.addModule(new CodecModule({
      encoderH264: hwaccel.encoderNameH264 ?? 'libx264',
      encoderH265: hwaccel.encoderNameH264 ?? 'libx264',
      encoderArgs: hwaccel.encoderArgs,
    }))
  } else {
    // 图片：仅调色滤镜，不加编码器
    pipeline.addModule(new ColorGradingModule(color))
  }

  logMainInfo(`[applyColorGrading] 执行 pipeline`)
  try {
    await pipeline.execute(inputPath, outputPath, onProgress, signal)
    logMainInfo(`[applyColorGrading] 完成`)
  } catch (err) {
    logMainError(`[applyColorGrading] 失败`, { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/**
 * 快速预览帧 — 降分辨率跑 ffmpeg 调色，用于替代 GLSL 预览
 * - 图片: 缩放到 maxSize，跑 filter，输出 PNG
 * - 视频: 提取指定时间帧，缩放，跑 filter，输出 PNG
 */
export async function previewColorFrame(
  sourcePath: string,
  outputPath: string,
  color: ColorGradingOptions,
  options?: { maxSize?: number; seekSeconds?: number },
): Promise<void> {
  const maxSize = options?.maxSize ?? 1920
  const ffmpeg = getFfmpegPath()
  const hwaccel = await detectHardwareAccel(ffmpeg)

  // Build filter string directly (same as ColorGradingModule.build)
  const filterStr = buildColorFilter(color)

  const ext = path.extname(sourcePath).toLowerCase()
  const isVid = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.insv'].includes(ext)

  const args: string[] = [...hwaccel.preInputArgs]
  if (isVid && options?.seekSeconds) {
    args.push('-ss', String(options.seekSeconds))
  }
  args.push('-i', sourcePath)

  // scale down + color filter
  const vfParts = [`scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`]
  if (filterStr) vfParts.push(filterStr)
  args.push('-vf', vfParts.join(','))

  args.push('-frames:v', '1', '-y', outputPath)
  logMainInfo(`[previewColorFrame] 执行`, { sourcePath, outputPath, args: args.join(' ') })
  await execFile(ffmpeg, args)
  logMainInfo(`[previewColorFrame] 完成`, { outputPath })
}

// 与 ColorGradingModule.build() 完全一致的 filter 构建
function buildColorFilter(color: ColorGradingOptions): string {
  const parts: string[] = []
  const eq: string[] = []
  const clamp = (v: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, v))
  if (color.exposure) { eq.push(`gamma=${(1+clamp(color.exposure,-5,5)/10).toFixed(3)}`) }
  if (color.brightness) { eq.push(`brightness=${(clamp(color.brightness,-100,100)/100).toFixed(3)}`) }
  if (color.contrast) { eq.push(`contrast=${(1+clamp(color.contrast,-100,100)/100).toFixed(3)}`) }
  if (color.saturation) { eq.push(`saturation=${(1+clamp(color.saturation,-100,100)/100).toFixed(3)}`) }
  if (eq.length) parts.push(`eq=${eq.join(':')}`)

  if (color.vibrance) parts.push(`vibrance=${(clamp(color.vibrance,-100,100)/100).toFixed(3)}`)

  if (color.temperature) {
    parts.push(`colortemperature=${Math.round(5500-clamp(color.temperature,-100,100)*30)}`)
  }

  const cb: string[] = []
  if (color.shadows) { const v=clamp(clamp(color.shadows,-100,100)/100*1.2,-1,1).toFixed(3); cb.push(`rs=${v}:gs=${v}:bs=${v}`) }
  if (color.highlights) { const v=clamp(clamp(color.highlights,-100,100)/100*1.2,-1,1).toFixed(3); cb.push(`rh=${v}:gh=${v}:bh=${v}`) }
  if (color.tint) { const v=clamp(clamp(color.tint,-100,100)/100*-0.214,-1,1).toFixed(3); cb.push(`gs=${v}:gm=${v}:gh=${v}`) }
  if (cb.length) parts.push(`colorbalance=${cb.join(':')}`)

  const cl: string[] = []
  if (color.levelsBlack) cl.push(`rimin=${clamp(color.levelsBlack,0,0.95).toFixed(3)}`)
  if (color.levelsWhite && color.levelsWhite !== 1) cl.push(`rimax=${clamp(color.levelsWhite,0.05,1.5).toFixed(3)}`)
  if (cl.length) parts.push(`colorlevels=${cl.join(':')}`)

  const us: string[] = []
  if (color.clarity) us.push(`luma_msize_x=9:luma_msize_y=9:luma_amount=${(clamp(color.clarity,-100,100)/100).toFixed(3)}`)
  if (color.texture) us.push(`luma_msize_x=5:luma_msize_y=5:luma_amount=${(clamp(color.texture,-100,100)/100).toFixed(3)}`)
  if (color.sharpen) us.push(`luma_msize_x=3:luma_msize_y=3:luma_amount=${(clamp(color.sharpen,0,100)/100*2).toFixed(3)}`)
  if (us.length) parts.push(`unsharp=${us.join(':')}`)

  if (color.denoise) { const s=clamp(color.denoise,0,100)/100*6; parts.push(`hqdn3d=${s.toFixed(2)}:${s.toFixed(2)}:${(s*0.5).toFixed(2)}:${(s*0.5).toFixed(2)}`) }

  return parts.join(',')
}
