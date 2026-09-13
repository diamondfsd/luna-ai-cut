import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type {
  AiEditorLocalMediaInspectionMode,
  AiEditorLocalMediaInspectionOptions,
  AiEditorLocalMediaInspectionResult,
  AiEditorLocalMediaInspectionItem,
} from '../../../src/shared/types'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'
import { getAiEditorLocalMediaFiles } from './aiEditorLocalMediaService'

const execFileAsync = promisify(execFile)
const DEFAULT_MAX_WIDTH = 480
const MIN_MAX_WIDTH = 160
const MAX_MAX_WIDTH = 800
const OVERVIEW_LIMIT = 50
const DETAIL_LIMIT = 20
const ANALYSIS_CONCURRENCY = 3
const FRAME_MAX_BUFFER = 8 * 1024 * 1024

interface FfmpegResult {
  stdout: Buffer | string
}

function normalizeMode(value: unknown): AiEditorLocalMediaInspectionMode {
  return value === 'detail' ? 'detail' : 'overview'
}

function normalizeMaxWidth(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_WIDTH
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('预览宽度必须是整数')
  }
  return Math.min(MAX_MAX_WIDTH, Math.max(MIN_MAX_WIDTH, value))
}

function frameTimes(kind: 'image' | 'video', duration: number | undefined, mode: AiEditorLocalMediaInspectionMode): number[] {
  if (kind === 'image') return [0]
  const length = Number.isFinite(duration) && (duration ?? 0) > 0 ? duration as number : 1
  if (mode === 'overview') return [Math.max(0, length / 2)]
  return [length * 0.15, length * 0.5, length * 0.85]
}

async function renderFrame(
  filePath: string,
  kind: 'image' | 'video',
  timeSec: number,
  maxWidth: number,
): Promise<string> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    ...(kind === 'video' ? ['-ss', timeSec.toFixed(3)] : []),
    '-i',
    filePath,
    '-vf',
    `scale=${maxWidth}:-2:force_original_aspect_ratio=decrease`,
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-c:v',
    'mjpeg',
    '-q:v',
    '6',
    'pipe:1',
  ]
  const result = await execFileAsync(getFfmpegPath(), args, {
    encoding: 'buffer',
    maxBuffer: FRAME_MAX_BUFFER,
  }) as FfmpegResult
  const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
  if (bytes.length === 0) throw new Error('未生成预览帧')
  return bytes.toString('base64')
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

export async function inspectAiEditorLocalMedia(
  mediaIds: readonly string[],
  options: AiEditorLocalMediaInspectionOptions = {},
): Promise<AiEditorLocalMediaInspectionResult> {
  const mode = normalizeMode(options.mode)
  const limit = mode === 'detail' ? DETAIL_LIMIT : OVERVIEW_LIMIT
  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    throw new Error('请传入需要分析的 mediaIds')
  }
  if (mediaIds.length > limit) {
    throw new Error(`${mode === 'detail' ? '精细' : '概览'}分析一次最多处理 ${limit} 个素材`)
  }
  const uniqueMediaIds = [...new Set(mediaIds)]
  if (uniqueMediaIds.length !== mediaIds.length) {
    throw new Error('mediaIds 不能重复')
  }

  const maxWidth = normalizeMaxWidth(options.maxWidth)
  const files = await getAiEditorLocalMediaFiles(uniqueMediaIds)
  const items = await mapWithConcurrency(files, ANALYSIS_CONCURRENCY, async (file): Promise<AiEditorLocalMediaInspectionItem> => {
    const times = frameTimes(file.kind, file.duration, mode)
    try {
      const frames = await mapWithConcurrency(times, 2, async (timeSec) => ({
        timeSec: Number(timeSec.toFixed(3)),
        mimeType: 'image/jpeg' as const,
        base64: await renderFrame(file.filePath, file.kind, timeSec, maxWidth),
      }))
      return {
        mediaId: file.mediaId,
        name: file.name,
        kind: file.kind,
        ...(file.duration === undefined ? {} : { duration: file.duration }),
        capturedAt: file.capturedAt,
        frames,
      }
    } catch (error) {
      return {
        mediaId: file.mediaId,
        name: file.name,
        kind: file.kind,
        ...(file.duration === undefined ? {} : { duration: file.duration }),
        capturedAt: file.capturedAt,
        frames: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  return { mode, maxWidth, items }
}
