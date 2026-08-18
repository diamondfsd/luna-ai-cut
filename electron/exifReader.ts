import { open } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { getFfprobePath } from './ffmpeg/pipeline'

export interface MediaDeviceInfo {
  make: string
  model: string
  firmware?: string
  serialNumber?: string
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.insv', '.lrv'])
const execFileAsync = promisify(execFile)

async function readStandardVideoDeviceInfo(localPath: string): Promise<MediaDeviceInfo | null> {
  const { stdout } = await execFileAsync(getFfprobePath(), [
    '-v', 'error', '-print_format', 'json', '-show_format', localPath,
  ], { encoding: 'utf8' })
  const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } }
  const tags = parsed.format?.tags ?? {}
  const make = tags.make?.trim() ?? ''
  const model = tags.model?.trim() ?? ''
  if (!make && !model) return null
  return {
    make,
    model,
    firmware: tags.firmware?.trim() || undefined,
    serialNumber: (tags.serial_number ?? tags.serialnumber)?.trim() || undefined,
  }
}

async function readInsta360VideoDeviceInfo(localPath: string): Promise<MediaDeviceInfo | null> {
  const handle = await open(localPath, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(stat.size, 1024 * 1024)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, stat.size - length)
    const tail = buffer.toString('latin1')
    const searchable = tail.replace(/[^ -~]/g, ' ')
    const model = /Insta360\s+(Luna Ultra|GO Ultra)/i.exec(searchable)?.[1] ?? null
    if (!model) return null
    const firmware = /\bv\d+\.\d+(?:\.\d+)+\b/i.exec(searchable)?.[0]
    const serialNumber = /\bBTLB[A-Z0-9]{8,}\b/i.exec(searchable)?.[0]
    return { make: 'Insta360', model, firmware, serialNumber }
  } finally {
    await handle.close()
  }
}

export async function readMediaDeviceInfo(localPath?: string): Promise<MediaDeviceInfo | null> {
  if (!localPath) return null
  if (VIDEO_EXTENSIONS.has(path.extname(localPath).toLowerCase())) {
    try {
      const standardInfo = await readStandardVideoDeviceInfo(localPath)
      if (standardInfo) return standardInfo
    } catch { /* fall through to Insta360 private metadata */ }
    try {
      const videoInfo = await readInsta360VideoDeviceInfo(localPath)
      if (videoInfo) return videoInfo
    } catch { /* fall through to regular metadata */ }
  }
  try {
    const exifr = await import('exifr')
    const parsed = await exifr.parse(localPath, { translateValues: false, pick: ['Model', 'Make'] }) as Record<string, unknown> | undefined
    const model = typeof parsed?.Model === 'string' ? parsed.Model.trim() : ''
    const make = typeof parsed?.Make === 'string' ? parsed.Make.trim() : ''
    return model || make ? { make, model } : null
  } catch {
    return null
  }
}

export async function readExifModel(localPath?: string): Promise<string | null> {
  const info = await readMediaDeviceInfo(localPath)
  return info ? [info.make, info.model].filter(Boolean).join(' ') || null : null
}
