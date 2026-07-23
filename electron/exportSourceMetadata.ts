import { execFile } from 'node:child_process'
import { readFile, rm, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { readMediaDeviceInfo } from './exifReader'

const execFileAsync = promisify(execFile)

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
  const exif = jpegExifSegment(source)
  if (!exif || output[0] !== 0xff || output[1] !== 0xd8) return false
  const insertAt = jpegMetadataInsertOffset(output)
  await writeFile(outputPath, Buffer.concat([output.subarray(0, insertAt), exif, output.subarray(insertAt)]))
  return true
}

export async function embedVideoSourceMetadata(
  ffmpegPath: string,
  outputPath: string,
  sourcePath?: string,
): Promise<boolean> {
  if (!sourcePath) return false
  const info = await readMediaDeviceInfo(sourcePath)
  if (!info?.make && !info?.model) return false

  const extension = path.extname(outputPath) || '.mp4'
  const stem = outputPath.slice(0, outputPath.length - path.extname(outputPath).length)
  const taggedPath = `${stem}.metadata-${process.pid}-${Date.now()}${extension}`
  const backupPath = `${outputPath}.metadata-backup-${process.pid}`
  const metadataArgs = [
    '-y', '-v', 'error', '-i', outputPath,
    '-map', '0', '-c', 'copy', '-movflags', 'use_metadata_tags',
    '-metadata', `make=${info.make}`,
    '-metadata', `model=${info.model}`,
    '-metadata', `source_device=${[info.make, info.model].filter(Boolean).join(' ')}`,
    '-metadata', 'exported_by=Luna AI Cut',
  ]
  if (info.firmware) metadataArgs.push('-metadata', `firmware=${info.firmware}`)
  metadataArgs.push(taggedPath)

  await execFileAsync(ffmpegPath, metadataArgs, { encoding: 'utf8' })
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
  return true
}
