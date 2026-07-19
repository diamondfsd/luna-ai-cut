import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import exifr from 'exifr'

import type { AiMediaQualityMetrics, AiSelectionItem, AiSelectionMode } from '../src/shared/types'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import { analyzeRgb } from './aiSelectionAlgorithms'
import { deriveBasicSemanticTags } from './aiSelectionTags'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.m2ts', '.insv', '.m4v'])
const SKIPPED_DIRECTORIES = new Set(['cache', 'cache_previews', '.luna-cache', 'workspace-projects'])

export interface IndexedMedia {
  id: string
  path: string
  name: string
  kind: 'image' | 'video'
  bytes: number
  mtimeMs: number
}

interface ProbeResult {
  width: number | null
  height: number | null
  duration: number | null
  capturedAt: string | null
  device: string | null
}

function mediaKind(filePath: string): IndexedMedia['kind'] | null {
  const extension = path.extname(filePath).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return null
}

async function indexFile(filePath: string): Promise<IndexedMedia | null> {
  const absolutePath = path.resolve(filePath)
  const kind = mediaKind(absolutePath)
  if (!kind) return null
  const stats = await fs.lstat(absolutePath)
  if (!stats.isFile() || stats.isSymbolicLink()) return null
  const handle = await fs.open(absolutePath, 'r')
  let quickFingerprint: string
  try {
    const chunkSize = Math.min(64 * 1024, stats.size)
    const first = Buffer.alloc(chunkSize)
    const last = Buffer.alloc(chunkSize)
    if (chunkSize > 0) {
      await handle.read(first, 0, chunkSize, 0)
      await handle.read(last, 0, chunkSize, Math.max(0, stats.size - chunkSize))
    }
    quickFingerprint = createHash('sha1').update(first).update(last).digest('hex').slice(0, 16)
  } finally {
    await handle.close()
  }
  const identity = `${absolutePath}\0${stats.size}\0${stats.mtimeMs}\0${quickFingerprint}`
  return {
    id: `media_${createHash('sha1').update(identity).digest('hex').slice(0, 20)}`,
    path: absolutePath,
    name: path.basename(absolutePath),
    kind,
    bytes: stats.size,
    mtimeMs: stats.mtimeMs,
  }
}

async function walk(directory: string, output: IndexedMedia[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const entries = await fs.readdir(directory, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    signal?.throwIfAborted()
    if (entry.name.startsWith('.')) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(entryPath, output, signal)
      continue
    }
    if (!entry.isFile()) continue
    const indexed = await indexFile(entryPath).catch(() => null)
    if (indexed) output.push(indexed)
  }
}

export async function indexMediaSource(
  source: { kind: 'directory' | 'files'; directory?: string; paths?: string[] },
  signal?: AbortSignal,
): Promise<IndexedMedia[]> {
  const output: IndexedMedia[] = []
  if (source.kind === 'directory') {
    if (!source.directory || !path.isAbsolute(source.directory)) throw new Error('素材目录无效')
    const stats = await fs.lstat(source.directory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('素材目录无效')
    await walk(path.resolve(source.directory), output, signal)
  } else {
    const unique = [...new Set(source.paths ?? [])]
    for (const filePath of unique) {
      signal?.throwIfAborted()
      if (!path.isAbsolute(filePath)) continue
      const indexed = await indexFile(filePath).catch(() => null)
      if (indexed) output.push(indexed)
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path))
}

function runBuffer(executable: string, args: string[], signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, signal }, (error, stdout) => {
      if (error) reject(error)
      else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
    })
  })
}

async function probe(media: IndexedMedia, signal?: AbortSignal): Promise<ProbeResult> {
  signal?.throwIfAborted()
  const stdout = await runBuffer(getFfprobePath(), [
    '-v', 'error',
    '-print_format', 'json',
    '-show_entries', 'stream=width,height:stream_tags=creation_time,com.apple.quicktime.make,com.apple.quicktime.model:format=duration:format_tags=creation_time,make,model',
    '-show_streams',
    '-show_format',
    media.path,
  ], signal)
  const parsed = JSON.parse(stdout.toString('utf8')) as {
    streams?: Array<{ width?: number; height?: number; tags?: Record<string, string> }>
    format?: { duration?: string; tags?: Record<string, string> }
  }
  const stream = parsed.streams?.find((candidate) => candidate.width && candidate.height) ?? parsed.streams?.[0]
  const tags = { ...(parsed.format?.tags ?? {}), ...(stream?.tags ?? {}) }
  const captured = tags.creation_time ? new Date(tags.creation_time) : null
  return {
    width: Number(stream?.width) || null,
    height: Number(stream?.height) || null,
    duration: Number.isFinite(Number(parsed.format?.duration)) ? Number(parsed.format?.duration) : null,
    capturedAt: captured && !Number.isNaN(captured.getTime()) ? captured.toISOString() : null,
    device: tags['com.apple.quicktime.model'] ?? tags.model ?? tags['com.apple.quicktime.make'] ?? tags.make ?? null,
  }
}

async function imageExif(media: IndexedMedia): Promise<Pick<ProbeResult, 'capturedAt' | 'device'>> {
  try {
    const data = await exifr.parse(media.path, { pick: ['DateTimeOriginal', 'CreateDate', 'Model', 'Make'] }) as Record<string, unknown> | null
    const value = data?.DateTimeOriginal ?? data?.CreateDate
    const captured = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
    const device = [data?.Make, data?.Model].filter((item) => typeof item === 'string' && item.trim()).join(' ').trim()
    return {
      capturedAt: captured && !Number.isNaN(captured.getTime()) ? captured.toISOString() : null,
      device: device || null,
    }
  } catch {
    return { capturedAt: null, device: null }
  }
}

async function decodeRgb(media: IndexedMedia, time: number | null, signal?: AbortSignal): Promise<Buffer> {
  const args = ['-v', 'error']
  if (time !== null && time > 0) args.push('-ss', time.toFixed(3))
  args.push('-i', media.path, '-frames:v', '1', '-vf', 'scale=64:64', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1')
  const rgb = await runBuffer(getFfmpegPath(), args, signal)
  if (rgb.byteLength !== 64 * 64 * 3) throw new Error('无法读取有效画面')
  return rgb
}

function averageQuality(qualities: AiMediaQualityMetrics[]): AiMediaQualityMetrics {
  const average = (key: keyof Omit<AiMediaQualityMetrics, 'grade' | 'reasons'>): number => (
    qualities.reduce((sum, quality) => sum + Number(quality[key]), 0) / Math.max(1, qualities.length)
  )
  const score = Math.round(average('score'))
  return {
    score,
    grade: score >= 88 ? 'excellent' : score >= 72 ? 'good' : score >= 50 ? 'fair' : 'review',
    reasons: [...new Set(qualities.flatMap((quality) => quality.reasons))].slice(0, 3),
    luminanceMean: Number(average('luminanceMean').toFixed(2)),
    darkRatio: Number(average('darkRatio').toFixed(4)),
    brightRatio: Number(average('brightRatio').toFixed(4)),
    contrast: Number(average('contrast').toFixed(2)),
    edgeScore: Number(average('edgeScore').toFixed(2)),
    entropy: Number(average('entropy').toFixed(3)),
  }
}

export function fullFileHash(filePath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    const abort = (): void => { stream.destroy(new DOMException('已取消', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    stream.on('data', (chunk) => { hash.update(chunk) })
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('close', () => signal?.removeEventListener('abort', abort))
  })
}

export async function analyzeIndexedMedia(
  media: IndexedMedia,
  _mode: AiSelectionMode,
  computeExactHash: boolean,
  signal?: AbortSignal,
): Promise<AiSelectionItem> {
  const metadata = await probe(media, signal).catch(() => ({ width: null, height: null, duration: null, capturedAt: null, device: null }))
  const exif = media.kind === 'image' ? await imageExif(media) : { capturedAt: null, device: null }
  const capturedAt = exif.capturedAt ?? metadata.capturedAt ?? new Date(media.mtimeMs).toISOString()
  // The first pass deliberately opens a video only once. Dense keyframes belong to
  // the background scene pass and must never block the photo selection result.
  const times = [media.kind === 'video' ? Math.max(0.1, Math.min(metadata.duration ? metadata.duration * 0.08 : 0.1, 2)) : null]
  const analyses = []
  for (const time of times) {
    signal?.throwIfAborted()
    analyses.push(analyzeRgb(await decodeRgb(media, time, signal), 64, 64))
  }
  const quality = averageQuality(analyses.map((analysis) => analysis.quality))
  const semanticTags = deriveBasicSemanticTags({
    kind: media.kind,
    capturedAt,
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
    quality,
    personEvidence: null,
    error: null,
  })
  return {
    ...media,
    analysisState: 'ready',
    capturedAt,
    device: exif.device ?? metadata.device,
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
    thumbnailUrl: media.kind === 'image' ? pathToFileURL(media.path).toString() : null,
    exactHash: computeExactHash ? await fullFileHash(media.path, signal) : null,
    perceptualHash: media.kind === 'image' ? analyses[0].perceptualHash : null,
    luminanceHistogram: media.kind === 'image' ? analyses[0].histogram : null,
    visualSignature: media.kind === 'image' ? analyses[0].visualSignature : null,
    quality,
    personEvidence: null,
    videoKeyframes: [],
    videoSegments: [],
    semanticTags,
    contentTags: [],
    contentTagVersion: null,
    contentTagError: null,
    eventId: null,
    similarityGroupId: null,
    recommendationScore: quality.score,
    recommendationReason: media.kind === 'video' ? '视频素材，等待片段分析' : null,
    selected: false,
    selectionSource: 'ai',
    error: null,
  }
}

export function failedItem(media: IndexedMedia, error: unknown): AiSelectionItem {
  return {
    ...media,
    analysisState: 'failed',
    capturedAt: new Date(media.mtimeMs).toISOString(),
    device: null,
    width: null,
    height: null,
    duration: null,
    thumbnailUrl: media.kind === 'image' ? pathToFileURL(media.path).toString() : null,
    exactHash: null,
    perceptualHash: null,
    luminanceHistogram: null,
    visualSignature: null,
    quality: null,
    personEvidence: null,
    videoKeyframes: [],
    videoSegments: [],
    semanticTags: [media.kind === 'image' ? '照片' : '视频', '读取失败'],
    contentTags: [],
    contentTagVersion: null,
    contentTagError: null,
    eventId: null,
    similarityGroupId: null,
    recommendationScore: 0,
    recommendationReason: '素材读取失败，需要人工确认',
    selected: false,
    selectionSource: 'ai',
    error: error instanceof Error ? error.message : String(error),
  }
}

export function pendingItem(media: IndexedMedia): AiSelectionItem {
  return {
    ...media,
    analysisState: 'pending',
    capturedAt: new Date(media.mtimeMs).toISOString(),
    device: null,
    width: null,
    height: null,
    duration: null,
    thumbnailUrl: media.kind === 'image' ? pathToFileURL(media.path).toString() : null,
    exactHash: null,
    perceptualHash: null,
    luminanceHistogram: null,
    visualSignature: null,
    quality: null,
    personEvidence: null,
    videoKeyframes: [],
    videoSegments: [],
    semanticTags: [media.kind === 'image' ? '照片' : '视频', '等待分析'],
    contentTags: [],
    contentTagVersion: null,
    contentTagError: null,
    eventId: null,
    similarityGroupId: null,
    recommendationScore: 0,
    recommendationReason: media.kind === 'video' ? '等待视频分析' : '等待照片分析',
    selected: false,
    selectionSource: 'ai',
    error: null,
  }
}
