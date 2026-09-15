import * as fs from 'node:fs/promises'
import path from 'node:path'

import type { AiEditorLocalMedia, AiEditorLocalMediaQuery } from '../../../src/shared/types'
import { generatedMusicFileName, generatedMusicMediaId } from '../music/musicMedia.ts'
import { listDownloadedFiles } from '../../media/downloadedLibraryService'
import { getLocalResourcesDir, getSettings } from '../../storage/fileService'

const MEDIA_ID_PREFIX = 'local-media:'

interface LocalMediaFile extends AiEditorLocalMedia {
  filePath: string
}

function mediaIdFor(root: string, filePath: string): string {
  const relativePath = path.relative(root, filePath).split(path.sep).join('/')
  return `${MEDIA_ID_PREFIX}${encodeURIComponent(relativePath)}`
}

function queryDate(value: string | undefined, label: string): number | null {
  if (value === undefined) return null
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

async function listLocalMediaFiles(): Promise<LocalMediaFile[]> {
  const settings = await getSettings()
  const root = path.resolve(getLocalResourcesDir(settings))
  const files = await listDownloadedFiles([root])
  const entries = await Promise.all(files.flatMap(async (file): Promise<LocalMediaFile[]> => {
    const filePath = file.localPath ?? file.downloadFilePath
    if (!filePath || (file.kind !== 'image' && file.kind !== 'video')) return []
    try {
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) return []
      return [{
        mediaId: mediaIdFor(root, filePath),
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
  return entries.flat().sort((left, right) => {
    const leftTime = Date.parse(left.capturedAt ?? left.modifiedAt)
    const rightTime = Date.parse(right.capturedAt ?? right.modifiedAt)
    return rightTime - leftTime || left.name.localeCompare(right.name)
  })
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
  const files = await Promise.all(entries.flatMap(async (entry): Promise<LocalMediaFile[]> => {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.wav')) return []
    const filePath = path.join(root, entry.name)
    try {
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) return []
      return [{
        mediaId: generatedMusicMediaId(filePath),
        name: entry.name,
        kind: 'audio',
        bytes: stats.size,
        capturedAt: stats.mtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
        groupDay: stats.mtime.toISOString().slice(0, 10),
        duration: await wavDurationSec(filePath, stats.size),
        filePath,
      }]
    } catch {
      return []
    }
  }))
  return files.flat()
}

function publicMedia(file: LocalMediaFile): AiEditorLocalMedia {
  const result = { ...file }
  Reflect.deleteProperty(result, 'filePath')
  return result as AiEditorLocalMedia
}

export async function listAiEditorLocalMedia(query: AiEditorLocalMediaQuery = {}): Promise<AiEditorLocalMedia[]> {
  const from = queryDate(query.from, '起始')
  const to = queryDate(query.to, '结束')
  if (from !== null && to !== null && from > to) throw new Error('起始日期不能晚于结束日期')
  const files = query.kind === 'audio'
    ? await listGeneratedMusicFiles()
    : await listLocalMediaFiles()
  const filtered = files.filter((file) => {
    if (query.kind && file.kind !== query.kind) return false
    const timestamp = Date.parse(file.capturedAt ?? file.modifiedAt)
    if (from !== null && timestamp < from) return false
    if (to !== null && timestamp > to) return false
    return true
  })
  return filtered.slice(0, normalizeLimit(query.limit)).map(publicMedia)
}

export async function getAiEditorLocalMedia(mediaId: string): Promise<LocalMediaFile> {
  const isGeneratedMusic = typeof mediaId === 'string' && generatedMusicFileName(mediaId) !== null
  if (typeof mediaId !== 'string' || (!mediaId.startsWith(MEDIA_ID_PREFIX) && !isGeneratedMusic)) {
    throw new Error('本地素材 ID 无效，请先调用 list_local_media')
  }
  const files = isGeneratedMusic ? await listGeneratedMusicFiles() : await listLocalMediaFiles()
  const file = files.find((candidate) => candidate.mediaId === mediaId)
  if (!file) throw new Error('本地素材不存在或已被移除，请重新调用 list_local_media')
  return file
}

export async function getAiEditorLocalMediaFiles(mediaIds: readonly string[]): Promise<LocalMediaFile[]> {
  const files = [...await listLocalMediaFiles(), ...await listGeneratedMusicFiles()]
  const byId = new Map(files.map((file) => [file.mediaId, file]))
  return mediaIds.map((mediaId) => {
    if (typeof mediaId !== 'string' || (!mediaId.startsWith(MEDIA_ID_PREFIX) && generatedMusicFileName(mediaId) === null)) {
      throw new Error('本地素材 ID 无效，请先调用 list_local_media')
    }
    const file = byId.get(mediaId)
    if (!file) throw new Error('本地素材不存在或已被移除，请重新调用 list_local_media')
    return file
  })
}

export async function readAiEditorLocalMediaBytes(mediaId: string): Promise<ArrayBuffer> {
  const file = await getAiEditorLocalMedia(mediaId)
  const bytes = await fs.readFile(file.filePath)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
