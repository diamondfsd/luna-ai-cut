/**
 * Live Photo 处理服务
 *
 * Google Motion Photo（内嵌视频的 JPEG）的检测、提取、组合。
 */
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logMainInfo, logMainError } from './loggerService'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { getSwiftScriptPath } from './swiftUtils'

const execFileAsync = promisify(execFile)

// ═══════════════════════════════════════════════
//  Google Motion Photo XMP 工具
// ═══════════════════════════════════════════════

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

/** 找到 XMP APP1 在 JPEG 头部中的插入位置（SOI 之后、SOS 之前） */
function findXmpInsertPos(data: Buffer): number {
  let pos = 2
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

  const probeXml = buildGoogleXmpXml(0, 0)
  const probeSeg = buildXmpApp1Segment(probeXml)
  const insertAt = findXmpInsertPos(data)
  const withXmp = Buffer.concat([
    data.subarray(0, insertAt),
    probeSeg,
    data.subarray(insertAt),
  ])
  const finalJpegSize = withXmp.length

  const finalXml = buildGoogleXmpXml(finalJpegSize, videoLength)
  const finalSeg = buildXmpApp1Segment(finalXml)
  const result = Buffer.concat([
    data.subarray(0, insertAt),
    finalSeg,
    data.subarray(insertAt),
  ])
  writeFileSync(jpegPath, result)
}

// ═══════════════════════════════════════════════
//  Apple Live Photo 配对导出
// ═══════════════════════════════════════════════

/**
 * 通过 osascript 将 JPG+MOV 配对导入 macOS「照片」应用。
 */
async function importToPhotosApp(imagePath: string, videoPath: string): Promise<void> {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = [
    'tell application "Photos"',
    '  activate',
    `  import POSIX file "${esc(imagePath)}"`,
    `  import POSIX file "${esc(videoPath)}"`,
    'end tell',
  ].join('\n')
  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 120000 })
    logMainInfo('[LIVE Apple] 导入照片应用成功', { imagePath, videoPath })
  } catch (err) {
    logMainError('[LIVE Apple] 导入照片应用失败（非致命）', { error: err })
  }
}

/**
 * 创建 Apple 格式的 Live Photo 配对文件并导入到系统相册。
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
    const livetoolPath = getSwiftScriptPath('livetool.swift')
    const tempPrefix = path.join(folderPath, `_${baseName}_live`)
    await execFileAsync('swift', [livetoolPath, imgDest, vidDest, tempPrefix], { timeout: 30000 })
    await fs.rename(`${tempPrefix}.jpg`, imgDest)
    await fs.rename(`${tempPrefix}.mov`, vidDest)
  } catch (err) {
    logMainError('[LIVE Apple] livetool metadata injection failed (non-fatal)', { error: err })
  }

  await importToPhotosApp(imgDest, vidDest)
  onProgress?.(96)
}

// ═══════════════════════════════════════════════
//  Live Photo 检测
// ═══════════════════════════════════════════════

/**
 * 检测文件是否为 Google Motion Photo（内嵌视频的 JPEG）。
 * 通过扫描文件头的 XMP APP1 段查找 GCamera 命名空间。
 */
export async function isGoogleMotionPhoto(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.open(filePath, 'r')
    const buf = Buffer.alloc(32768)
    const { bytesRead } = await fd.read(buf, 0, 32768, 0)
    await fd.close()
    const head = buf.subarray(0, bytesRead)
    return head.includes('http://ns.google.com/photos/1.0/camera/')
  } catch {
    return false
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
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (appleExportFolder) {
    const baseName = path.basename(appleExportFolder)
    await exportAppleLivePhotoPair(processedImage, processedVideo, appleExportFolder, baseName, onProgress)
  }
  onProgress?.(50)

  try {
    injectGoogleXmpIntoJpeg(processedImage, processedVideo)
  } catch (err) {
    logMainError('[LIVE] Google XMP injection failed (non-fatal)', { error: err })
  }
  onProgress?.(60)

  const imgBytes = await fs.readFile(processedImage)
  const vidBytes = await fs.readFile(processedVideo)
  await fs.writeFile(outputPath, Buffer.concat([imgBytes, vidBytes]))
  logMainInfo('[LIVE] combineLivePhoto complete', { outputPath })
  onProgress?.(100)
}
