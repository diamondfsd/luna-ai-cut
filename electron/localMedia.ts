import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { lunaMediaAdapter } from './deviceMedia'
import type { LunaFile } from '../src/shared/types'

function isPreviewCacheDirName(name: string): boolean {
  return name === 'cache_previews'
}

function isGeneratedLivePreviewName(name: string): boolean {
  return name.toLowerCase().endsWith('.live.mp4')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)}G`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}K`
  return String(bytes)
}

function localFileUrl(value: string | null | undefined): string | null {
  return value?.startsWith('file://') ? value : null
}

function localFilePath(value: string | null | undefined): string | null {
  if (!value?.startsWith('file://')) return null
  return fileURLToPath(value)
}

function labelsFor(date: Date | null): Pick<LunaFile, 'capturedAt' | 'dateText' | 'timeText' | 'groupDay' | 'groupHour'> {
  if (!date || Number.isNaN(date.getTime())) {
    return {
      capturedAt: null,
      dateText: 'unknown',
      timeText: '--:--',
      groupDay: '未知日期',
      groupHour: '未知时间',
    }
  }

  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return {
    capturedAt: date.toISOString(),
    dateText: day,
    timeText: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    groupDay: day,
    groupHour: `${day} ${pad(date.getHours())}:00`,
  }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (isPreviewCacheDirName(entry.name)) continue
      files.push(...(await walk(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

export async function listSampleFiles(sampleMediaDir?: string): Promise<LunaFile[]> {
  if (!sampleMediaDir) return []

  const paths = await walk(sampleMediaDir)
  const allFiles: LunaFile[] = []

  for (const filePath of paths) {
    const name = path.basename(filePath)
    if (isGeneratedLivePreviewName(name)) continue
    const kind = lunaMediaAdapter.mediaKind(name)
    if (kind === 'unknown') continue

    const stats = await fs.stat(filePath)
    const timestamp = lunaMediaAdapter.capturedAt(name)
    const labels = labelsFor(timestamp)
    const fileUrl = pathToFileURL(filePath).toString()

    allFiles.push({
      id: filePath,
      name,
      href: name,
      sourceUrl: fileUrl,
      url: fileUrl,
      dateText: labels.dateText,
      timeText: labels.timeText,
      sizeText: formatSize(stats.size),
      bytes: stats.size,
      kind,
      extension: lunaMediaAdapter.extensionOf(name),
      capturedAt: labels.capturedAt,
      groupDay: labels.groupDay,
      groupHour: labels.groupHour,
      videoKey: lunaMediaAdapter.videoKey(name),
      previewName: null,
      previewUrl: null,
      cacheFilePath: null,
      downloadFilePath: filePath,
      thumbnailUrl: kind === 'image' ? fileUrl : null,
      isLivePhoto: Boolean(lunaMediaAdapter.livePhotoKey(name)),
      livePhotoVideoName: null,
      livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null,
      downloadName: name,
      canPreview: kind === 'image' || kind === 'video' || kind === 'lrv',
    })
  }

  return lunaMediaAdapter.attachRelatedFiles(allFiles)
    .map((file) => {
      const thumbnailUrl =
        file.kind === 'image'
          ? localFileUrl(file.url)
          : localFileUrl(file.previewUrl) ?? localFileUrl(file.url)
      return {
        ...file,
        livePhotoCacheFilePath: localFilePath(file.livePhotoVideoUrl) ?? file.livePhotoCacheFilePath,
        thumbnailUrl,
        canPreview: file.kind === 'image' || file.kind === 'video',
      }
    })
}
