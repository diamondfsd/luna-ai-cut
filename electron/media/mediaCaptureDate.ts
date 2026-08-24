import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { promisify } from 'node:util'
import exifr from 'exifr'

import type { MediaKind } from '../../src/shared/types'
import { getFfprobePath } from '../platform/ffmpeg/pipeline'

const execFileAsync = promisify(execFile)
const REMOTE_IMAGE_PREFIX_BYTES = 256 * 1024
const PROBE_TIMEOUT_MS = 10_000

function validDate(value: Date | null): Date | null {
  return value && !Number.isNaN(value.getTime()) ? value : null
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) return validDate(value)
  if (typeof value !== 'string' || !value.trim()) return null

  const text = value.trim()
  const isoDate = validDate(new Date(text))
  if (isoDate) return isoDate

  const exifMatch = text.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!exifMatch) return null
  const [, year, month, day, hour, minute, second] = exifMatch
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  return date.getFullYear() === Number(year)
    && date.getMonth() === Number(month) - 1
    && date.getDate() === Number(day)
    && date.getHours() === Number(hour)
    && date.getMinutes() === Number(minute)
    && date.getSeconds() === Number(second)
    ? date
    : null
}

async function readRemotePrefix(source: string): Promise<Buffer | null> {
  const response = await fetch(source, {
    headers: { Range: `bytes=0-${REMOTE_IMAGE_PREFIX_BYTES - 1}` },
  }).catch(() => null)
  if (!response?.ok || !response.body) return null

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (total < REMOTE_IMAGE_PREFIX_BYTES) {
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      const remaining = REMOTE_IMAGE_PREFIX_BYTES - total
      const accepted = chunk.subarray(0, remaining)
      chunks.push(accepted)
      total += accepted.length
      if (accepted.length < chunk.length) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks, total)
}

async function readImageSource(source: string): Promise<Buffer | null> {
  if (/^https?:\/\//i.test(source)) return readRemotePrefix(source)
  return fs.readFile(source).catch(() => null)
}

async function captureDateFromImage(source: string): Promise<Date | null> {
  const buffer = await readImageSource(source)
  if (!buffer) return null
  const parsed = await exifr.parse(buffer, {
    pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
  }).catch(() => null) as Record<string, unknown> | null
  for (const key of ['DateTimeOriginal', 'CreateDate', 'ModifyDate']) {
    const date = parseDateValue(parsed?.[key])
    if (date) return date
  }
  return null
}

async function captureDateFromVideo(source: string): Promise<Date | null> {
  const { stdout } = await execFileAsync(getFfprobePath(), [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_entries', 'format_tags=creation_time:stream_tags=creation_time',
    source,
  ], { encoding: 'utf-8', timeout: PROBE_TIMEOUT_MS })
  const data = JSON.parse(stdout) as {
    format?: { tags?: Record<string, unknown> }
    streams?: Array<{ tags?: Record<string, unknown> }>
  }
  const candidates = [
    ...(data.streams ?? []).map((stream) => stream.tags?.creation_time),
    data.format?.tags?.creation_time,
  ]
  return candidates.map(parseDateValue).find((date): date is Date => Boolean(date)) ?? null
}

export async function captureDateFromMediaSource(source: string, kind: MediaKind): Promise<Date | null> {
  try {
    if (kind === 'image') return await captureDateFromImage(source)
    if (kind === 'video') return await captureDateFromVideo(source)
  } catch {
    // File metadata is optional; callers retain the filename fallback.
  }
  return null
}
