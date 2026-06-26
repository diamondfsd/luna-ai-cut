import { execFile } from 'node:child_process'
import { app } from 'electron'
import * as fs from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import exifr from 'exifr'

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
  WatermarkStyle,
} from '../src/shared/types'

const execFileAsync = promisify(execFile)

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

/** 将 JPEG 文件中的 EXIF Orientation 标签设为 1（正常方向），保留其他所有 EXIF */
function clearExifOrientation(filePath: string): boolean {
  let data: Buffer
  try {
    data = readFileSync(filePath)
  } catch { return false }

  const len = data.length
  let pos = 2 // skip SOI (0xFFD8)

  while (pos < len - 1) {
    if (data[pos] !== 0xFF) { pos++; continue }
    const marker = data[pos + 1]
    if (marker === 0xD8 || marker === 0xD9 || marker === 0x00) { pos++; continue }
    if (marker >= 0xD0 && marker <= 0xD7) { pos += 2; continue }

    const segLen = data.readUInt16BE(pos + 2)
    if (marker === 0xE1 && segLen >= 10 &&
        data.toString('ascii', pos + 4, pos + 10) === 'Exif\0\0') {
      // Found EXIF APP1 — TIFF header starts at pos + 10
      const tiff = pos + 10
      const le = data.toString('ascii', tiff, tiff + 2) === 'II'
      const r16 = (off: number) => le ? data.readUInt16LE(off) : data.readUInt16BE(off)
      const r32 = (off: number) => le ? data.readUInt32LE(off) : data.readUInt32BE(off)
      const w16 = (off: number, v: number) => le ? data.writeUInt16LE(v, off) : data.writeUInt16BE(v, off)

      if (r16(tiff + 2) !== 0x002A) { pos += 2 + segLen; continue }

      const ifd0 = tiff + r32(tiff + 4)
      const cnt = r16(ifd0)
      for (let i = 0; i < cnt; i++) {
        const entry = ifd0 + 2 + i * 12
        if (r16(entry) === 0x0112) { // Orientation tag
          const oldVal = r16(entry + 8)
          if (oldVal !== 1) {
            w16(entry + 8, 1) // Set to Normal (1)
            writeFileSync(filePath, data)
            return true
          }
          return true // Already 1, no change needed
        }
      }
      return false // Orientation tag not found
    }
    pos += 2 + segLen
  }
  return false
}

/** 从源 JPEG 复制 EXIF APP1 段到目标 JPEG（仅在目标没有 EXIF 时） */
function copyExifIfMissing(srcPath: string, dstPath: string): boolean {
  // 检查目标是否已有 EXIF
  let dstData: Buffer
  try { dstData = readFileSync(dstPath) } catch { return false }
  let pos = 2
  while (pos < dstData.length - 1) {
    if (dstData[pos] !== 0xFF) break
    const m = dstData[pos + 1]
    if (m === 0xD8 || m === 0xD9 || m === 0x00) { pos++; continue }
    if (m >= 0xD0 && m <= 0xD7) { pos += 2; continue }
    const segLen = dstData.readUInt16BE(pos + 2)
    if (m === 0xE1 && segLen >= 10 && dstData.toString('ascii', pos + 4, pos + 10) === 'Exif\0\0') {
      return true // Already has EXIF
    }
    pos += 2 + segLen
  }

  // 从源文件提取 APP1
  let srcData: Buffer
  try { srcData = readFileSync(srcPath) } catch { return false }
  pos = 2
  while (pos < srcData.length - 1) {
    if (srcData[pos] !== 0xFF) { pos++; continue }
    const m = srcData[pos + 1]
    if (m === 0xD8 || m === 0xD9 || m === 0x00) { pos++; continue }
    if (m >= 0xD0 && m <= 0xD7) { pos += 2; continue }
    const segLen = srcData.readUInt16BE(pos + 2)
    if (m === 0xE1 && segLen >= 10 && srcData.toString('ascii', pos + 4, pos + 10) === 'Exif\0\0') {
      // Insert APP1 after SOI in destination
      const app1 = srcData.subarray(pos, pos + 2 + segLen)
      const newData = Buffer.concat([
        dstData.subarray(0, 2), // SOI
        app1,
        dstData.subarray(2),
      ])
      writeFileSync(dstPath, newData)
      return true
    }
    pos += 2 + segLen
  }
  return false
}

function orientationToDegrees(orientation: number): number {
  // 1=正常, 3=180°, 6=90°CW, 8=90°CCW
  switch (orientation) {
    case 6: return 90
    case 3: return 180
    case 8: return 270
    default: return 0
  }
}

/** 获取图片的 EXIF 旋转角度（读取 Orientation 标签） */
async function getExifRotationDeg(inputPath: string): Promise<number> {
  try {
    // translateValues: false 确保返回数值（如 8）而非字符串（如 "Rotate 270 CW"）
    const data = await exifr.parse(inputPath, { translateValues: false }) as Record<string, unknown>
    const orientation = data?.Orientation
    if (typeof orientation === 'number') {
      return orientationToDegrees(orientation)
    }
  } catch { /* 忽略 EXIF 解析失败 */ }
  return 0
}

/** 将旋转角度映射到 ffmpeg transpose 模式（仅处理 90°/270°） */
function rotationToTranspose(deg: number): number | null {
  if (deg === 90) return 1  // 90° CW
  if (deg === 270) return 2 // 90° CCW
  return null
}

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
  watermarkPercent: number,
  position: WatermarkPosition,
  style: WatermarkStyle,
): Promise<void> {
  return applyWatermarkToImageWithRef(inputPath, outputPath, watermarkPercent, position, style)
}

/**
 * 以指定参考分辨率计算水印大小和位置
 * 用于 Live Photo，让图片和视频水印视觉一致
 * refWidth/refHeight 不传时以图片实际尺寸为参考
 */
async function applyWatermarkToImageWithRef(
  inputPath: string,
  outputPath: string,
  watermarkPercent: number,
  position: WatermarkPosition,
  style: WatermarkStyle,
  refWidth?: number,
  refHeight?: number,
): Promise<void> {
  const ffmpegPath = getFfmpegPath()
  const wmPath = watermarkFileFor('image', style)

  const imgInfo = await probeImage(inputPath)
  const wmInfo = await probeImage(wmPath)

  // 检测 EXIF 旋转，仅对独立图片（无 ref）处理
  const rotationDeg = refWidth === undefined || refHeight === undefined
    ? await getExifRotationDeg(inputPath)
    : 0
  const needTranspose = rotationToTranspose(rotationDeg) !== null

  // ── 水印输出方向尺寸 ──
  const displayW = needTranspose ? imgInfo.height : imgInfo.width
  const displayH = needTranspose ? imgInfo.width : imgInfo.height

  // ── 水印像素尺寸用传感器最长边（横竖图统一） ──
  const sensorW = refWidth ?? Math.max(imgInfo.width, imgInfo.height)
  const wmAspect = wmInfo.height / wmInfo.width
  const actualWmWidth = Math.min(Math.round(sensorW * watermarkPercent / 100), wmInfo.width)
  const actualWmHeight = Math.round(actualWmWidth * wmAspect)

  // ── 边距和位置用展示方向坐标 ──
  const marginX = Math.round(displayW * 0.03)
  const marginY = Math.round(displayH * 0.03)

  const [vPos, hPos] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  const x = hPos === 'left'
    ? marginX
    : hPos === 'right'
      ? displayW - actualWmWidth - marginX
      : Math.round((displayW - actualWmWidth) / 2)
  const y = vPos === 'bottom'
    ? displayH - actualWmHeight - marginY
    : marginY

  console.log('[watermark IMG]', {
    imgWidth: imgInfo.width, imgHeight: imgInfo.height,
    rotationDeg,
    sensorW, displayW, displayH,
    actualWmWidth, actualWmHeight, marginX, marginY,
    position, x, y,
  })

  const outputExt = path.extname(outputPath).toLowerCase()
  const encoder = ffmpegImgEncoder(outputExt)

  // 构建 filter：需要旋转时先 transpose，再叠加水印
  // autorotate 后清除 rotate metadata 防止二次旋转
  let filterComplex: string
  const rotateMode = rotationToTranspose(rotationDeg)

  if (rotateMode !== null) {
    filterComplex =
      `[0:v]transpose=${rotateMode}[rot];` +
      `[1:v]scale=${actualWmWidth}:-1[wm];` +
      `[rot][wm]overlay=${x}:${y}`
  } else {
    filterComplex =
      `[1:v]scale=${actualWmWidth}:-1[wm];` +
      `[0:v][wm]overlay=${x}:${y}`
  }

  const metadataArgs = ['-map_metadata', '0']

  // -noautorotate 阻止 ffmpeg 自动应用 EXIF 旋转（否则 transpose 会与自动旋转抵消）
  await execFileAsync(ffmpegPath, [
    '-noautorotate',
    '-i', inputPath,
    '-i', wmPath,
    '-filter_complex', filterComplex,
    ...encoder,
    ...metadataArgs,
    '-y',
    outputPath,
  ], { timeout: 30000 } as never)

  // ffmpeg 8.x 的 mjpeg 编码器不保留 EXIF，需手动从源文件复制
  // 随后将 orientation 改为 1（防止 viewer 对已转好的像素再次旋转）
  copyExifIfMissing(inputPath, outputPath)
  if (rotateMode !== null) {
    clearExifOrientation(outputPath)
  }
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
  watermarkPercent: number,
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
    console.log('[LIVE] applyWatermarkToLivePhoto called', { inputPath, outputPath, watermarkPercent, position, style })
    const extracted = await extractLivePhotoVideo(inputPath, extractedVideo)
    if (!extracted) throw new Error('无法提取 Live Photo 内嵌视频')

    // Live Photo 视频保持原始，不应用导出参数
    const videoProbe = await probeMedia(extractedVideo)
    const vidW = videoProbe.videoWidth
    const vidH = videoProbe.videoHeight
    console.log('[LIVE photo]', { videoProbe, source: inputPath })

    // 图片水印以原始视频分辨率为参考，保持视觉一致
    await applyWatermarkToImageWithRef(inputPath, watermarkedImage, watermarkPercent, position, style, vidW, vidH)

    // 视频仅加水印，保持原始分辨率/帧率/码率
    const pipeline = new FfmpegPipeline()
    pipeline.addModule(new WatermarkModule({ watermarkPercent, position, style }))
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
  watermarkPercent: number,
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
  pipeline.addModule(new WatermarkModule({ watermarkPercent, position, style }))
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
  const params = `wm_${settings.style}_${settings.watermarkPercent}_${settings.position}`
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
      await applyWatermarkToImage(sourcePath, destPath, settings.watermarkPercent, settings.position, settings.style)
    } else {
      await applyWatermarkToVideo(sourcePath, destPath, settings.watermarkPercent, settings.position, settings.style)
    }
    return { fileName: file.name, kind: file.kind, source: localThumbnailUrl(destPath), cachedPath: destPath }
  } catch (error) {
    console.error('[watermark] 预览水印生成失败:', error)
    return { fileName: file.name, kind: file.kind, source: null, cachedPath: null, message: '水印生成失败' }
  }
}
