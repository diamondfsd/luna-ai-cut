import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import exifr from 'exifr'

import type { AiEditorLocalMediaMetadata } from '../../../src/shared/types'
import { getFfprobePath } from '../../platform/ffmpeg/pipeline'
import { getAiEditorLocalMedia } from './aiEditorLocalMediaService'

const execFileAsync = promisify(execFile)
const RAW_METADATA_MAX_BUFFER = 16 * 1024 * 1024
const PRIVATE_RAW_KEYS = new Set(['filename', 'filepath', 'sourcefile', 'path'])

interface RawProbeData {
  streams?: Array<Record<string, unknown>>
  format?: Record<string, unknown> | null
  chapters?: unknown[]
}

function mimeTypeFor(filePath: string, kind: AiEditorLocalMediaMetadata['kind']): string {
  const extension = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.wmv': 'video/x-ms-wmv',
    '.mts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.insv': 'video/mp4',
    '.lrv': 'video/mp4',
    '.lrf': 'video/mp4',
    '.xrf': 'video/mp4',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
  }
  return types[extension] ?? (kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'audio/*')
}

function sanitizeRawValue(value: unknown, key = '', depth = 0): unknown {
  if (PRIVATE_RAW_KEYS.has(key.toLowerCase())) return undefined
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (ArrayBuffer.isView(value)) return `[binary data: ${value.byteLength} bytes]`
  if (value instanceof ArrayBuffer) return `[binary data: ${value.byteLength} bytes]`
  if (depth > 12) return '[nested metadata omitted]'
  if (Array.isArray(value)) return value.map((item) => sanitizeRawValue(item, '', depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeRawValue(entryValue, entryKey, depth + 1)] as const)
        .filter(([, entryValue]) => entryValue !== undefined),
    )
  }
  return String(value)
}

async function probeRawMedia(filePath: string): Promise<RawProbeData> {
  const result = await execFileAsync(getFfprobePath(), [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    '-show_chapters',
    filePath,
  ], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: RAW_METADATA_MAX_BUFFER,
  })
  const parsed = JSON.parse(String(result.stdout)) as RawProbeData
  return {
    streams: Array.isArray(parsed.streams) ? parsed.streams : [],
    format: parsed.format && typeof parsed.format === 'object' ? parsed.format : null,
    chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
  }
}

async function readRawExif(filePath: string): Promise<unknown> {
  return exifr.parse(filePath, {
    tiff: true,
    ifd1: true,
    exif: true,
    gps: true,
    interop: true,
    xmp: true,
    icc: true,
    jfif: true,
    ihdr: true,
    mergeOutput: false,
  })
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function firstString(record: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function firstNumber(record: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = finiteNumber(record?.[key])
    if (value !== null) return value
  }
  return null
}

function parseFrameRate(value: string | null): number | null {
  if (!value) return null
  const [numerator, denominator] = value.split('/').map(Number)
  const frameRate = denominator > 0 ? numerator / denominator : numerator
  return Number.isFinite(frameRate) && frameRate > 0 && frameRate <= 1000
    ? Math.round(frameRate * 100) / 100
    : null
}

function firstVideoStream(streams: readonly Record<string, unknown>[]): Record<string, unknown> | undefined {
  return streams.find((stream) => stream.codec_type === 'video')
}

function firstAudioStreams(streams: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return streams.filter((stream) => stream.codec_type === 'audio')
}

function findNestedNumber(value: unknown, keys: Set<string>, depth = 0): number | null {
  if (depth > 8 || !value || typeof value !== 'object') return null
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key.toLowerCase())) {
      const number = finiteNumber(item)
      if (number !== null && number > 0) return number
    }
    const nested = findNestedNumber(item, keys, depth + 1)
    if (nested !== null) return nested
  }
  return null
}

function metadataItem(
  media: Awaited<ReturnType<typeof getAiEditorLocalMedia>>,
  probe: RawProbeData | null,
  exif: unknown | null,
  error?: string,
): AiEditorLocalMediaMetadata {
  const streams = probe?.streams ?? []
  const videoStream = firstVideoStream(streams)
  const audioStreams = firstAudioStreams(streams)
  const format = probe?.format ?? null
  const width = firstNumber(videoStream, ['width'])
    ?? findNestedNumber(exif, new Set(['imagewidth', 'pixelxdimension', 'width']))
  const height = firstNumber(videoStream, ['height'])
    ?? findNestedNumber(exif, new Set(['imageheight', 'pixelydimension', 'height']))
  const frameRate = parseFrameRate(firstString(videoStream, ['avg_frame_rate']))
    ?? parseFrameRate(firstString(videoStream, ['r_frame_rate']))
  const durationSec = firstNumber(format, ['duration']) ?? firstNumber(videoStream, ['duration'])
  const frameCount = firstNumber(videoStream, ['nb_frames', 'nb_read_frames'])

  return {
    mediaId: media.mediaId,
    name: media.name,
    kind: media.kind,
    bytes: media.bytes,
    capturedAt: media.capturedAt,
    modifiedAt: media.modifiedAt,
    groupDay: media.groupDay,
    ...(media.sourceDeviceName ? { sourceDeviceName: media.sourceDeviceName } : {}),
    ...(media.sourceDeviceId ? { sourceDeviceId: media.sourceDeviceId } : {}),
    extension: path.extname(media.filePath).toLowerCase(),
    mimeType: mimeTypeFor(media.filePath, media.kind),
    width,
    height,
    durationSec,
    frameRate,
    frameCount,
    videoCodec: firstString(videoStream, ['codec_name']),
    audioCodecs: audioStreams.flatMap((stream) => {
      const codec = firstString(stream, ['codec_name'])
      return codec ? [codec] : []
    }),
    formatName: firstString(format, ['format_name']),
    raw: {
      ffprobe: probe
        ? {
            streams: sanitizeRawValue(streams) as unknown[],
            format: sanitizeRawValue(format) as Record<string, unknown> | null,
            chapters: sanitizeRawValue(probe.chapters ?? []) as unknown[],
          }
        : null,
      exif: sanitizeRawValue(exif),
    },
    ...(error ? { error } : {}),
  }
}

async function readMetadata(mediaId: string): Promise<AiEditorLocalMediaMetadata> {
  const media = await getAiEditorLocalMedia(mediaId)
  const errors: string[] = []
  let probe: RawProbeData | null = null
  let exif: unknown | null = null

  try {
    probe = await probeRawMedia(media.filePath)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  if (media.kind === 'image') {
    try {
      exif = await readRawExif(media.filePath)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  let bytes = media.bytes
  try {
    bytes = (await fs.stat(media.filePath)).size
  } catch {
    // list_local_media already verified the file; keep its size if it changed meanwhile.
  }
  const result = metadataItem({ ...media, bytes }, probe, exif, errors.length > 0 ? errors.join('; ') : undefined)
  return result
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

export async function getAiEditorLocalMediaMetadata(mediaIds: readonly string[]): Promise<AiEditorLocalMediaMetadata[]> {
  if (!Array.isArray(mediaIds) || mediaIds.length === 0) throw new Error('请传入需要读取信息的 mediaIds')
  if (mediaIds.length > 50) throw new Error('一次最多读取 50 个素材的信息')
  const uniqueMediaIds = [...new Set(mediaIds)]
  if (uniqueMediaIds.length !== mediaIds.length) throw new Error('mediaIds 不能重复')
  return mapWithConcurrency(uniqueMediaIds, 3, readMetadata)
}
