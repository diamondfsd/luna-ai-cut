import { FfmpegPipeline, getFfmpegPath } from './ffmpeg/pipeline'
import { detectHardwareAccel } from './ffmpeg/hwaccel'
import { CodecModule } from './ffmpeg/codec'
import { ScaleModule } from './ffmpeg/scale'
import { FrameRateModule } from './ffmpeg/framerate'
import { BitrateModule } from './ffmpeg/bitrate'
import { WatermarkModule } from './ffmpeg/watermark'
import type { VideoExportSettings, WatermarkPosition, WatermarkStyle } from '../src/shared/types'

// ─── 视频水印（pipeline 包装） ───────────────

export async function applyWatermarkToVideo(
  inputPath: string,
  outputPath: string,
  watermarkPercent: number,
  position: WatermarkPosition,
  style: WatermarkStyle,
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
  if (videoExportSettings?.quality && videoExportSettings.quality !== 'original') {
    pipeline.addModule(new BitrateModule({ quality: videoExportSettings.quality, customBitrate: videoExportSettings.customBitrate }))
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
  if (videoExportSettings.quality !== 'original') {
    pipeline.addModule(new BitrateModule({ quality: videoExportSettings.quality, customBitrate: videoExportSettings.customBitrate }))
  }
  pipeline.addModule(new CodecModule({
    encoderH264: hwaccel.encoderNameH264,
    encoderH265: hwaccel.encoderNameH265 ?? undefined,
    encoderArgs: hwaccel.encoderArgs,
  }))

  await pipeline.execute(inputPath, outputPath, onProgress, signal)
}
