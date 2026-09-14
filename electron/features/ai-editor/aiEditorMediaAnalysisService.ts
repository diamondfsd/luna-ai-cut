import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  AiEditorLocalMediaContactSheetCell,
  AiEditorLocalMediaContactSheetOptions,
  AiEditorLocalMediaContactSheetResult,
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
const CONTACT_SHEET_DEFAULT_MAX_WIDTH = 320
const CONTACT_SHEET_MIN_MAX_WIDTH = 160
const CONTACT_SHEET_MAX_MAX_WIDTH = 480
const CONTACT_SHEET_DEFAULT_COLUMNS = 4
const CONTACT_SHEET_MAX_COLUMNS = 6
const CONTACT_SHEET_GAP = 6

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

function normalizeContactSheetMaxWidth(value: number | undefined): number {
  if (value === undefined) return CONTACT_SHEET_DEFAULT_MAX_WIDTH
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('联络表宽度必须是整数')
  }
  const bounded = Math.min(CONTACT_SHEET_MAX_MAX_WIDTH, Math.max(CONTACT_SHEET_MIN_MAX_WIDTH, value))
  // JPEG/YUV420 frames require even dimensions. Keeping the public size even
  // also prevents FFmpeg pad from rounding an odd target down unexpectedly.
  return bounded % 2 === 0 ? bounded : bounded - 1
}

function normalizeContactSheetColumns(value: number | undefined): number {
  if (value === undefined) return CONTACT_SHEET_DEFAULT_COLUMNS
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('联络表列数必须是整数')
  }
  return Math.min(CONTACT_SHEET_MAX_COLUMNS, Math.max(1, value))
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
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
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

async function renderContactSheet(
  frames: readonly { base64: string }[],
  cellWidth: number,
  cellHeight: number,
  columns: number,
): Promise<{ base64: string; width: number; height: number }> {
  const rows = Math.ceil(frames.length / columns)
  const width = columns * cellWidth + (columns + 1) * CONTACT_SHEET_GAP
  const height = rows * cellHeight + (rows + 1) * CONTACT_SHEET_GAP
  const directory = await mkdtemp(path.join(tmpdir(), 'luna-contact-sheet-'))
  try {
    await Promise.all(frames.map((frame, index) => writeFile(
      path.join(directory, `frame-${String(index).padStart(4, '0')}.jpg`),
      Buffer.from(frame.base64, 'base64'),
    )))
    const filter = [
      `scale=w=${cellWidth}:h=${cellHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      `pad=${cellWidth}:${cellHeight}:(ow-iw)/2:(oh-ih)/2:color=0x111111`,
      `tile=${columns}x${rows}:padding=${CONTACT_SHEET_GAP}:margin=${CONTACT_SHEET_GAP}:color=0x111111`,
    ].join(',')
    const result = await execFileAsync(getFfmpegPath(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-framerate',
      '1',
      '-i',
      path.join(directory, 'frame-%04d.jpg'),
      '-vf',
      filter,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      '-q:v',
      '5',
      'pipe:1',
    ], {
      encoding: 'buffer',
      maxBuffer: FRAME_MAX_BUFFER,
    }) as FfmpegResult
    const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
    if (bytes.length === 0) throw new Error('未生成联络表')
    return { base64: bytes.toString('base64'), width, height }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function createAiEditorLocalMediaContactSheet(
  mediaIds: readonly string[],
  options: AiEditorLocalMediaContactSheetOptions = {},
): Promise<AiEditorLocalMediaContactSheetResult> {
  const mode = normalizeMode(options.mode)
  const maxWidth = normalizeContactSheetMaxWidth(options.maxWidth)
  const columns = normalizeContactSheetColumns(options.columns)
  const inspection = await inspectAiEditorLocalMedia(mediaIds, { mode, maxWidth })
  const inspectedFrames = inspection.items.flatMap((item) => item.frames.map((frame, frameIndex) => ({
    mediaId: item.mediaId,
    frameIndex,
    frameId: `${item.mediaId}#${frameIndex}`,
    timeSec: frame.timeSec,
    base64: frame.base64,
  })))
  if (inspectedFrames.length === 0) throw new Error('没有可用于生成联络表的预览帧')

  const cellHeight = Math.max(90, Math.floor((maxWidth * 9 / 16) / 2) * 2)
  const rendered = await renderContactSheet(inspectedFrames, maxWidth, cellHeight, columns)
  const rows = Math.ceil(inspectedFrames.length / columns)
  const cells: AiEditorLocalMediaContactSheetCell[] = inspectedFrames.map((frame, sheetIndex) => ({
    mediaId: frame.mediaId,
    frameIndex: frame.frameIndex,
    frameId: frame.frameId,
    timeSec: frame.timeSec,
    sheetIndex,
    x: CONTACT_SHEET_GAP + (sheetIndex % columns) * (maxWidth + CONTACT_SHEET_GAP),
    y: CONTACT_SHEET_GAP + Math.floor(sheetIndex / columns) * (cellHeight + CONTACT_SHEET_GAP),
    width: maxWidth,
    height: cellHeight,
  }))

  return {
    mode: inspection.mode,
    maxWidth: inspection.maxWidth,
    items: inspection.items.map((item) => ({
      mediaId: item.mediaId,
      name: item.name,
      kind: item.kind,
      ...(item.duration === undefined ? {} : { duration: item.duration }),
      capturedAt: item.capturedAt,
      frames: item.frames.map((frame) => ({
        timeSec: frame.timeSec,
        mimeType: frame.mimeType,
        base64: frame.base64,
      })),
      ...(item.error ? { error: item.error } : {}),
    })),
    contactSheet: {
      mimeType: 'image/jpeg',
      base64: rendered.base64,
      width: rendered.width,
      height: rendered.height,
      columns,
      rows,
      cellWidth: maxWidth,
      cellHeight,
      gap: CONTACT_SHEET_GAP,
      cells,
    },
  }
}
