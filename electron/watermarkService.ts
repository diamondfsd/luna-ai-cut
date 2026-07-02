import { execFile } from 'node:child_process'
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import exifr from 'exifr'
import probe from 'probe-image-size'
import { logMainInfo, logMainError, logExport } from './loggerService'

const execFileAsync = promisify(execFile)

import { localThumbnailUrl, safeName } from './filePathUtils'
import { previewCacheDir } from './settingsService'
import { getFfmpegPath, probeMedia } from './ffmpeg/pipeline'
import { applyWatermarkToVideo, applyVideoExportSettings } from './videoPipelineService'
import { resolveWatermarkSettingsForFile } from './watermarkResolver'
import type {
  LunaFile,
  PreviewResult,
  VideoExportSettings,
  WatermarkPosition,
  WatermarkSettings,
} from '../src/shared/types'
import { deviceDefinitions } from './deviceDefaults'

function getWatermarkDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'watermark')
  return path.join(app.getAppPath(), 'src', 'assets', 'watermark')
}

/** 从设备配置构建 style → fileName 查找表 */
const WATERMARK_FILE_NAMES = new Map<string, string>()
for (const device of deviceDefinitions()) {
  for (const ws of device.watermarkStyles ?? []) {
    WATERMARK_FILE_NAMES.set(ws.value, ws.fileName)
  }
}

function watermarkFileFor(kind: 'image' | 'video', style: string): string {
  const fileName = WATERMARK_FILE_NAMES.get(style)
  if (!fileName) throw new Error(`未知水印样式: ${style}`)
  const suffix = kind === 'image' ? '_image' : ''
  return path.join(getWatermarkDir(), `${fileName}${suffix}.png`)
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

/**
 * 获取图片宽高（使用 probe-image-size）
 */
async function probeImage(inputPath: string): Promise<ImageInfo> {
  try {
    const result = await probe(createReadStream(inputPath) as unknown as NodeJS.ReadableStream)
    logMainInfo('[PROBE IMG]', { inputPath, width: result.width, height: result.height, type: result.type })
    return { width: result.width, height: result.height }
  } catch (err) {
    logMainError('[PROBE IMG] 失败，使用 fallback', {
      inputPath,
      error: err instanceof Error ? err.message : String(err),
    })
    return { width: 3840, height: 2160 }
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
  style: string,
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
  style: string,
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

  logExport('INFO', `[WATERMARK IMG] 图片水印参数`, { imgWidth: imgInfo.width, imgHeight: imgInfo.height, rotationDeg, sensorW, displayW, displayH, actualWmWidth, actualWmHeight, marginX, marginY, position, x, y })

  logExport('INFO', `[WATERMARK IMG] 水印引用信息`, {
    refWidth: refWidth ?? '无',
    refHeight: refHeight ?? '无',
    wmPath,
    wmImgWidth: wmInfo.width,
    wmImgHeight: wmInfo.height,
    wmAspect: wmAspect.toFixed(4),
    sensorW,
    watermarkPercent,
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

  logExport('INFO', `[WATERMARK IMG] 执行 ffmpeg`, {
    inputPath,
    outputPath,
    filterComplex,
    encoder: encoder.join(' '),
    ffmpegPath,
  })

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

  // 输出文件校验
  try {
    const outStat = await fs.stat(outputPath)
    const inStat = await fs.stat(inputPath)
    logExport('INFO', `[WATERMARK IMG] 输出文件信息`, {
      outputPath,
      outputSize: outStat.size,
      inputSize: inStat.size,
      sizeRatio: inStat.size > 0 ? (outStat.size / inStat.size * 100).toFixed(1) + '%' : 'N/A',
    })
  } catch { /* 忽略校验错误 */ }

  // ffmpeg 8.x 的 mjpeg 编码器不保留 EXIF，需手动从源文件复制
  // 随后将 orientation 改为 1（防止 viewer 对已转好的像素再次旋转）
  copyExifIfMissing(inputPath, outputPath)
  if (rotateMode !== null) {
    clearExifOrientation(outputPath)
  }
}

// ─── Google Motion Photo XMP ─────────────────

const XMP_NS = 'http://ns.adobe.com/xap/1.0/'

function buildGoogleXmpXml(primaryLength: number, videoLength: number): string {
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Luna AI Cut">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '    <rdf:Description rdf:about=""',
    '        xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"',
    '        xmlns:Container="http://ns.google.com/photos/1.0/container/"',
    '        xmlns:Item="http://ns.google.com/photos/1.0/container/item/">',
    '      <GCamera:MotionPhoto>1</GCamera:MotionPhoto>',
    '      <GCamera:MotionPhotoVersion>1</GCamera:MotionPhotoVersion>',
    '      <GCamera:MotionPhotoPresentationTimestampUs>0</GCamera:MotionPhotoPresentationTimestampUs>',
    '      <Container:Directory>',
    '        <rdf:Seq>',
    '          <rdf:li rdf:parseType="Resource">',
    `            <Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="${primaryLength}" Item:Padding="0"/>`,
    '          </rdf:li>',
    '          <rdf:li rdf:parseType="Resource">',
    `            <Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${videoLength}"/>`,
    '          </rdf:li>',
    '        </rdf:Seq>',
    '      </Container:Directory>',
    '    </rdf:Description>',
    '  </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n')
}

/** 构建 XMP APP1 段（FF E1 + 长度 + namespace + XML） */
function buildXmpApp1Segment(xml: string): Buffer {
  const xmpBytes = Buffer.from(xml, 'utf-8')
  const nsBytes = Buffer.from(XMP_NS, 'ascii')
  const payloadLen = nsBytes.length + 1 + xmpBytes.length
  const segLen = 2 + payloadLen
  const seg = Buffer.alloc(2 + segLen)
  seg[0] = 0xFF
  seg[1] = 0xE1
  seg.writeUInt16BE(segLen, 2)
  nsBytes.copy(seg, 4)
  seg[4 + nsBytes.length] = 0 // namespace 后的 null 终止符
  xmpBytes.copy(seg, 4 + nsBytes.length + 1)
  return seg
}

/** 找到 XMP APP1 在 JPEG 头部中的插入位置（SOI 之后、SOS 之前） */
function findXmpInsertPos(data: Buffer): number {
  let pos = 2 // 跳过 SOI
  while (pos < data.length - 1) {
    if (data[pos] !== 0xFF) break
    const marker = data[pos + 1]
    if (marker >= 0xD0 && marker <= 0xD7) { pos += 2; continue }
    if (marker === 0x00 || marker === 0xD8 || marker === 0xD9) { pos++; continue }
    if (marker === 0x01) { pos += 2; continue }
    if (pos + 4 > data.length) break
    const sLen = data.readUInt16BE(pos + 2)
    if (sLen < 2) break
    if (marker >= 0xE0 && marker <= 0xEF) {
      pos += 2 + sLen
      continue
    }
    break
  }
  return pos
}

/**
 * 向 JPEG 文件注入 Google Motion Photo XMP APP1 段。
 * 两遍构建法：先用假值算出最终 JPEG 大小，再用真实长度重建。
 */
function injectGoogleXmpIntoJpeg(jpegPath: string, videoPath: string): void {
  const data = readFileSync(jpegPath)
  const videoStat = statSync(videoPath)
  const videoLength = videoStat.size

  // 第一遍：用假值构建 XMP，算出最终 JPEG 大小
  const probeXml = buildGoogleXmpXml(0, 0)
  const probeSeg = buildXmpApp1Segment(probeXml)
  const insertAt = findXmpInsertPos(data)
  const withXmp = Buffer.concat([
    data.subarray(0, insertAt),
    probeSeg,
    data.subarray(insertAt),
  ])
  const finalJpegSize = withXmp.length

  // 第二遍：用真实长度重建 XMP 并写入
  const finalXml = buildGoogleXmpXml(finalJpegSize, videoLength)
  const finalSeg = buildXmpApp1Segment(finalXml)
  const result = Buffer.concat([
    data.subarray(0, insertAt),
    finalSeg,
    data.subarray(insertAt),
  ])

  writeFileSync(jpegPath, result)
}

// ─── Apple Live Photo 配对导出 ──────────────

/**
 * 在 MAC 上创建 Apple 格式的 Live Photo 配对文件。
 * - folder/ 目录
 *   - folder.jpg — 静态图片
 *   - folder.mov — 配套视频
 */
async function exportAppleLivePhotoPair(
  imagePath: string,
  videoPath: string,
  folderPath: string,
  baseName: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  await fs.mkdir(folderPath, { recursive: true })
  logMainInfo('[LIVE Apple] creating pair', { folderPath, baseName })

  // 1. 复制静态图片
  const imgDest = path.join(folderPath, `${baseName}.jpg`)
  await fs.copyFile(imagePath, imgDest)
  logMainInfo('[LIVE Apple] image copied', { dest: imgDest })

  // 2. 将视频 remux 为 MOV 容器
  const vidDest = path.join(folderPath, `${baseName}.mov`)
  const ffmpegPath = getFfmpegPath()
  try {
    await execFileAsync(ffmpegPath, [
      '-i', videoPath,
      '-c', 'copy',
      '-f', 'mov',
      '-movflags', 'faststart',
      '-y',
      vidDest,
    ], { timeout: 60000 })
  } catch (err) {
    // ffmpeg remux 失败时直接复制（多数播放器兼容）
    logMainError('[LIVE Apple] MOV remux failed, fallback to copy', { error: err })
    await fs.copyFile(videoPath, vidDest)
  }

  // 3. 用 livetool.swift 注入 Apple Live Photo 配对元数据（content identifier UUID）
  try {
    const livetoolPath = app.isPackaged
      ? path.join(process.resourcesPath, 'livetool.swift')
      : path.join(app.getAppPath(), 'electron', 'livetool.swift')
    const tempPrefix = path.join(folderPath, `_${baseName}_live`)
    await execFileAsync('swift', [livetoolPath, imgDest, vidDest, tempPrefix], { timeout: 30000 })
    // 将注入元数据后的临时文件重命名为最终文件名
    await fs.rename(`${tempPrefix}.jpg`, imgDest)
    await fs.rename(`${tempPrefix}.mov`, vidDest)
    logMainInfo('[LIVE Apple] livetool metadata injected')
  } catch (err) {
    logMainError('[LIVE Apple] livetool metadata injection failed (non-fatal), using unmodified pair', { error: err })
  }

  onProgress?.(96)
  logMainInfo('[LIVE Apple] pair complete', { imgDest, vidDest })
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
  style: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  _videoExportSettings?: VideoExportSettings,
  appleExportFolder?: string,
): Promise<void> {
  const tmpDir = path.dirname(outputPath)
  const extractedVideo = path.join(tmpDir, `_live_extracted.mp4`)
  const watermarkedImage = path.join(tmpDir, `_live_img.jpg`)
  const processedVideo = path.join(tmpDir, `_live_video.mp4`)

  try {
    logMainInfo('[LIVE] applyWatermarkToLivePhoto called', { inputPath, outputPath, watermarkPercent, position, style, appleExportFolder })

    const extracted = await extractLivePhotoVideo(inputPath, extractedVideo)
    if (!extracted) throw new Error('无法提取 Live Photo 内嵌视频')

    // Live Photo 视频保持原始，不应用导出参数
    const videoProbe = await probeMedia(extractedVideo)
    const vidW = videoProbe.videoWidth
    const vidH = videoProbe.videoHeight
    logMainInfo('[LIVE photo]', { videoProbe: { videoWidth: videoProbe.videoWidth, videoHeight: videoProbe.videoHeight, durationSeconds: videoProbe.durationSeconds }, source: inputPath })

    // 图片水印以原始视频分辨率为参考，保持视觉一致
    await applyWatermarkToImageWithRef(inputPath, watermarkedImage, watermarkPercent, position, style, vidW, vidH)
    onProgress?.(25)

    // 视频仅加水印 — 直接跑 ffmpeg 跳过完整 pipeline，强制 h264_videotoolbox 快 3-5x
    const wmVideoPath = watermarkFileFor('video', style)
    const wmSize = Math.round(vidW * watermarkPercent / 100)
    const marginX2 = Math.round(vidW * 0.03)
    const marginY2 = Math.round(vidH * 0.03)
    const [vPos2, hPos2] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
    const ox = hPos2 === 'left' ? String(marginX2)
      : hPos2 === 'right' ? `(W-w-${marginX2})`
      : '(W-w)/2'
    const oy = vPos2 === 'bottom' ? `(H-h-${marginY2})` : String(marginY2)
    const filterComplex = `[1:v]format=rgba,scale=${wmSize}:-1[wm];[0:v][wm]overlay=${ox}:${oy}:format=auto`
    onProgress?.(26)
    logMainInfo('[LIVE] video watermark direct ffmpeg', { vidW, vidH, wmSize, filterComplex, wmVideoPath })
    await execFileAsync(getFfmpegPath(), [
      '-hwaccel', 'videotoolbox',
      '-i', extractedVideo,
      '-i', wmVideoPath,
      '-filter_complex', filterComplex,
      '-c:v', 'h264_videotoolbox',
      '-allow_sw', '1',
      '-b:v', '15000k',
      '-maxrate', '30000k',
      '-bufsize', '30000k',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-map_metadata', '0',
      '-progress', 'pipe:2',
      '-nostats',
      '-y',
      processedVideo,
    ], { timeout: 60000, signal })

    // 检查处理后的文件
    const vidStat = await fs.stat(processedVideo).catch(() => null)
    const imgStat = await fs.stat(watermarkedImage).catch(() => null)
    const origStat = await fs.stat(extractedVideo).catch(() => null)
    logMainInfo('[LIVE] post-process sizes', {
      origVideo: origStat?.size,
      processedVideo: vidStat?.size,
      watermarkedImage: imgStat?.size,
    })

    // ── Apple Live Photo 配对导出（macOS 专用） ──
    if (appleExportFolder) {
      const baseName = path.basename(appleExportFolder)
      await exportAppleLivePhotoPair(watermarkedImage, processedVideo, appleExportFolder, baseName, onProgress)
    }

    // ── Google Motion Photo XMP 注入 ──
    try {
      injectGoogleXmpIntoJpeg(watermarkedImage, processedVideo)
      logMainInfo('[LIVE] Google XMP injected')
    } catch (err) {
      logMainError('[LIVE] Google XMP injection failed (non-fatal)', { error: err })
    }
    onProgress?.(97)

    // ── 拼接图片+视频 → 符合 Google 协议的 Live Photo ──
    const imgBytes = await fs.readFile(watermarkedImage)
    const vidBytes = await fs.readFile(processedVideo)
    await fs.writeFile(outputPath, Buffer.concat([imgBytes, vidBytes]))
    const outStat = await fs.stat(outputPath).catch(() => null)
    logMainInfo('[LIVE] output file', { size: outStat?.size })
    onProgress?.(100)
  } finally {
    await fs.rm(extractedVideo, { force: true }).catch(() => {})
    await fs.rm(watermarkedImage, { force: true }).catch(() => {})
    await fs.rm(processedVideo, { force: true }).catch(() => {})
  }
}

// 视频流水线函数定义在 videoPipelineService.ts 中
// 此处 re-export 保持向后兼容
export { applyWatermarkToVideo, applyVideoExportSettings }

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

  const resolvedSettings = await resolveWatermarkSettingsForFile({ ...file, localPath: sourcePath }, settings)
  const destPath = await watermarkCachePath(sourcePath, resolvedSettings)
  try {
    await fs.access(destPath)
    return { fileName: file.name, kind: file.kind, source: localThumbnailUrl(destPath), cachedPath: destPath }
  } catch {
    // Generate below.
  }

  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    if (file.kind === 'image') {
      await applyWatermarkToImage(sourcePath, destPath, resolvedSettings.watermarkPercent, resolvedSettings.position, resolvedSettings.style)
    } else {
      await applyWatermarkToVideo(sourcePath, destPath, resolvedSettings.watermarkPercent, resolvedSettings.position, resolvedSettings.style)
    }
    return { fileName: file.name, kind: file.kind, source: localThumbnailUrl(destPath), cachedPath: destPath }
  } catch (error) {
    logMainError('[watermark] 预览水印生成失败', error instanceof Error ? { message: error.message } : String(error))
    return { fileName: file.name, kind: file.kind, source: null, cachedPath: null, message: '水印生成失败' }
  }
}
