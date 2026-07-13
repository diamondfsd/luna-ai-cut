import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { previewCacheDir } from './settingsService'

const CACHE_VERSION = 2
const MAX_CACHE_BYTES = 20 * 1024 * 1024

async function cachePathFor(videoPath: string, duration: number): Promise<string> {
  const stat = await fs.stat(videoPath)
  const identity = JSON.stringify({
    version: CACHE_VERSION,
    videoPath: path.resolve(videoPath),
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    durationMs: Math.round(duration * 1000),
  })
  const key = createHash('sha256').update(identity).digest('hex')
  return path.join(await previewCacheDir(), 'trim-thumbnails', `${key}.jpg`)
}

export async function loadTrimThumbnailCache(videoPath: string, duration: number): Promise<ArrayBuffer | null> {
  try {
    const buffer = await fs.readFile(await cachePathFor(videoPath, duration))
    const result = new ArrayBuffer(buffer.byteLength)
    new Uint8Array(result).set(buffer)
    return result
  } catch {
    return null
  }
}

export async function saveTrimThumbnailCache(videoPath: string, duration: number, bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CACHE_BYTES) return
  const cachePath = await cachePathFor(videoPath, duration)
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  const tempPath = `${cachePath}.${process.pid}.tmp`
  await fs.writeFile(tempPath, new Uint8Array(bytes))
  await fs.rename(tempPath, cachePath).catch(async () => {
    await fs.rm(tempPath, { force: true })
  })
}
