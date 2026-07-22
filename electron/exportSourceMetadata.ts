import { execFile } from 'node:child_process'
import { rm, rename } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { readMediaDeviceInfo } from './exifReader'

const execFileAsync = promisify(execFile)

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
