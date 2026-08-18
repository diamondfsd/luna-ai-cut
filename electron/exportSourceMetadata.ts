import { execFile } from 'node:child_process'
import { appendFile, readFile, rm, rename, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { readMediaDeviceInfo } from './exifReader'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import { lunaMediaAdapter } from './deviceMedia'
import { normalizeJpegExifSegment } from './jpegExifMetadata'
import { appendSourceStreamMetadata, extractOpaqueMp4Boxes, hasDolbyVisionConfiguration, hasTag, tagValue, type ProbeMedia } from './videoMetadataTransfer'

const execFileAsync = promisify(execFile)

async function probeMediaMetadata(filePath: string): Promise<ProbeMedia> {
  const { stdout } = await execFileAsync(getFfprobePath(), [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    '-show_chapters',
    filePath,
  ], { encoding: 'utf8' })
  return JSON.parse(stdout) as ProbeMedia
}

function validDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

async function sourceCaptureDate(sourcePath: string): Promise<Date | null> {
  const fileNameDate = lunaMediaAdapter.capturedAt(path.basename(sourcePath))
  if (fileNameDate) return fileNameDate

  try {
    if (/\.(?:jpe?g|png|webp|heic|heif|avif)$/i.test(sourcePath)) {
      const exifr = await import('exifr')
      const metadata = await exifr.parse(sourcePath, {
        pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
      }) as Record<string, unknown> | null
      const metadataDate = validDate(metadata?.DateTimeOriginal)
        ?? validDate(metadata?.CreateDate)
        ?? validDate(metadata?.ModifyDate)
      if (metadataDate) return metadataDate
    } else {
      const parsed = await probeMediaMetadata(sourcePath)
      const metadataDate = validDate(parsed.streams?.find((stream) => tagValue(stream.tags, 'creation_time'))
        ? tagValue(parsed.streams?.find((stream) => tagValue(stream.tags, 'creation_time'))?.tags, 'creation_time')
        : undefined)
        ?? validDate(tagValue(parsed.format?.tags, 'creation_time'))
      if (metadataDate) return metadataDate
    }
  } catch {
    // Source metadata is optional; fall back to the source file timestamp.
  }

  try {
    return (await stat(sourcePath)).mtime
  } catch {
    return null
  }
}

function jpegExifSegment(bytes: Buffer): Buffer | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > bytes.length) break
    if (marker === 0xe1 && bytes.subarray(offset + 4, offset + 10).toString('ascii') === 'Exif\0\0') {
      return bytes.subarray(offset, offset + 2 + length)
    }
    offset += 2 + length
  }
  return null
}

function pngExifPayload(bytes: Buffer): Buffer | null {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) return null
    if (bytes.subarray(offset + 4, offset + 8).toString('ascii') === 'eXIf') {
      return bytes.subarray(offset + 8, offset + 8 + length)
    }
    offset = end
  }
  return null
}

function webpExifPayload(bytes: Buffer): Buffer | null {
  if (bytes.length < 12 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset + 4)
    const end = offset + 8 + length + (length % 2)
    if (end > bytes.length) return null
    if (bytes.subarray(offset, offset + 4).toString('ascii') === 'EXIF') {
      return bytes.subarray(offset + 8, offset + 8 + length)
    }
    offset = end
  }
  return null
}

function sourceExifPayload(bytes: Buffer): Buffer | null {
  const jpeg = jpegExifSegment(bytes)
  if (jpeg && jpeg.subarray(4, 10).toString('ascii') === 'Exif\0\0') return jpeg.subarray(10)
  return pngExifPayload(bytes) ?? webpExifPayload(bytes)
}

function jpegExifSegmentFromPayload(payload: Buffer): Buffer | null {
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), payload])
  if (body.length + 2 > 0xffff) return null
  const segment = Buffer.alloc(body.length + 4)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(body.length + 2, 2)
  body.copy(segment, 4)
  return segment
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function insertPngExif(bytes: Buffer, payload: Buffer): Buffer | null {
  if (pngExifPayload(bytes)) return bytes
  const offset = 8
  if (offset + 12 > bytes.length || bytes.subarray(offset + 4, offset + 8).toString('ascii') !== 'IHDR') return null
  const ihdrLength = bytes.readUInt32BE(offset)
  const insertAt = offset + 12 + ihdrLength
  if (insertAt > bytes.length) return null
  const chunkBody = Buffer.concat([Buffer.from('eXIf', 'ascii'), payload])
  const chunk = Buffer.alloc(chunkBody.length + 8)
  chunk.writeUInt32BE(payload.length, 0)
  chunkBody.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(chunkBody), chunkBody.length + 4)
  return Buffer.concat([bytes.subarray(0, insertAt), chunk, bytes.subarray(insertAt)])
}

function insertWebpExif(bytes: Buffer, payload: Buffer): Buffer | null {
  if (webpExifPayload(bytes)) return bytes
  const chunk = Buffer.alloc(8 + payload.length + (payload.length % 2))
  chunk.write('EXIF', 0, 'ascii')
  chunk.writeUInt32LE(payload.length, 4)
  payload.copy(chunk, 8)
  const output = Buffer.concat([bytes, chunk])
  output.writeUInt32LE(output.length - 8, 4)
  return output
}

function jpegMetadataInsertOffset(bytes: Buffer): number {
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    if (marker !== 0xe0) break
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > bytes.length) break
    offset += 2 + length
  }
  return offset
}

export async function embedJpegSourceMetadata(outputPath: string, sourcePath?: string): Promise<boolean> {
  if (!sourcePath || !/\.jpe?g$/i.test(outputPath)) return false
  const [source, output] = await Promise.all([readFile(sourcePath), readFile(outputPath)])
  const sourcePayload = sourceExifPayload(source)
  if (!sourcePayload || output[0] !== 0xff || output[1] !== 0xd8) return false
  const sourceExif = jpegExifSegmentFromPayload(sourcePayload)
  if (!sourceExif) return false
  const exif = normalizeJpegExifSegment(sourceExif, output)
  const insertAt = jpegMetadataInsertOffset(output)
  await writeFile(outputPath, Buffer.concat([output.subarray(0, insertAt), exif, output.subarray(insertAt)]))
  return true
}

async function embedImageSourceMetadata(outputPath: string, sourcePath: string): Promise<boolean> {
  const [source, output] = await Promise.all([readFile(sourcePath), readFile(outputPath)])
  const payload = sourceExifPayload(source)
  if (!payload) return false
  if (/\.jpe?g$/i.test(outputPath)) return embedJpegSourceMetadata(outputPath, sourcePath)
  const tagged = /\.png$/i.test(outputPath)
    ? insertPngExif(output, payload)
    : /\.webp$/i.test(outputPath)
      ? insertWebpExif(output, payload)
      : null
  if (!tagged || tagged.equals(output)) return false
  await writeFile(outputPath, tagged)
  return true
}

export async function embedVideoSourceMetadata(
  ffmpegPath: string,
  outputPath: string,
  sourcePath?: string,
): Promise<boolean> {
  if (!sourcePath) return false
  const [sourceMedia, outputMedia] = await Promise.all([
    probeMediaMetadata(sourcePath).catch(() => null),
    probeMediaMetadata(outputPath).catch(() => null),
  ])
  const info = await readMediaDeviceInfo(sourcePath).catch(() => null)
  const captureDate = await sourceCaptureDate(sourcePath)
  const sourceHasMetadata = Boolean(
    (sourceMedia?.format?.tags && Object.keys(sourceMedia.format.tags).length > 0)
      || sourceMedia?.streams?.some((stream) => stream.tags && Object.keys(stream.tags).length > 0)
      || sourceMedia?.chapters?.length,
  )
  if (!sourceHasMetadata && !info?.make && !info?.model && !captureDate) return false

  const extension = path.extname(outputPath) || '.mp4'
  const stem = outputPath.slice(0, outputPath.length - path.extname(outputPath).length)
  const taggedPath = `${stem}.metadata-${process.pid}-${Date.now()}${extension}`
  const backupPath = `${outputPath}.metadata-backup-${process.pid}`
  const metadataArgs = [
    '-y', '-v', 'error', '-i', outputPath, '-i', sourcePath,
    '-map', '0', '-c', 'copy', '-map_metadata', '1', '-map_chapters', '1',
    '-movflags', 'use_metadata_tags',
  ]
  appendSourceStreamMetadata(metadataArgs, sourceMedia, outputMedia)
  const sourceHasCreationTime = sourceMedia ? hasTag(sourceMedia, 'creation_time') : false
  if (!sourceHasCreationTime && captureDate) metadataArgs.push('-metadata', `creation_time=${captureDate.toISOString()}`)
  if (!hasTag(sourceMedia ?? {}, 'make') && info?.make) metadataArgs.push('-metadata', `make=${info.make}`)
  if (!hasTag(sourceMedia ?? {}, 'model') && info?.model) metadataArgs.push('-metadata', `model=${info.model}`)
  if (!hasTag(sourceMedia ?? {}, 'firmware') && info?.firmware) metadataArgs.push('-metadata', `firmware=${info.firmware}`)
  if (!hasTag(sourceMedia ?? {}, 'serial_number') && info?.serialNumber) metadataArgs.push('-metadata', `serial_number=${info.serialNumber}`)
  metadataArgs.push(taggedPath)

  await execFileAsync(ffmpegPath, metadataArgs, { encoding: 'utf8' })
  const sourceOpaqueBoxes = extractOpaqueMp4Boxes(await readFile(sourcePath))
  if (sourceOpaqueBoxes) await appendFile(taggedPath, sourceOpaqueBoxes)
  if (hasDolbyVisionConfiguration(outputMedia)) {
    const taggedMedia = await probeMediaMetadata(taggedPath).catch(() => null)
    if (!hasDolbyVisionConfiguration(taggedMedia)) {
      throw new Error('写回元数据会破坏 Dolby Vision 配置，已保留原导出文件')
    }
  }
  await rm(backupPath, { force: true })
  await rename(outputPath, backupPath)
  try {
    await rename(taggedPath, outputPath)
    await rm(backupPath, { force: true })
  } catch (error) {
    await rename(backupPath, outputPath).catch(() => undefined)
    throw error
  } finally {
    await rm(taggedPath, { force: true }).catch(() => undefined)
  }
  if (captureDate) await utimes(outputPath, captureDate, captureDate)
  return true
}

export async function preserveExportSourceMetadata(
  outputPath: string,
  sourcePath?: string,
  options?: { rewriteImageMetadata?: boolean; rewriteVideoMetadata?: boolean },
): Promise<boolean> {
  if (!sourcePath) return false
  const captureDate = await sourceCaptureDate(sourcePath)
  let changed = false

  try {
    if (options?.rewriteImageMetadata !== false && /\.(?:jpe?g|png|webp)$/i.test(outputPath)) {
      changed = await embedImageSourceMetadata(outputPath, sourcePath)
    } else if (options?.rewriteVideoMetadata !== false && /\.(?:mp4|mov|m4v)$/i.test(outputPath)) {
      changed = await embedVideoSourceMetadata(getFfmpegPath(), outputPath, sourcePath)
    }
  } finally {
    if (captureDate) {
      await utimes(outputPath, captureDate, captureDate)
      changed = true
    }
  }
  return changed
}
