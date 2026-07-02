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

// ─── 视频调色导出（工作台调用） ─────────────

export async function applyColorGradingToVideo(
  inputPath: string,
  outputPath: string,
  color: ColorGradingOptions,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  logMainInfo(`[applyColorGradingToVideo] 开始`, { inputPath, outputPath, hasOnProgress: !!onProgress })
  const pipeline = new FfmpegPipeline()
  const hwaccel = await detectHardwareAccel(getFfmpegPath())

  if (hwaccel.preInputArgs.length > 0) {
    pipeline.setPreInputArgs(hwaccel.preInputArgs)
  }

  // 调色滤镜（插入在水印/缩放之前）
  pipeline.addModule(new ColorGradingModule(color))

  // 编码器 — 工作台预览导出强制 H.264（比 HEVC 快 3-5x），和 Live Photo 导出一致
  pipeline.addModule(new CodecModule({
    encoderH264: hwaccel.encoderNameH264 ?? 'libx264',
    // HEVC 源也用 H.264 编码加速
    encoderH265: hwaccel.encoderNameH264 ?? 'libx264',
    encoderArgs: hwaccel.encoderArgs,
  }))

  logMainInfo(`[applyColorGradingToVideo] 执行 pipeline`)
  try {
    await pipeline.execute(inputPath, outputPath, onProgress, signal)
    logMainInfo(`[applyColorGradingToVideo] 完成`)
  } catch (err) {
    logMainError(`[applyColorGradingToVideo] 失败`, { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
