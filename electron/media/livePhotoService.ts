/**
 * Live Photo 处理服务
 *
 * Google Motion Photo（内嵌视频的 JPEG）的检测、提取、组合。
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { logMainInfo, logMainError } from '../infrastructure/loggerService'
import { getFfmpegPath } from '../platform/ffmpeg/pipeline'
import { getMacosHelperPath } from '../platform/macos/swiftUtils'

const execFileAsync = promisify(execFile)
const MOTION_PHOTO_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'qt  ', 'MSNV'])

// ═══════════════════════════════════════════════
//  Google Motion Photo XMP 工具
// ═══════════════════════════════════════════════

const XMP_NS = 'http://ns.adobe.com/xap/1.0/'

function buildGoogleXmpXml(videoLength: number, presentationTimestampUs: number): string {
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
    `      <GCamera:MotionPhotoPresentationTimestampUs>${Math.max(0, Math.round(presentationTimestampUs))}</GCamera:MotionPhotoPresentationTimestampUs>`,
    '      <Container:Directory>',
    '        <rdf:Seq>',
    '          <rdf:li rdf:parseType="Resource">',
    '            <Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/>',
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
  seg[4 + nsBytes.length] = 0
  xmpBytes.copy(seg, 4 + nsBytes.length + 1)
  return seg
}

/** 标准 JFIF APP0 标记（16 字节，1:1 像素比，版本 1.1） */
const JFIF_APP0 = Buffer.from([
  0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
])

/** 找到 XMP APP1 在 JPEG 头部中的插入位置（SOI 之后、DQT/SOS 之前） */
function findXmpInsertPos(data: Buffer): number {
  let pos = 2
  while (pos < data.length - 1) {
    if (data[pos] !== 0xFF) break
    const marker = data[pos + 1]
    // RST 标记
    if (marker >= 0xD0 && marker <= 0xD7) { pos += 2; continue }
    // 字节填充或 SOI/EOI
    if (marker === 0x00 || marker === 0xD8 || marker === 0xD9) { pos++; continue }
    // TEM 标记
    if (marker === 0x01) { pos += 2; continue }
    if (pos + 4 > data.length) break
    const sLen = data.readUInt16BE(pos + 2)
    if (sLen < 2) break
    // APP 标记 (0xE0-0xEF) 或 COM 注释 (0xFE, ffmpeg 写 Lavc 版本)
    if (marker >= 0xE0 && marker <= 0xEF || marker === 0xFE) {
      pos += 2 + sLen
      continue
    }
    break
  }
  return pos
}

/**
 * 向 JPEG 文件注入 JFIF APP0（如缺失）、Google Motion Photo XMP APP1。
 * Primary 的 Item:Length="0" 遵循 Google 規範（表示延伸到下一個 Item）。
 */
function injectGoogleXmpIntoJpeg(jpegPath: string, videoPath: string, coverTimeSeconds = 0): void {
  let data = readFileSync(jpegPath)
  const videoStat = statSync(videoPath)
  const videoLength = videoStat.size

  // Step 1: 确保 JFIF APP0 存在（macOS Preview 需要）
  if (data[2] !== 0xFF || data[3] !== 0xE0 || !data.subarray(4, 10).equals(Buffer.from('JFIF\0'))) {
    data = Buffer.concat([data.subarray(0, 2), JFIF_APP0, data.subarray(2)])
  }

  // Step 2: 找出插入位置并注入 XMP APP1（跳过 JFIF/COM，放在 DQT/DHT 之前）
  const xml = buildGoogleXmpXml(videoLength, coverTimeSeconds * 1_000_000)
  const app1Seg = buildXmpApp1Segment(xml)
  const insertAt = findXmpInsertPos(data)
  const result = Buffer.concat([
    data.subarray(0, insertAt),
    app1Seg,
    data.subarray(insertAt),
  ])
  writeFileSync(jpegPath, result)
}

/**
 * 创建 Apple 格式的 Live Photo 配对文件并导入到系统相册。
 */
async function importToPhotosApp(imagePath: string, videoPath: string): Promise<void> {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = [
    'tell application "Photos"',
    `  import POSIX file "${esc(imagePath)}"`,
    `  import POSIX file "${esc(videoPath)}"`,
    'end tell',
  ].join('\n')
  logMainInfo('[LIVE Apple] importToPhotosApp start', { imagePath, videoPath, scriptPreview: script.slice(0, 200) })
  try {
    const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], { timeout: 120000 })
    logMainInfo('[LIVE Apple] importToPhotosApp success', { stdout, stderr })
  } catch (err) {
    // 非致命：用户可能拒绝了自动化权限，不影响主文件导出
    logMainError('[LIVE Apple] importToPhotosApp failed（非致命）', { error: err instanceof Error ? { message: err.message, stack: err.stack?.slice(0, 500) } : String(err) })
  }
}

async function exportAppleLivePhotoPair(
  imagePath: string,
  videoPath: string,
  folderPath: string,
  baseName: string,
  coverTimeSeconds?: number,
  onProgress?: (percent: number) => void,
): Promise<void> {
  await fs.mkdir(folderPath, { recursive: true })
  logMainInfo('[LIVE Apple] creating pair', { folderPath, baseName })

  const imgDest = path.join(folderPath, `${baseName}.jpg`)
  await fs.copyFile(imagePath, imgDest)

  const vidDest = path.join(folderPath, `${baseName}.mov`)
  const ffmpegPath = getFfmpegPath()
  try {
    await execFileAsync(ffmpegPath, [
      '-i', videoPath,
      '-c', 'copy',
      '-f', 'mov',
      '-movflags', 'faststart',
      '-y', vidDest,
    ], { timeout: 60000 })
  } catch {
    await fs.copyFile(videoPath, vidDest)
  }

  try {
    const livetoolPath = getMacosHelperPath('livetool')
    const tempPrefix = path.join(folderPath, `_${baseName}_live`)
    const args = [imgDest, vidDest, tempPrefix]
    if (coverTimeSeconds !== undefined) args.push(String(coverTimeSeconds))
    await execFileAsync(livetoolPath, args, { timeout: 30000 })
    await fs.rename(`${tempPrefix}.jpg`, imgDest)
    await fs.rename(`${tempPrefix}.mov`, vidDest)
  } catch (err) {
    logMainError('[LIVE Apple] livetool metadata injection failed (non-fatal)', { error: err })
  }

  // 导入到系统相册
  await importToPhotosApp(imgDest, vidDest)

  onProgress?.(96)
  logMainInfo('[LIVE Apple] pair complete, imported to Photos', { imgDest, vidDest })
}

// ═══════════════════════════════════════════════
//  Live Photo 检测
// ═══════════════════════════════════════════════

/**
 * 检测文件是否为 Google Motion Photo（内嵌视频的 JPEG）。
 *
 * 检测策略（两阶段）：
 * 1. 快速路径：扫描文件头 64KB 中的 XMP APP1 段查找 GCamera 命名空间
 * 2. 回退路径：逐块扫描文件查找 MP4 ftyp 盒子（兼容 XMP 注入失败的情况）
 *
 * 回退路径最多扫描前 5MB，超过即放弃（避免大文件性能问题）。
 */
export async function isGoogleMotionPhoto(filePath: string): Promise<boolean> {
  // ── 后缀名检查：只有 .jpg/.jpeg 才可能是 Google Motion Photo ──
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.jpg' && ext !== '.jpeg') return false
  let fd: fs.FileHandle | null = null
  try {
    // 兼容 file:// URL 路径（渲染进程可能直接传未归一化的路径）
    let resolvedPath = filePath
    if (filePath.startsWith('file://')) {
      resolvedPath = fileURLToPath(filePath)
    }
    // Windows: 兼容 /C:/Users/... 格式（new URL().pathname 会多一个前导 /）
    if (/^\/[a-zA-Z]:[/\\]/.test(resolvedPath)) {
      resolvedPath = resolvedPath.slice(1)
    }

    fd = await fs.open(resolvedPath, 'r')

    // ── Phase 1: XMP 快速扫描 ──
    const headBuf = Buffer.alloc(65536) // 64KB
    const { bytesRead: headBytes } = await fd.read(headBuf, 0, 65536, 0)
    const head = headBuf.subarray(0, headBytes)
    if (head.includes('http://ns.google.com/photos/1.0/camera/')) return true

    // ── Phase 2: 逐块扫描 ftyp MP4 盒子 ──
    // Google Motion Photo 在 JPEG EOI 后追加 MP4 数据，
    // 以 ftyp 盒子起始。即使 XMP 注入失败，MP4 数据仍在。
    const stat = await fd.stat()
    const CHUNK_SIZE = 262144       // 256KB/块
    const MAX_SCAN = 5 * 1024 * 1024 // 最大扫描 5MB

    const scanSize = Math.min(stat.size, MAX_SCAN)
    for (let offset = 0; offset < scanSize; offset += CHUNK_SIZE) {
      const readOffset = Math.max(0, offset - 12)
      const readLength = Math.min(CHUNK_SIZE + 12, scanSize - readOffset)
      const chunk = Buffer.alloc(readLength)
      const { bytesRead: got } = await fd.read(chunk, 0, readLength, readOffset)
      if (got < 16) break

      // Google Motion Photo 的 MP4 紧跟在完整 JPEG EOI 后，并具有合法的 ftyp 盒子。
      for (let i = 2; i <= got - 12; i++) {
        if (
          chunk[i + 4] === 0x66 && // f
          chunk[i + 5] === 0x74 && // t
          chunk[i + 6] === 0x79 && // y
          chunk[i + 7] === 0x70    // p
        ) {
          const boxSize = chunk.readUInt32BE(i)
          const boxStart = readOffset + i
          const brand = chunk.subarray(i + 8, i + 12).toString('ascii')
          const followsJpegEnd = chunk[i - 2] === 0xFF && chunk[i - 1] === 0xD9
          if (
            followsJpegEnd
            && boxSize >= 16
            && boxSize <= stat.size - boxStart
            && MOTION_PHOTO_BRANDS.has(brand)
          ) return true
        }
      }
      if (got < CHUNK_SIZE) break
    }

    return false
  } catch {
    return false
  } finally {
    await fd?.close().catch(() => {})
  }
}

// ═══════════════════════════════════════════════
//  提取
// ═══════════════════════════════════════════════

/**
 * 从 Live Photo 文件中提取纯 JPEG 图片部分（去除尾部的视频数据）。
 */
export async function extractImageFromLivePhoto(livPath: string, destPath: string): Promise<void> {
  const data = await fs.readFile(livPath)
  const marker = Buffer.from('ftyp', 'ascii')
  const ftypOffset = data.indexOf(marker)
  const mp4Offset = ftypOffset - 4
  if (ftypOffset < 4 || mp4Offset <= 0) throw new Error('无法定位视频数据起始位置')
  const imgData = data.subarray(0, mp4Offset)
  if (imgData[imgData.length - 2] !== 0xFF || imgData[imgData.length - 1] !== 0xD9) {
    throw new Error('图片数据不完整')
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await fs.writeFile(destPath, imgData)
}

export async function extractLivePhotoVideo(livPath: string, destination: string): Promise<string | null> {
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

// ═══════════════════════════════════════════════
//  组合
// ═══════════════════════════════════════════════

/**
 * 将已处理好的图片和视频组合成 Live Photo 输出。
 * 不处理图片/视频本身，只负责：
 *   - Apple Live Photo 配对 + 导入相册（如开启）
 *   - Google Motion Photo XMP 注入
 *   - 拼接为 .liv 文件
 */
export async function combineLivePhoto(
  processedImage: string,
  processedVideo: string,
  outputPath: string,
  appleExportFolder?: string,
  coverTimeSeconds?: number,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (appleExportFolder) {
    const baseName = path.basename(appleExportFolder)
    await exportAppleLivePhotoPair(processedImage, processedVideo, appleExportFolder, baseName, coverTimeSeconds, onProgress)
    // Apple Live Photo 不需要合成 Google Motion Photo 格式的 .jpg
    onProgress?.(100)
    return
  }
  onProgress?.(50)

  // 修正 JPEG 色度子采样（ffmpeg mjpeg RGBA 输入可能输出非标准采样，macOS 无法识别）
  const ffmpegPath = getFfmpegPath()
  const fixedImage = processedImage + '.fixed.jpg'
  try {
    await execFileAsync(ffmpegPath, [
      '-y', '-i', processedImage,
      '-c:v', 'mjpeg',
      '-pix_fmt', 'yuvj420p',
      '-q:v', '2',
      fixedImage,
    ], { timeout: 30000 })
    // 替换原文件
    await fs.rename(fixedImage, processedImage)
  } catch (err) {
    logMainError('[LIVE] JPEG re-encode failed (non-fatal)', { error: err })
    await fs.unlink(fixedImage).catch(() => {})
  }

  try {
    injectGoogleXmpIntoJpeg(processedImage, processedVideo, coverTimeSeconds ?? 0)
  } catch (err) {
    logMainError('[LIVE] Google XMP injection failed（非致命：输出文件仍为 JPEG+MP4 拼接，但缺少 XMP 元数据，部分 Live 检测可能失效）', { error: err })
  }
  onProgress?.(60)

  const imgBytes = await fs.readFile(processedImage)
  const vidBytes = await fs.readFile(processedVideo)
  await fs.writeFile(outputPath, Buffer.concat([imgBytes, vidBytes]))
  logMainInfo('[LIVE] combineLivePhoto complete', { outputPath })
  onProgress?.(100)
}
