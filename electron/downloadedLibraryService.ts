import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { lunaMediaAdapter } from './deviceMedia'
import { labelsFor, localThumbnailUrl, safeName } from './filePathUtils'
import type { DownloadRecord, LunaFile } from '../src/shared/types'

function isGeneratedLivePreviewName(name: string): boolean {
  return name.toLowerCase().endsWith('.live.mp4')
}

function localResourcesDir(outputDir: string): string {
  return path.join(outputDir, 'localResources')
}

function destinationFor(outputDir: string, file: LunaFile): string {
  return path.join(localResourcesDir(outputDir), safeName(file.downloadName))
}

export async function getDownloadedRecords(files: LunaFile[], outputDir: string): Promise<DownloadRecord[]> {
  const records: DownloadRecord[] = []

  for (const file of files) {
    const destination = destinationFor(outputDir, file)
    try {
      const stats = await fs.stat(destination)
      if (stats.isFile()) {
        records.push({ fileName: file.name, path: destination, bytes: stats.size, downloadedAt: stats.mtime.toISOString() })
      }
    } catch {
      // Missing files simply mean the media is not downloaded yet.
    }
  }

  return records
}

export async function listDownloadedFiles(outputDir: string): Promise<LunaFile[]> {
  const files: LunaFile[] = []

  async function appendFile(filePath: string): Promise<void> {
    const name = path.basename(filePath)
    const kind = lunaMediaAdapter.mediaKind(name)
    if (kind === 'unknown' || kind === 'lrv' || name.endsWith('.tmp') || isGeneratedLivePreviewName(name)) return

    const stats = await fs.stat(filePath)
    const timestamp = lunaMediaAdapter.capturedAt(name) ?? stats.mtime
    const labels = labelsFor(timestamp)
    const fileUrl = localThumbnailUrl(filePath)

    files.push({
      id: filePath,
      name,
      href: name,
      sourceUrl: fileUrl,
      url: fileUrl,
      dateText: labels.dateText,
      timeText: labels.timeText,
      sizeText: String(stats.size),
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
      thumbnailUrl: null,
      isLivePhoto: Boolean(lunaMediaAdapter.livePhotoKey(name)),
      livePhotoVideoName: null,
      livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null,
      downloadName: name,
      canPreview: kind === 'image' || kind === 'video',
      localPath: filePath,
    })
  }

  try {
    const entries = await fs.readdir(localResourcesDir(outputDir), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryPath = path.join(localResourcesDir(outputDir), entry.name)
      if (entry.isFile()) await appendFile(entryPath)
    }
  } catch {
    return []
  }

  return lunaMediaAdapter.attachRelatedFiles(files)
}
