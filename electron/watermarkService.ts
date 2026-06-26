import { execFile } from 'node:child_process'
import { app } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'

import { localThumbnailUrl, safeName } from './filePathUtils'
import { previewCacheDir } from './settingsService'
import { FfmpegPipeline, getFfmpegPath, probeMedia } from './ffmpeg/pipeline'
import { CodecModule } from './ffmpeg/codec'
import { ScaleModule } from './ffmpeg/scale'
import { FrameRateModule } from './ffmpeg/framerate'
import { BitrateModule } from './ffmpeg/bitrate'
import { WatermarkModule } from './ffmpeg/watermark'
import type {
  LunaFile,
  PreviewResult,
  VideoExportSettings,
  WatermarkPosition,
  WatermarkSettings,
  WatermarkSize,
  WatermarkStyle,
} from '../src/shared/types'

const execFileAsync = promisify(execFile)

const WATERMARK_SCALE: Record<WatermarkSize, number> = {
  small: 0.08,
  medium: 0.12,
  large: 0.18,
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

// ─── 图片水印（独立路径，不经过 pipeline） ─────

interface ImageInfo {
  width: number
  height: number
}

/** 获取 ffprobe 路径 */
function getFfprobePath(): string {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : ''
    return path.join(process.resourcesPath, 'ffmpeg', `ffprobe${ext}`)
  }
  try {
    const pkgDir = path.dirname(require.resolve('ffprobe-static/package.json'))
    return path.join(pkgDir, 'bin', process.platform, process.arch, `ffprobe${process.platform === 'win32' ? '.exe' : ''}`)
  } catch {
    return 'ffprobe'
  }
}

/** 用 ffprobe 获取图片宽高 */
async function probeImage(inputPath: string): Promise<ImageInfo> {
  try {
    const { stdout } = await execFileAsync(getFfprobePath(), [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      inputPath,
    ], { encoding: 'utf-8' } as never)
    const data = JSON.parse(String(stdout)) as {
      streams?: Array<{ codec_type: string; width?: number; height?: number }>
    }
    // Live Photo 文件可能有多个 video stream（图片 + 内嵌 MP4），取第一个
    const videoStream = data.streams?.find((s) => s.codec_type === 'video')
    return { width: videoStream?.width ?? 1920, height: videoStream?.height ?? 1080 }
  } catch {
    return { width: 1920, height: 1080 }
  }
}

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
  return applyWatermarkToImageWithRef(inputPath, outputPath, size, position, style)
}

/**
 * 以指定参考分辨率计算水印大小和位置
 * 用于 Live Photo，让图片和视频水印视觉一致
 * refWidth/refHeight 不传时以图片实际尺寸为参考
 */
async function applyWatermarkToImageWithRef(
  inputPath: string,
  outputPath: string,
  size: WatermarkSize,
  position: WatermarkPosition,
  style: WatermarkStyle,
  refWidth?: number,
  refHeight?: number,
): Promise<void> {
  const ffmpegPath = getFfmpegPath()
  const wmPath = watermarkFileFor('image', style)

  const imgInfo = await probeImage(inputPath)
  const wmInfo = await probeImage(wmPath)

  const baseWidth = refWidth ?? imgInfo.width
  const baseHeight = refHeight ?? imgInfo.height

  // 以参考尺寸计算水印大小
  const wmRatio = wmInfo.height / wmInfo.width
  const refWmWidth = Math.min(Math.round(baseWidth * WATERMARK_SCALE[size]), wmInfo.width)
  const refWmHeight = Math.round(refWmWidth * wmRatio)
  const refMargin = Math.round(baseWidth * 0.03)

  // 按图片与参考尺寸的比例缩放位置和大小
  const scaleX = imgInfo.width / baseWidth
  const scaleY = imgInfo.height / baseHeight

  const actualWmWidth = Math.round(refWmWidth * scaleX)
  const actualWmHeight = Math.round(refWmHeight * scaleY)
  const marginX = Math.round(refMargin * scaleX)
  const marginY = Math.round(refMargin * scaleY)

  const [vPos, hPos] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  const x = hPos === 'left'
    ? marginX
    : hPos === 'right'
      ? imgInfo.width - actualWmWidth - marginX
      : Math.round((imgInfo.width - actualWmWidth) / 2)
  const y = vPos === 'bottom'
    ? imgInfo.height - actualWmHeight - marginY
    : marginY

  console.log('[LIVE watermark IMG]', {
    imgWidth: imgInfo.width, imgHeight: imgInfo.height,
    refWidth: baseWidth, refHeight: baseHeight,
    scaleX, scaleY,
    refWmWidth, refWmHeight, refMargin,
    actualWmWidth, actualWmHeight, marginX, marginY,
    position, x, y,
  })

  const outputExt = path.extname(outputPath).toLowerCase()
  const encoder = ffmpegImgEncoder(outputExt)

  await execFileAsync(ffmpegPath, [
    '-i', inputPath,
    '-i', wmPath,
    '-filter_complex',
    `[1:v]scale=${actualWmWidth}:-1[wm];[0:v][wm]overlay=${x}:${y}`,
    ...encoder,
    '-map_metadata', '0',
    '-y',
    outputPath,
  ], { timeout: 30000 } as never)
}

// ─── Live Photo 处理 ─────────────────────────

async function extractLivePhotoVideo(livPath: string, destination: string): Promise<string | null> {
  const data = await fs.readFile(livPath)
  const marker = Buffer.from('ftyp', 'ascii')
  const ftypOffset = data.indexOf(marker)
  const mp4Offset = ftypOffset - 4
  if (ftypOffset < 4 || mp4Offset <= 0) return null
  const boxSize = data.readUInt32BE(mp4Offset)
  if (boxSize < 8 || boxSize > data.length - mp4Offset) return null
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, data.subarray(mp4Offset))
  return destination
}

export async function applyWatermarkToLivePhoto(
  inputPath: string,
  outputPath: string,
  size: WatermarkSize,
  position: WatermarkPosition,
  style: WatermarkStyle,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  _videoExportSettings?: VideoExportSettings,
): Promise<void> {
  const tmpDir = path.dirname(outputPath)
  const extractedVideo = path.join(tmpDir, `_live_extracted.mp4`)
  const watermarkedImage = path.join(tmpDir, `_live_img.jpg`)
  const processedVideo = path.join(tmpDir, `_live_video.mp4`)

  try {
    console.log('[LIVE] applyWatermarkToLivePhoto called', { inputPath, outputPath, size, position, style })
    const extracted = await extractLivePhotoVideo(inputPath, extractedVideo)
    if (!extracted) throw new Error('无法提取 Live Photo 内嵌视频')

    // Live Photo 视频保持原始，不应用导出参数
    const videoProbe = await probeMedia(extractedVideo)
    const vidW = videoProbe.videoWidth
    const vidH = videoProbe.videoHeight
    console.log('[LIVE photo]', { videoProbe, source: inputPath })

    // 图片水印以原始视频分辨率为参考，保持视觉一致
    await applyWatermarkToImageWithRef(inputPath, watermarkedImage, size, position, style, vidW, vidH)

    // 视频仅加水印，保持原始分辨率/帧率/码率
    const pipeline = new FfmpegPipeline()
    pipeline.addModule(new WatermarkModule({ size, position, style }))
    pipeline.addModule(new CodecModule())
    await pipeline.execute(extractedVideo, processedVideo,
      (pct) => onProgress?.(Math.round(pct * 0.6 + 30)), signal)

    // 检查处理后的文件
    const vidStat = await fs.stat(processedVideo).catch(() => null)
    const imgStat = await fs.stat(watermarkedImage).catch(() => null)
    const origStat = await fs.stat(extractedVideo).catch(() => null)
    console.log('[LIVE] post-process sizes:', {
      origVideo: origStat?.size,
      processedVideo: vidStat?.size,
      watermarkedImage: imgStat?.size,
    })

    const imgBytes = await fs.readFile(watermarkedImage)
    const vidBytes = await fs.readFile(processedVideo)
    await fs.writeFile(outputPath, Buffer.concat([imgBytes, vidBytes]))
    const outStat = await fs.stat(outputPath).catch(() => null)
    console.log('[LIVE] output file:', { size: outStat?.size })
    onProgress?.(100)
  } finally {
    await fs.rm(extractedVideo, { force: true }).catch(() => {})
    await fs.rm(watermarkedImage, { force: true }).catch(() => {})
    await fs.rm(processedVideo, { force: true }).catch(() => {})
  }
}

// ─── 视频水印（pipeline 包装） ───────────────

export async function applyWatermarkToVideo(
  inputPath: string,
  outputPath: string,
  size: WatermarkSize,
  position: WatermarkPosition,
  style: WatermarkStyle,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  videoExportSettings?: VideoExportSettings,
): Promise<void> {
  const pipeline = new FfmpegPipeline()

  // 模块顺序决定 filter 链顺序
  if (videoExportSettings?.resolution && videoExportSettings.resolution !== 'original') {
    pipeline.addModule(new ScaleModule({ resolution: videoExportSettings.resolution }))
  }
  pipeline.addModule(new WatermarkModule({ size, position, style }))
  if (videoExportSettings?.frameRate && videoExportSettings.frameRate !== 'original') {
    pipeline.addModule(new FrameRateModule({ frameRate: videoExportSettings.frameRate }))
  }
  if (videoExportSettings?.quality && videoExportSettings.quality !== 'original') {
    pipeline.addModule(new BitrateModule({ quality: videoExportSettings.quality, customBitrate: videoExportSettings.customBitrate }))
  }
  pipeline.addModule(new CodecModule())

  await pipeline.execute(inputPath, outputPath, onProgress, signal)
}

// ─── 纯视频转码（无水印，pipeline 包装） ──────

export async function applyVideoExportSettings(
  inputPath: string,
  outputPath: string,
  videoExportSettings: VideoExportSettings,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pipeline = new FfmpegPipeline()

  if (videoExportSettings.resolution !== 'original') {
    pipeline.addModule(new ScaleModule({ resolution: videoExportSettings.resolution }))
  }
  if (videoExportSettings.frameRate !== 'original') {
    pipeline.addModule(new FrameRateModule({ frameRate: videoExportSettings.frameRate }))
  }
  if (videoExportSettings.quality !== 'original') {
    pipeline.addModule(new BitrateModule({ quality: videoExportSettings.quality, customBitrate: videoExportSettings.customBitrate }))
  }
  pipeline.addModule(new CodecModule())

  await pipeline.execute(inputPath, outputPath, onProgress, signal)
}

// ─── 水印预览 ────────────────────────────────

async function watermarkCachePath(sourcePath: string, settings: WatermarkSettings): Promise<string> {
  const dir = await previewCacheDir()
  const ext = path.extname(sourcePath)
  const base = path.basename(sourcePath, ext)
  const params = `wm_${settings.style}_${settings.size}_${settings.position}`
  return path.join(dir, `${safeName(base)}_${params}${ext}`)
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
