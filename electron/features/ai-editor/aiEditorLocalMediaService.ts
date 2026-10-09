import * as fs from 'node:fs/promises'
import path from 'node:path'

import type { AiEditorLocalMedia, AiEditorLocalMediaQuery } from '../../../src/shared/types'
import { generatedMusicFileName } from '../music/musicMedia.ts'
import { readGeneratedMusicTiming } from '../music/musicScoreTiming.ts'
import { listDownloadedFiles } from '../../media/downloadedLibraryService'
import { getDirectorPlanDir, getLocalResourcesDir, getSettings } from '../../storage/fileService'
import { assignAiEditorMediaIds } from './aiEditorMediaCatalog.ts'

import { listLocalDirectorPlans } from '../director-lab/directorLabPlanReader.ts'
import { directorMediaCandidates } from './aiEditorDirectorMedia.ts'

const LEGACY_MEDIA_ID_PREFIX = 'local-media:'

interface LocalMediaFile extends AiEditorLocalMedia {
  filePath: string
}

function legacyMediaIdFor(root: string, filePath: string): string {
  const relativePath = path.relative(root, filePath).split(path.sep).join('/')
  return `${LEGACY_MEDIA_ID_PREFIX}${encodeURIComponent(relativePath)}`
}

function isSimpleMediaId(value: string): boolean {
  return /^m\d+$/.test(value)
}

function findMediaByLegacyId(
  mediaId: string,
  files: readonly LocalMediaFile[],
  legacyRoot: string,
): LocalMediaFile | undefined {
  if (mediaId.startsWith(LEGACY_MEDIA_ID_PREFIX)) {
    return files.find((candidate) => legacyMediaIdFor(legacyRoot, candidate.filePath) === mediaId)
  }
  const legacyGeneratedName = generatedMusicFileName(mediaId)
  if (!legacyGeneratedName) return undefined
  return files.find((candidate) => path.basename(candidate.filePath) === legacyGeneratedName)
}

function queryDate(value: string | undefined, label: string, boundary: 'start' | 'end'): number | null {
  if (value === undefined) return null
  const dateOnly = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    if (Number.isNaN(date.getTime())) throw new Error(`${label}日期无效`)
    if (boundary === 'end') date.setHours(23, 59, 59, 999)
    return date.getTime()
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`${label}日期无效`)
  return timestamp
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 100
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error('素材数量必须是正整数')
  }
  return Math.min(value, 500)
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new Error('素材起始位置无效')
  return value
}

async function listLocalMediaFiles(): Promise<LocalMediaFile[]> {
  const settings = await getSettings()
  const root = path.resolve(getLocalResourcesDir(settings))
  const files = await listDownloadedFiles([root])
  const entries = await Promise.all(files.flatMap(async (file): Promise<Omit<LocalMediaFile, 'mediaId'>[]> => {
    const filePath = file.localPath ?? file.downloadFilePath
    if (!filePath || (file.kind !== 'image' && file.kind !== 'video')) return []
    try {
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) return []
      return [{
        name: file.name,
        kind: file.kind,
        bytes: stats.size,
        capturedAt: file.capturedAt,
        modifiedAt: stats.mtime.toISOString(),
        groupDay: file.groupDay,
        ...(file.sourceDeviceName ? { sourceDeviceName: file.sourceDeviceName } : {}),
        ...(file.sourceDeviceId ? { sourceDeviceId: file.sourceDeviceId } : {}),
        ...(file.duration !== undefined ? { duration: file.duration } : {}),
        filePath,
      }]
    } catch {
      return []
    }
  }))
  const directorFiles = directorMediaCandidates(await listLocalDirectorPlans(getDirectorPlanDir(settings)))
  const merged = new Map(entries.flat().map(file => [path.resolve(file.filePath), file]))
  for (const candidate of directorFiles) {
    const stats = await fs.stat(candidate.filePath).catch(() => null)
    if (!stats?.isFile()) continue
    const existing = merged.get(candidate.filePath)
    merged.set(candidate.filePath, { ...candidate, bytes: stats.size, modifiedAt: stats.mtime.toISOString(),
      ...existing, directorContexts: [...existing?.directorContexts ?? [], ...candidate.directorContexts] })
  }
  const sorted = [...merged.values()].sort((left, right) => {
    const leftTime = Date.parse(left.capturedAt ?? left.modifiedAt)
    const rightTime = Date.parse(right.capturedAt ?? right.modifiedAt)
    return rightTime - leftTime || left.name.localeCompare(right.name)
  })
  const ids = await assignAiEditorMediaIds(settings.baseDir, sorted.map((file) => ({
    filePath: file.filePath,
    kind: file.kind,
  })))
  return sorted.map((file) => ({
    ...file,
    mediaId: ids.get(path.resolve(file.filePath)) ?? '',
  }))
}

async function wavDurationSec(filePath: string, bytes: number): Promise<number> {
  try {
    const handle = await fs.open(filePath, 'r')
    try {
      const header = Buffer.alloc(44)
      await handle.read(header, 0, header.byteLength, 0)
      if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
        return 0
      }
      const channels = header.readUInt16LE(22)
      const sampleRate = header.readUInt32LE(24)
      const bitsPerSample = header.readUInt16LE(34)
      const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8)
      return bytesPerSecond > 0 ? Math.max(0, (bytes - 44) / bytesPerSecond) : 0
    } finally {
      await handle.close()
    }
  } catch {
    return 0
  }
}

async function listGeneratedMusicFiles(): Promise<LocalMediaFile[]> {
  const settings = await getSettings()
  const root = path.join(settings.baseDir, 'generated-music')
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files = await Promise.all(entries.flatMap(async (entry): Promise<Omit<LocalMediaFile, 'mediaId'>[]> => {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.wav')) return []
    const filePath = path.join(root, entry.name)
    try {
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) return []
      return [{
        name: entry.name,
        kind: 'audio',
        bytes: stats.size,
        capturedAt: stats.mtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
        groupDay: stats.mtime.toISOString().slice(0, 10),
        duration: await wavDurationSec(filePath, stats.size),
        musicTiming: await readGeneratedMusicTiming(filePath),
        filePath,
      }]
    } catch {
      return []
    }
  }))
  const sorted = files.flat().sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt))
  const ids = await assignAiEditorMediaIds(settings.baseDir, sorted.map((file) => ({
    filePath: file.filePath,
    kind: 'audio',
  })))
  return sorted.map((file) => ({
    ...file,
    mediaId: ids.get(path.resolve(file.filePath)) ?? '',
  }))
}

function publicMedia(file: LocalMediaFile): AiEditorLocalMedia {
  const result = { ...file }
  Reflect.deleteProperty(result, 'filePath')
  return result as AiEditorLocalMedia
}

export async function listAiEditorLocalMedia(query: AiEditorLocalMediaQuery = {}): Promise<AiEditorLocalMedia[]> {
  if (query.planId !== undefined && (typeof query.planId !== 'string' || !query.planId.trim() || query.planId.length > 128)) throw new Error('计划编号无效')
  const from = queryDate(query.from, '起始', 'start')
  const to = queryDate(query.to, '结束', 'end')
  if (from !== null && to !== null && from > to) throw new Error('起始日期不能晚于结束日期')
  const files = query.kind === 'audio'
    ? await listGeneratedMusicFiles()
    : query.kind === 'image' || query.kind === 'video'
      ? await listLocalMediaFiles()
      : [...await listLocalMediaFiles(), ...await listGeneratedMusicFiles()]
        .sort((left, right) => Date.parse(right.capturedAt ?? right.modifiedAt) - Date.parse(left.capturedAt ?? left.modifiedAt))
  const filtered = files.filter((file) => {
    if (query.planId && !file.directorContexts?.some(context => context.planId === query.planId)) return false
    if (query.kind && file.kind !== query.kind) return false
    const timestamp = Date.parse(file.capturedAt ?? file.modifiedAt)
    if (from !== null && timestamp < from) return false
    if (to !== null && timestamp > to) return false
    return true
  })
  const offset = normalizeOffset(query.offset)
  return filtered.slice(offset, offset + normalizeLimit(query.limit)).map(publicMedia)
}

export async function getAiEditorLocalMedia(mediaId: string): Promise<LocalMediaFile> {
  const isLegacyGeneratedMusic = typeof mediaId === 'string' && generatedMusicFileName(mediaId) !== null
  const isLegacyLocalMedia = typeof mediaId === 'string' && mediaId.startsWith(LEGACY_MEDIA_ID_PREFIX)
  if (typeof mediaId !== 'string' || (!isSimpleMediaId(mediaId) && !isLegacyGeneratedMusic && !isLegacyLocalMedia)) {
    throw new Error('本地素材 ID 无效，请先调用 list_local_media')
  }
  const files = [...await listLocalMediaFiles(), ...await listGeneratedMusicFiles()]
  const settings = await getSettings()
  const legacyRoot = path.resolve(getLocalResourcesDir(settings))
  const file = files.find((candidate) => candidate.mediaId === mediaId)
    ?? findMediaByLegacyId(mediaId, files, legacyRoot)
  if (!file) throw new Error('本地素材不存在或已被移除，请重新调用 list_local_media')
  return file
}

export async function getAiEditorLocalMediaFiles(mediaIds: readonly string[]): Promise<LocalMediaFile[]> {
  const files = [...await listLocalMediaFiles(), ...await listGeneratedMusicFiles()]
  const byId = new Map(files.map((file) => [file.mediaId, file]))
  const settings = await getSettings()
  const legacyRoot = path.resolve(getLocalResourcesDir(settings))
  return mediaIds.map((mediaId) => {
    const legacyGeneratedName = typeof mediaId === 'string' ? generatedMusicFileName(mediaId) : null
    if (typeof mediaId !== 'string' || (!isSimpleMediaId(mediaId) && legacyGeneratedName === null && !mediaId.startsWith(LEGACY_MEDIA_ID_PREFIX))) {
      throw new Error('本地素材 ID 无效，请先调用 list_local_media')
    }
    const file = byId.get(mediaId) ?? findMediaByLegacyId(mediaId, files, legacyRoot)
    if (!file) throw new Error('本地素材不存在或已被移除，请重新调用 list_local_media')
    return file
  })
}

export async function resolveAiEditorLocalMediaPaths(filePaths: readonly string[]): Promise<string[]> {
  if (!Array.isArray(filePaths) || filePaths.length > 500
    || filePaths.some((value) => typeof value !== 'string' || !path.isAbsolute(value))) {
    throw new Error('素材路径列表无效')
  }
  const files = [...await listLocalMediaFiles(), ...await listGeneratedMusicFiles()]
  const mediaByPath = new Map(files.map((file) => [path.resolve(file.filePath), file.mediaId]))
  return [...new Set(filePaths.map((filePath) => mediaByPath.get(path.resolve(filePath))).filter((id): id is string => Boolean(id)))]
}

export async function readAiEditorLocalMediaBytes(mediaId: string): Promise<ArrayBuffer> {
  const file = await getAiEditorLocalMedia(mediaId)
  const bytes = await fs.readFile(file.filePath)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
